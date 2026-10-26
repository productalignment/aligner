// The server: the single-file UI, signing in with GitHub, setting Aligner up, and the RPC
// bridge the UI calls. It runs anywhere a container runs; Railway gives it its port, its domain,
// and a volume for the PM's drafts.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Account } from '@aligner/core';
import { COOKIE, DAY, SESSION_AGE, Sealer, appManifest, appVariables, challenge, localPath, random, readCookies, setCookie, type AppConfig } from './auth.ts';
import { touchIcon, uiHtml } from './extras.ts';
import { GitHub, GitHubError, convertManifest, exchange, revoke, type CreatedApp, type GitHubUrls, type Tokens } from './github.ts';
import { PRODUCT_METHODS, Products, type ProductMethod, type Viewer } from './handlers.ts';
import type { Updates } from './updates.ts';

export interface ServerOptions {
  github: GitHubUrls;
  /** Null until the PM has created Aligner's GitHub App and given its variables to Railway. */
  app: AppConfig | null;
  /** Where the PM's drafts are kept, and whether that outlives a restart (a volume). */
  data: { dir: string; durable: boolean };
  updates: Updates;
}

export interface AlignerServer {
  url: string;
  close(): Promise<void>;
}

interface Session extends Tokens { login: string }

export async function startServer(opts: ServerOptions, port: number, host = '0.0.0.0'): Promise<AlignerServer> {
  const { github, app } = opts;
  const sealer = app && new Sealer(app.clientSecret);
  const products = new Products(opts.data.dir);
  /** Each PM's latest token: the products they have open reach GitHub with it. */
  const viewers = new Map<string, { token: string; viewer: Viewer }>();
  /** Refreshes under way or just done, by refresh token: requests that come together share one. */
  const refreshes = new Map<string, Promise<Tokens>>();

  const server = createServer((req, res) => {
    route(req, res).catch((e: Error) => {
      console.error(e); // in Railway's logs
      send(res, 500, 'text/plain; charset=utf-8', e.message);
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const base = baseUrl(req);
    const secure = base.startsWith('https:');
    const cookies = readCookies(req);
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, 'text/plain', 'ok');
    if (req.method === 'GET' && url.pathname === '/') {
      const html = uiHtml();
      return send(res, 200, 'text/html; charset=utf-8', html, { 'content-security-policy': pagePolicy(html), 'referrer-policy': 'same-origin' });
    }
    if (req.method === 'GET' && url.pathname === '/apple-touch-icon.png') return send(res, 200, 'image/png', touchIcon(), { 'cache-control': 'public, max-age=86400' });

    // Setting up: GitHub created the app from Aligner's manifest and sent the PM back with a code.
    if (req.method === 'GET' && url.pathname === '/setup/github') {
      if (app) return redirect(res, '/');
      const code = url.searchParams.get('code');
      if (!code || !cookies[COOKIE.setup] || url.searchParams.get('state') !== cookies[COOKIE.setup]) return redirect(res, `/?error=${encodeURIComponent("Creating the GitHub app didn't finish. Try again.")}`);
      try {
        const created = await convertManifest(github, code);
        setCookie(res, COOKIE.app, Buffer.from(JSON.stringify(created)).toString('base64url'), 7 * DAY, secure);
        return redirect(res, '/');
      } catch (e) {
        return redirect(res, `/?error=${encodeURIComponent((e as Error).message)}`);
      }
    }

    // Signing in with GitHub: the web application flow, with PKCE.
    if (req.method === 'GET' && url.pathname === '/auth/login') {
      if (!app || !sealer) return redirect(res, '/');
      const state = random();
      const verifier = random(32);
      setCookie(res, COOKIE.oauth, sealer.seal({ state, verifier, to: localPath(url.searchParams.get('to')) }), 600, secure);
      const query = new URLSearchParams({ client_id: app.clientId, redirect_uri: `${base}/auth/callback`, state, code_challenge: challenge(verifier), code_challenge_method: 'S256' });
      return redirect(res, `${github.web}/login/oauth/authorize?${query}`);
    }
    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      if (!app || !sealer) return redirect(res, '/');
      const saved = sealer.open<{ state: string; verifier: string; to: string }>(cookies[COOKIE.oauth]);
      setCookie(res, COOKIE.oauth, null, 0, secure);
      const code = url.searchParams.get('code');
      if (!saved || !code || url.searchParams.get('state') !== saved.state) return redirect(res, `/?error=${encodeURIComponent("Signing in with GitHub didn't finish. Try again.")}`);
      try {
        const tokens = await exchange(github, { client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: `${base}/auth/callback`, code_verifier: saved.verifier });
        const user = await new GitHub(github, () => tokens.token).get<{ login: string }>('/user');
        setCookie(res, COOKIE.session, sealer.seal({ login: user.login, ...tokens } satisfies Session), SESSION_AGE, secure);
        return redirect(res, saved.to);
      } catch (e) {
        return redirect(res, `/?error=${encodeURIComponent((e as Error).message)}`);
      }
    }

    if (req.method === 'POST' && url.pathname === '/rpc') {
      // Only Aligner's own page sends this header: a page elsewhere can't, without a CORS preflight this server never allows.
      if (req.headers['x-aligner'] !== '1') return json(res, 403, { error: 'Forbidden' });
      const { method, params } = JSON.parse(await readBody(req)) as { method: string; params?: Record<string, unknown> };
      if (method === 'account') return json(res, 200, { result: await account(res, base, cookies) });
      const viewer = await signedIn(res, cookies, secure);
      if (!viewer) return json(res, 401, { error: 'Sign in with GitHub to go on.' });
      if (method === 'signOut') {
        // Everywhere: GitHub cancels the sign-in, so a lost device is signed out too.
        await revoke(github, app!, viewers.get(viewer.login)!.token).catch((e: Error) => console.error(e));
        setCookie(res, COOKIE.session, null, 0, secure);
        return json(res, 200, { result: null });
      }
      if (method === 'update') {
        try {
          await opts.updates.update(viewer.gh);
          return json(res, 200, { result: null });
        } catch (e) {
          return json(res, 200, { error: (e as Error).message });
        }
      }
      if (!PRODUCT_METHODS.includes(method as ProductMethod)) return json(res, 404, { error: `Unknown method ${method}` });
      try {
        const result = await (products[method as ProductMethod] as (v: Viewer, p: unknown) => Promise<unknown>)(viewer, params ?? {});
        return json(res, 200, { result: result ?? null });
      } catch (e) {
        if (e instanceof GitHubError && e.status === 401) return json(res, 401, { error: e.message });
        return json(res, 200, { error: (e as Error).message });
      }
    }
    send(res, 404, 'text/plain', 'Not found');
  }

  async function account(res: ServerResponse, base: string, cookies: Record<string, string>): Promise<Account> {
    const secure = base.startsWith('https:');
    if (!app) {
      const state = cookies[COOKIE.setup] ?? randomBytes(16).toString('hex');
      setCookie(res, COOKIE.setup, state, 3600, secure);
      let created: CreatedApp | undefined;
      const carried = cookies[COOKIE.app];
      try { created = carried ? (JSON.parse(Buffer.from(carried, 'base64url').toString('utf8')) as CreatedApp) : undefined; } catch { /* none */ }
      return { stage: 'setup', github: github.web, state, manifest: appManifest(base, state), ...(created ? { created: { name: created.name, variables: appVariables(created) } } : {}) };
    }
    if (cookies[COOKIE.app]) setCookie(res, COOKIE.app, null, 0, secure); // given to Railway: Aligner is set up
    const viewer = await signedIn(res, cookies, secure);
    if (!viewer) return { stage: 'signin' };
    const user = await viewer.gh.get<{ login: string; name: string | null; avatar_url: string }>('/user').catch((e: Error) => {
      if (e instanceof GitHubError && e.status === 401) return null;
      throw e;
    });
    if (!user) return { stage: 'signin' };
    const update = await opts.updates.check(viewer.gh);
    return {
      stage: 'ready', user: { login: user.login, name: user.name, avatar: user.avatar_url }, install: `${github.web}/apps/${app.slug}/installations/new`,
      durable: opts.data.durable, version: opts.updates.version, ...(update ? { update } : {}),
    };
  }

  /** The PM this request comes from, with a fresh token; null when nobody is signed in. */
  async function signedIn(res: ServerResponse, cookies: Record<string, string>, secure: boolean): Promise<Viewer | null> {
    let session = sealer?.open<Session>(cookies[COOKIE.session]);
    if (!session || !app) return null;
    if (session.expires && session.expires - Date.now() < 60_000) {
      if (!session.refresh) return null;
      const refresh = session.refresh;
      let next = refreshes.get(refresh);
      if (!next) {
        next = exchange(github, { client_id: app.clientId, client_secret: app.clientSecret, grant_type: 'refresh_token', refresh_token: refresh });
        refreshes.set(refresh, next);
        setTimeout(() => refreshes.delete(refresh), 60_000).unref();
      }
      try {
        session = { login: session.login, ...(await next) };
      } catch {
        setCookie(res, COOKIE.session, null, 0, secure);
        return null;
      }
      setCookie(res, COOKIE.session, sealer!.seal(session), SESSION_AGE, secure);
    }
    let known = viewers.get(session.login);
    if (!known) {
      const login = session.login;
      known = { token: session.token, viewer: { login, gh: new GitHub(github, () => viewers.get(login)!.token) } };
      viewers.set(login, known);
    }
    known.token = session.token;
    return known.viewer;
  }

  await new Promise<void>((r) => server.listen(port, host, r));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${actual}`,
    close: async () => {
      products.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** This Aligner's own address, as the browser sees it (Railway's proxy says it was https). */
function baseUrl(req: IncomingMessage): string {
  const first = (h: string | string[] | undefined) => String(h ?? '').split(',')[0]!.trim();
  const proto = first(req.headers['x-forwarded-proto']) || 'http';
  return `${proto === 'https' ? 'https' : 'http'}://${first(req.headers['x-forwarded-host']) || first(req.headers.host) || 'localhost'}`;
}

/**
 * What the page may load and run: its own inlined script only, whatever a repository's files
 * hold; its own styles, and the product's Google Fonts for mockups; pictures from itself, data URLs
 * and https (GitHub's avatars). It can't be framed by another site.
 */
function pagePolicy(html: string): string {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`);
  return [
    "default-src 'self'", `script-src ${scripts.join(' ')}`, "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com", "img-src 'self' data: https:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
  ].join('; ');
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(body);
}

const json = (res: ServerResponse, status: number, body: unknown) => send(res, status, 'application/json', JSON.stringify(body));

function redirect(res: ServerResponse, to: string) {
  res.writeHead(302, { location: to, 'cache-control': 'no-store' });
  res.end();
}

/** A request's body, up to what an 8 MB picture takes as base64. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      data += c;
      if (data.length > 12 * 1024 * 1024) req.destroy(new Error('Too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

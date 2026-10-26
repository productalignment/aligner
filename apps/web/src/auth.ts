// Signing in with GitHub, and setting Aligner up. Aligner signs people in through its own
// GitHub App, which it creates from a manifest the first time it runs: the PM confirms it on
// GitHub, and gives the app's ID and secret to Railway as variables. Sessions live in a cookie,
// sealed with a key derived from the app's secret, so the server keeps no state of its own.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CreatedApp } from './github.ts';

/** The GitHub App Aligner signs people in with, from the variables the PM gave Railway. */
export interface AppConfig { slug: string; clientId: string; clientSecret: string }

export function appFromEnv(env: NodeJS.ProcessEnv): AppConfig | null {
  const [slug, clientId, clientSecret] = ['GITHUB_APP_SLUG', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'].map((k) => env[k]?.trim());
  return slug && clientId && clientSecret ? { slug, clientId, clientSecret } : null;
}

/** The variables that set Aligner up with the app the PM just created, in Railway's raw editor format. */
export const appVariables = (app: CreatedApp) => `GITHUB_APP_SLUG=${app.slug}\nGITHUB_CLIENT_ID=${app.clientId}\nGITHUB_CLIENT_SECRET=${app.clientSecret}\n`;

/**
 * The app Aligner asks GitHub to create: it may read and write the contents of the repositories the
 * PM installs it on, and nothing else; only the PM's account can install it.
 */
export function appManifest(base: string, state: string): string {
  return JSON.stringify({
    name: `Aligner ${state.slice(0, 6)}`,
    url: base,
    description: 'Aligner: a simple, visual editor for the product context your AI coding agent builds from.',
    redirect_url: `${base}/setup/github`,
    callback_urls: [`${base}/auth/callback`],
    setup_url: `${base}/`,
    setup_on_update: true,
    public: false,
    hook_attributes: { url: `${base}/`, active: false },
    default_permissions: { contents: 'write', metadata: 'read' },
    default_events: [],
  });
}

// ---- Cookies ----------------------------------------------------------------------

export const COOKIE = { session: 'aligner_session', oauth: 'aligner_oauth', setup: 'aligner_setup', app: 'aligner_app' } as const;
export const DAY = 24 * 60 * 60;
/** How long a sign-in lasts unused: renewing the PM's token, every 8 hours of use, starts it again. */
export const SESSION_AGE = 30 * DAY;

export function readCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Sets (or, with no value, clears) an HTTP-only cookie for the whole site. */
export function setCookie(res: ServerResponse, name: string, value: string | null, maxAge: number, secure: boolean) {
  const cookie = [`${name}=${value === null ? '' : encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${value === null ? 0 : maxAge}`, ...(secure ? ['Secure'] : [])].join('; ');
  const prev = res.getHeader('set-cookie');
  res.setHeader('set-cookie', [...(Array.isArray(prev) ? prev : prev ? [String(prev)] : []), cookie]);
}

export const random = (bytes = 16) => randomBytes(bytes).toString('base64url');
export const challenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** Seals what a cookie carries (AES-256-GCM), so only this Aligner can read or forge it. */
export class Sealer {
  private readonly key: Buffer;
  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, 'aligner', 'cookies', 32));
  }

  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  open<T>(sealed: string | undefined): T | null {
    if (!sealed) return null;
    try {
      const raw = Buffer.from(sealed, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as T;
    } catch {
      return null;
    }
  }
}

/** Where to go after signing in: a page of this Aligner only. Browsers drop tabs and line breaks from an address, which would make "/\t/x" lead to another site. */
export const localPath = (to: string | null | undefined) => (to && /^\/(?![/\\])[^\\\x00-\x1f\x7f]*$/.test(to) ? to : '/');

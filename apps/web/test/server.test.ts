// Runs the built server (dist/server.js) as Railway runs it, against a stand-in for GitHub: setting
// it up, signing in, the repositories and branches, and the product context on a branch, with the
// PM's draft kept on the server until they commit it, the coding agent's pushes merged in, and new
// versions of Aligner. Requires `npm run build` first (the `test` script runs it).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { readFolder } from '@aligner/core';
import { startAligner, type Harness } from '../e2e/harness';
import { newer, releases } from '../src/updates';
import { USAGE_URL, partOf, usageUrl } from '../src/usage';

const SERVER = fileURLToPath(new URL('../dist/server.js', import.meta.url));
const TIDY = fileURLToPath(new URL('../../../examples/tidy', import.meta.url));
const REPO = 'pat/tidy';
const REF = { repo: REPO, branch: 'main' };
const VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string }).version;

/** A browser, as far as cookies and redirects go: it follows them between Aligner and GitHub. */
function client(base: string) {
  const jar = new Map<string, string>();
  const take = (res: globalThis.Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      const value = pair!.slice(i + 1);
      if (/Max-Age=0/.test(c)) jar.delete(pair!.slice(0, i)); else jar.set(pair!.slice(0, i), value);
    }
  };
  const headers = (url: string): Record<string, string> => (url.startsWith(base) && jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {});
  return {
    jar,
    /** Goes to a page, following redirects; returns where it ended. */
    async go(url: string, init: RequestInit = {}): Promise<string> {
      for (let i = 0; i < 10; i++) {
        const res = await fetch(url, { ...init, redirect: 'manual', headers: { ...headers(url), ...(init.headers as Record<string, string>) } });
        take(res);
        const to = res.headers.get('location');
        if (!to) return url;
        url = new URL(to, url).toString();
        init = {};
      }
      throw new Error('Too many redirects');
    },
    async rpc<T>(method: string, params: Record<string, unknown> = {}, extra: Record<string, string> = { 'x-aligner': '1' }): Promise<{ status: number; result?: T; error?: string }> {
      const res = await fetch(`${base}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers(base), ...extra }, body: JSON.stringify({ method, params }) });
      take(res);
      return { status: res.status, ...((await res.json()) as { result?: T; error?: string }) };
    },
  };
}

const until = async (check: () => boolean | Promise<boolean>, what = 'condition') => {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`${what} not met`);
};

let h: Harness;
let pm: ReturnType<typeof client>;

beforeAll(async () => {
  if (!existsSync(SERVER)) throw new Error('Build first: npm run build -w aligner');
  h = await startAligner({ headless: false, repos: { [REPO]: await readFolder(TIDY), 'pat/empty': {}, 'pat/fresh': { 'README.md': '# Fresh\n', 'CLAUDE.md': '# Rules\n' } } });
  pm = client(h.url);
  await pm.go(`${h.url}/auth/login?to=${encodeURIComponent('/?repo=pat/tidy')}`);
});

afterAll(async () => { await h?.close(); });

describe('the server', () => {
  it('answers Railway\'s health check, and serves the single-file UI', async () => {
    expect(await (await fetch(`${h.url}/health`)).text()).toBe('ok');
    const page = await fetch(h.url);
    const html = await page.text();
    expect(html).toContain('<div id="root">');
    expect(html).not.toMatch(/<script[^>]+src=/); // everything inlined
    const policy = page.headers.get('content-security-policy')!;
    const script = /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(policy).toContain(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}';`); // its own script, and only that
    expect(policy).toContain("frame-ancestors 'none'");
    const icon = await fetch(`${h.url}/apple-touch-icon.png`); // an iPhone's home screen asks for it here
    expect(icon.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await icon.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG');
  });

  it("answers only Aligner's own page, and only once the PM has signed in", async () => {
    expect((await pm.rpc('snapshot', REF, {})).status).toBe(403);
    const stranger = client(h.url);
    expect(await stranger.rpc('account')).toMatchObject({ status: 200, result: { stage: 'signin' } });
    expect(await stranger.rpc('snapshot', REF)).toMatchObject({ status: 401 });
  });
});

describe('signing in with GitHub', () => {
  it('signs the PM in through the app, and back to where they were going', async () => {
    const pat = client(h.url);
    expect(await pat.go(`${h.url}/auth/login?to=${encodeURIComponent('/?repo=pat/tidy&branch=main')}`)).toBe(`${h.url}/?repo=pat/tidy&branch=main`);
    const account = await pat.rpc('account');
    expect(account.result).toEqual({ stage: 'ready', user: { login: 'pat', name: 'Pat Doe', avatar: h.github.user.avatar_url }, install: `${h.github.web}/apps/aligner-test/installations/new`, durable: true, version: VERSION, usageStats: false });
  });

  it('goes back only to a page of this Aligner', async () => {
    const pat = client(h.url);
    for (const to of ['//elsewhere.example', '/\t/elsewhere.example', '/\\elsewhere.example']) {
      expect(await pat.go(`${h.url}/auth/login?to=${encodeURIComponent(to)}`), JSON.stringify(to)).toBe(`${h.url}/`);
    }
  });

  it('refuses a sign-in it did not start', async () => {
    const other = client(h.url);
    expect(await other.go(`${h.url}/auth/callback?code=nope&state=forged`)).toMatch(/\/\?error=/);
    expect(other.jar.has('aligner_session')).toBe(false);
  });

  it('renews an expired token by itself, once for requests that come together', async () => {
    h.github.tokenLife = 30; // within a minute of expiry: every request renews
    const pat = client(h.url);
    await pat.go(`${h.url}/auth/login`);
    const before = pat.jar.get('aligner_session');
    const answers = await Promise.all([pat.rpc('repos'), pat.rpc('branches', { repo: REPO })]);
    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(pat.jar.get('aligner_session')).not.toBe(before);
    h.github.tokenLife = 28800;
  });

  it('signs out everywhere: GitHub cancels the sign-in, on every device', async () => {
    const phone = client(h.url);
    await phone.go(`${h.url}/auth/login`);
    expect((await phone.rpc('signOut')).status).toBe(200);
    expect((await phone.rpc('repos')).status).toBe(401);
    expect((await pm.rpc('repos')).status).toBe(401); // the PM's other device too
    await pm.go(`${h.url}/auth/login`);
    expect((await pm.rpc('repos')).status).toBe(200);
  });
});

describe('repositories and branches', () => {
  it('lists the repositories the PM gave Aligner, the latest pushed first', async () => {
    const { result } = await pm.rpc<{ repo: string; defaultBranch: string }[]>('repos');
    expect(result!.map((r) => r.repo)).toEqual(['pat/fresh', 'pat/empty', 'pat/tidy']);
    expect(result![2]).toMatchObject({ repo: 'pat/tidy', defaultBranch: 'main', private: true });
  });

  it("lists a repository's branches, its default branch first", async () => {
    h.github.addBranch(REPO, 'alpha');
    h.github.addBranch(REPO, 'option/b');
    expect((await pm.rpc('branches', { repo: REPO })).result).toEqual(['main', 'alpha', 'option/b']);
  });
});

describe('the product context on a branch', () => {
  it('reads it from the branch', async () => {
    const { result } = await pm.rpc<{ name: string; hasContext: boolean; findings: unknown[]; repo: string; branch: string }>('snapshot', REF);
    expect(result).toMatchObject({ name: 'Tidy', hasContext: true, findings: [], repo: REPO, branch: 'main' });
  });

  it('keeps the edits as a draft on the server, on any device, until the PM commits them as one commit', async () => {
    const before = h.github.messages(REPO, 'main');
    const { result: open } = await pm.rpc<{ version: string }>('snapshot', REF);
    await pm.rpc('edit', { ...REF, op: { op: 'modify', id: 'PE-001', fields: { who: 'Works nights' } } });
    await pm.rpc('edit', { ...REF, op: { op: 'add', type: 'job', parent: 'PE-001', fields: { text: 'When I come home late, I want a quiet flat' } } });
    expect(h.github.messages(REPO, 'main')).toEqual(before); // nothing on GitHub yet
    expect((await pm.rpc<{ changes: number }>('status', REF)).result!.changes).toBe(2);

    const phone = client(h.url); // the same PM, on another device
    await phone.go(`${h.url}/auth/login`);
    const { result: there } = await phone.rpc<{ model: { personas: { who: string }[] }; version: string }>('snapshot', REF);
    expect(there!.model.personas[0]!.who).toBe('Works nights');

    const { result: after } = await pm.rpc<{ version: string }>('commit', { ...REF, message: 'Who comes home late' });
    expect(h.github.messages(REPO, 'main')).toEqual(['Who comes home late\n\nEdited in Aligner:\n- edit PE-001\n- add JB-005 to PE-001', ...before]);
    expect(h.github.file(REPO, 'main', 'product/personas.md')).toContain('- who: Works nights\n');
    expect(h.github.file(REPO, 'main', 'product/personas.md')).toContain('- JB-005: When I come home late, I want a quiet flat\n');
    expect((await pm.rpc<{ changes: number; version: string }>('status', REF)).result).toMatchObject({ changes: 0, version: there!.version });
    expect(after!.version).toBe(there!.version);
    expect(open!.version).not.toBe(there!.version);
  });

  it('keeps the draft when Aligner restarts, and lets go of it on request', async () => {
    await pm.rpc('edit', { ...REF, op: { op: 'modify', id: 'VI-THE', fields: { text: 'Tidy Flat' } } });
    await h.restart();
    expect((await pm.rpc<{ changes: number }>('status', REF)).result!.changes).toBe(1);
    expect((await pm.rpc<{ name: string }>('snapshot', REF)).result!.name).toBe('Tidy Flat');
    const { result } = await pm.rpc<{ name: string }>('discard', REF);
    expect(result!.name).toBe('Tidy');
    expect((await pm.rpc<{ changes: number }>('status', REF)).result!.changes).toBe(0);
    expect(h.github.file(REPO, 'main', 'product/product.md')).toContain('- the: Tidy\n');
  });

  it("keeps a screenshot in the draft, and commits it as a file on the branch", async () => {
    const png = readFileSync(fileURLToPath(new URL('../../../product/screens/SC-002.png', import.meta.url)));
    await pm.rpc('setPicture', { ...REF, screenId: 'SC-001', fileName: 'week.png', dataBase64: png.toString('base64') });
    const picture = await pm.rpc<string>('picture', { ...REF, path: 'screens/SC-001.png' });
    expect(picture.result).toBe(`data:image/png;base64,${png.toString('base64')}`);
    expect(h.github.bytes(REPO, 'main', 'product/screens/SC-001.png')).toBeUndefined();
    await pm.rpc('commit', { ...REF, message: '' });
    expect(h.github.messages(REPO, 'main')[0]).toBe('Update the product context\n\nEdited in Aligner:\n- screenshot of SC-001');
    expect(h.github.bytes(REPO, 'main', 'product/screens/SC-001.png')!.equals(png)).toBe(true);
    expect(h.github.bytes(REPO, 'main', 'product/screens/SC-001.svg')).toBeUndefined();
  });

  it('keeps where the PM put the screens on the map in the draft, beside the flows\' layouts', async () => {
    const { result } = await pm.rpc<{ layouts: Record<string, unknown> }>('saveLayout', { ...REF, of: 'screens', layout: { 'SC-001': { x: 10, y: 20 } } });
    expect(result!.layouts).toEqual({ screens: { 'SC-001': { x: 10, y: 20 } } });
    expect(h.file(REPO, 'main', 'product/screens.layout.json')!.toString()).toContain('"SC-001"');
    expect(h.github.file(REPO, 'main', 'product/screens.layout.json')).toBeUndefined();
    await pm.rpc('discard', REF);
  });

  it("picks up the coding agent's push, asking GitHub for free while the branch stays as it is", async () => {
    const { result: before } = await pm.rpc<{ version: string }>('status', REF);
    const flow = h.github.file(REPO, 'main', 'product/flows/FL-003.md')!;
    h.github.push(REPO, 'main', { 'product/flows/FL-003.md': flow.replace('# FL-003 Check fairness', '# FL-003 See who did what'), 'src/app.ts': 'export {};\n' });
    await new Promise((r) => setTimeout(r, 2100));
    const { result: after } = await pm.rpc<{ version: string }>('status', REF);
    expect(after!.version).not.toBe(before!.version);
    const { result } = await pm.rpc<{ model: { flows: { name: string }[] } }>('snapshot', REF);
    expect(result!.model.flows.map((f) => f.name)).toContain('See who did what');
    const quiet = h.github.notModified;
    await new Promise((r) => setTimeout(r, 2100));
    expect((await pm.rpc<{ version: string }>('status', REF)).result!.version).toBe(after!.version);
    expect(h.github.notModified).toBeGreaterThan(quiet); // asked with its ETag: an unchanged branch costs nothing
  });

  it("merges the agent's push into the draft, item by item, keeping both", async () => {
    await pm.rpc('edit', { ...REF, op: { op: 'modify', id: 'PE-002', fields: { who: 'Shares the flat' } } });
    await pm.rpc('edit', { ...REF, op: { op: 'modify', id: 'SC-002', fields: { name: 'Chore page' } } });
    const screens = h.github.file(REPO, 'main', 'product/screens.md')!;
    h.github.push(REPO, 'main', { 'product/screens.md': screens.replace('## SC-003 Done', '## SC-003 All done') }, 'Rename a screen');
    await new Promise((r) => setTimeout(r, 2100));
    expect((await pm.rpc<{ changes: number; notice?: string }>('status', REF)).result).toEqual({ version: expect.any(String), changes: 2 });
    const { result } = await pm.rpc<{ model: { screens: { name: string }[] } }>('snapshot', REF);
    expect(result!.model.screens.map((x) => x.name)).toEqual(['This week', 'Chore page', 'All done', 'Set up flat', 'Scoreboard']);
    await pm.rpc('commit', { ...REF, message: 'Names' });
    expect(h.github.messages(REPO, 'main').slice(0, 2)).toEqual(['Names\n\nEdited in Aligner:\n- edit PE-002\n- edit SC-002', 'Rename a screen']);
    expect(h.github.file(REPO, 'main', 'product/screens.md')).toContain('## SC-002 Chore page\n');
    expect(h.github.file(REPO, 'main', 'product/screens.md')).toContain('## SC-003 All done\n');
    expect(h.github.file(REPO, 'main', 'product/personas.md')).toContain('- who: Shares the flat\n');
  });

  it('tells the PM when both changed the same thing, and keeps their version', async () => {
    await pm.rpc('edit', { ...REF, op: { op: 'modify', id: 'SC-001', fields: { name: 'The week' } } });
    h.github.push(REPO, 'main', { 'product/screens.md': h.github.file(REPO, 'main', 'product/screens.md')!.replace('This week', 'Week') }, 'Rename again');
    let notice: string | undefined;
    await until(async () => !!(notice = (await pm.rpc<{ notice?: string }>('status', REF)).result!.notice), 'notice');
    expect(notice).toBe('Your coding agent changed “The week” too: your draft keeps your version.');
    await pm.rpc('commit', { ...REF, message: '' });
    expect(h.github.file(REPO, 'main', 'product/screens.md')).toContain('## SC-001 The week\n');
  });

  it("reads the product's colours, fonts and icons from the code on its branch, for its mockups", async () => {
    h.github.push(REPO, 'main', {
      'web/index.css': "@theme {\n  --font-sans: 'Figtree', system-ui, sans-serif;\n  --color-ink: #1f1d1a;\n  --color-butter: #f1cc6f;\n  --color-alias: var(--color-ink);\n}\n",
      'web/index.html': '<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;700&amp;display=swap" rel="stylesheet" />',
      [`web/${'deep/'.repeat(20)}App.tsx`]: "import { CalendarDays, MapPin as Pin } from 'lucide-react';\n",
      'node_modules/x/index.css': ':root { --color-hidden: #123456; }',
    });
    await new Promise((r) => setTimeout(r, 2100));
    await pm.rpc('status', REF);
    expect((await pm.rpc('theme', REF)).result).toEqual({
      colours: [{ name: 'ink', value: '#1f1d1a' }, { name: 'butter', value: '#f1cc6f' }],
      fonts: ['Figtree'],
      fontLinks: ['https://fonts.googleapis.com/css2?family=Figtree:wght@400;700&display=swap'],
      icons: [],
    });
    h.github.push(REPO, 'main', { 'web/App.tsx': "import { CalendarDays, MapPin as Pin } from 'lucide-react';\n" });
    await new Promise((r) => setTimeout(r, 2100));
    await pm.rpc('status', REF);
    expect((await pm.rpc<{ icons: string[] }>('theme', REF)).result!.icons).toEqual(['CalendarDays', 'MapPin']);
  });

  it('refuses pictures outside product/', async () => {
    expect((await pm.rpc('picture', { ...REF, path: '../CLAUDE.md' })).error).toContain('must live in product/');
  });
});

describe('starting a product', () => {
  it('adds the product files, the instructions and the agent blocks, committed at once', async () => {
    const ref = { repo: 'pat/fresh', branch: 'main' };
    expect((await pm.rpc<{ hasContext: boolean }>('snapshot', ref)).result!.hasContext).toBe(false);
    expect((await pm.rpc('initProduct', ref)).result).toMatchObject({ hasContext: true, findings: [] });
    expect((await pm.rpc<{ changes: number }>('status', ref)).result!.changes).toBe(0);
    expect(h.github.messages('pat/fresh', 'main')).toEqual(['Add the product context', 'Initial commit']);
    for (const f of ['product/product.md', 'product/personas.md', 'product/screens.md', 'product/INSTRUCTIONS.md']) expect(h.github.file('pat/fresh', 'main', f), f).toBeDefined();
    expect(h.github.file('pat/fresh', 'main', 'CLAUDE.md')).toMatch(/^# Rules\n\n<!-- product-context:begin/);
    expect(h.github.file('pat/fresh', 'main', 'AGENTS.md')).toMatch(/^# AGENTS.md\n\n<!-- product-context:begin/);
  });

  it('starts one in a repository with no commits yet', async () => {
    const ref = { repo: 'pat/empty', branch: 'main' };
    expect((await pm.rpc('branches', { repo: 'pat/empty' })).result).toEqual(['main']);
    expect((await pm.rpc<{ hasContext: boolean; name: string }>('snapshot', ref)).result).toMatchObject({ hasContext: false, name: 'empty' });
    await pm.rpc('initProduct', ref);
    expect(h.github.file('pat/empty', 'main', 'product/INSTRUCTIONS.md')).toBeDefined();
    expect(h.github.file('pat/empty', 'main', 'CLAUDE.md')).toContain('<!-- product-context:begin');
  });
});

describe('setting Aligner up', () => {
  it('creates its GitHub app from a manifest, and gives the PM the variables for Railway', async () => {
    const fresh = await startAligner({ headless: false, setUp: false });
    try {
      const pat = client(fresh.url);
      const { result } = await pat.rpc<{ stage: string; github: string; state: string; manifest: string }>('account');
      expect(result).toMatchObject({ stage: 'setup', github: fresh.github.web });
      const manifest = JSON.parse(result!.manifest) as Record<string, unknown>;
      expect(manifest).toMatchObject({
        url: fresh.url, redirect_url: `${fresh.url}/setup/github`, callback_urls: [`${fresh.url}/auth/callback`], setup_url: `${fresh.url}/`,
        public: false, default_permissions: { contents: 'write', metadata: 'read' }, hook_attributes: { active: false },
      });
      // The PM confirms the app on GitHub, which sends them back with a code.
      await pat.go(`${fresh.github.web}/settings/apps/new?state=${result!.state}`, { method: 'POST', body: new URLSearchParams({ manifest: result!.manifest }) });
      const after = await pat.rpc<{ created?: { name: string; variables: string } }>('account');
      const app = fresh.github.app!;
      expect(after.result!.created).toEqual({ name: app.name, variables: `GITHUB_APP_SLUG=${app.slug}\nGITHUB_CLIENT_ID=${app.clientId}\nGITHUB_CLIENT_SECRET=${app.clientSecret}\n` });
      expect(app.name).toBe(`Aligner ${result!.state.slice(0, 6)}`);
    } finally {
      await fresh.close();
    }
  });

  it('refuses a code it did not ask for', async () => {
    const fresh = await startAligner({ headless: false, setUp: false });
    try {
      const pat = client(fresh.url);
      await pat.rpc('account');
      expect(await pat.go(`${fresh.url}/setup/github?code=x&state=forged`)).toMatch(/\/\?error=/);
      expect((await pat.rpc<{ created?: unknown }>('account')).result!.created).toBeUndefined();
    } finally {
      await fresh.close();
    }
  });
});

describe('a new version of Aligner', () => {
  const FORK = { RAILWAY_GIT_REPO_OWNER: 'pat', RAILWAY_GIT_REPO_NAME: 'aligner', RAILWAY_GIT_BRANCH: 'main' };
  const CHANGELOG = '# What\'s new in Aligner\n\n## 99.0.0\n- Comments on flows\n\n## 98.0.0\n- A darker theme\n\n## 0.1.0\n- The first one\n';
  /** An Aligner running from the PM's fork of the original, which has a newer version. */
  const running = async (env: Record<string, string>, ownCommit = false) => {
    const u = await startAligner({ headless: false, env });
    u.github.addRepo('productalignment/aligner', { 'README.md': '# Aligner\n' }, { private: false });
    u.github.addFork('productalignment/aligner', 'pat/aligner');
    u.github.push('productalignment/aligner', 'main', { 'CHANGELOG.md': CHANGELOG }, 'Release 99.0.0'); // the fork is behind
    if (ownCommit) u.github.push('pat/aligner', 'main', { 'notes.md': 'mine\n' });
    const pat = client(u.url);
    await pat.go(`${u.url}/auth/login`);
    return { u, pat };
  };

  it('tells the PM what the newer versions bring, and brings their copy up to date in one click', async () => {
    const { u, pat } = await running(FORK);
    try {
      expect((await pat.rpc<{ update: unknown }>('account')).result!.update).toEqual({ version: '99.0.0', notes: ['Comments on flows', 'A darker theme'], copy: 'pat/aligner' });
      expect((await pat.rpc('update')).error).toBeUndefined();
      expect(u.github.head('pat/aligner', 'main')).toBe(u.github.head('productalignment/aligner', 'main'));
    } finally {
      await u.close();
    }
  });

  it("says why it can't, when the copy has changes of its own", async () => {
    const { u, pat } = await running(FORK, true);
    try {
      expect((await pat.rpc('update')).error).toContain('has changes of its own');
    } finally {
      await u.close();
    }
  });

  it('points to Sync fork on GitHub when the new version changes the checks GitHub runs', async () => {
    const { u, pat } = await running(FORK);
    try {
      u.github.push('productalignment/aligner', 'main', { '.github/workflows/ci.yml': 'on: push\n' }, 'Check every push');
      expect((await pat.rpc('update')).error).toMatch(/checks GitHub runs.*Sync fork/);
      expect(u.github.head('pat/aligner', 'main')).not.toBe(u.github.head('productalignment/aligner', 'main'));
    } finally {
      await u.close();
    }
  });

  it("points to Sync fork on GitHub when it doesn't know which copy it runs from", async () => {
    const { u, pat } = await running({});
    try {
      expect((await pat.rpc<{ update: { copy?: string } }>('account')).result!.update.copy).toBeUndefined();
      expect((await pat.rpc('update')).error).toContain('Sync fork');
    } finally {
      await u.close();
    }
  });

  it('reads versions from the changelog, whose newest is this version', () => {
    const changelog = readFileSync(fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url)), 'utf8');
    expect(releases(changelog)[0]!.version).toBe(VERSION);
    expect(releases(CHANGELOG).map((r) => r.version)).toEqual(['99.0.0', '98.0.0', '0.1.0']);
    expect([newer('0.10.0', '0.9.0'), newer('0.9.0', '0.10.0'), newer('1.0.0', '1.0.0')]).toEqual([true, false, false]);
  });
});

describe('usage statistics', () => {
  it('go to productalignment.org unless the PM turns them off, or sends them elsewhere', () => {
    expect(usageUrl(undefined)).toBe(USAGE_URL);
    expect(usageUrl(' ')).toBe(USAGE_URL);
    for (const off of ['off', 'OFF', 'false', '0', 'no']) expect(usageUrl(off)).toBeNull();
    expect(usageUrl('https://stats.example.com/usage')).toBe('https://stats.example.com/usage');
  });

  it('count an edit for the part of the product it changes', () => {
    expect(partOf({ op: 'modify', id: 'VI-FOR', fields: {} })).toBe('product');
    expect(partOf({ op: 'add', type: 'job', parent: 'PE-001', fields: {} })).toBe('product');
    expect(partOf({ op: 'remove', id: 'FS-104>FS-105' })).toBe('flows');
    expect(partOf({ op: 'add', type: 'screen', on: 'FS-101', fields: {} })).toBe('screens');
    expect(partOf({ op: 'remove', id: 'SC-002@10, 10, 5, 5>SC-003' })).toBe('screens');
  });

  it("tell the makers what PMs do, once a day for opening Aligner and for each part, with nothing that says who they are or what they work on", async () => {
    const got: Record<string, string>[] = [];
    const makers = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => { got.push(JSON.parse(body) as Record<string, string>); res.writeHead(204).end(); });
    });
    await new Promise<void>((r) => makers.listen(0, '127.0.0.1', r));
    const u = await startAligner({ headless: false, repos: { [REPO]: await readFolder(TIDY) }, env: { ALIGNER_USAGE_STATS: `http://127.0.0.1:${(makers.address() as AddressInfo).port}/api/usage` } });
    try {
      const pat = client(u.url);
      await pat.go(`${u.url}/auth/login`);
      expect((await pat.rpc<{ usageStats: boolean }>('account')).result!.usageStats).toBe(true);
      await pat.rpc('account'); // opened again the same day
      await pat.rpc('snapshot', REF);
      await pat.rpc('edit', { ...REF, op: { op: 'modify', id: 'VI-FOR', fields: { text: 'people who share a house' } } });
      await pat.rpc('edit', { ...REF, op: { op: 'modify', id: 'FL-001', fields: { name: 'Tick off a chore' } } });
      await pat.rpc('edit', { ...REF, op: { op: 'modify', id: 'FL-001', fields: { name: 'Finish a chore' } } });
      await pat.rpc('commit', { ...REF, message: 'Houses too' });
      await pat.rpc('commit', REF); // nothing left to commit
      // The coding agent builds it, and pushes the product context it updated.
      u.github.push(REPO, 'main', { 'product/product.md': u.github.file(REPO, 'main', 'product/product.md')!.replace('mobile chore planner', 'chore planner for phones') }, 'Build it');
      await until(async () => { await pat.rpc('status', REF); return got.some((e) => e.event === 'push'); }, 'the push counted');
      await until(() => got.length >= 5, 'all of them sent');
      expect(got.map((e) => e.event).sort()).toEqual(['commit', 'flows', 'open', 'product', 'push']);
      for (const e of got) {
        expect(Object.keys(e).sort()).toEqual(['aligner', 'event', 'pm', 'version']);
        expect(e).toMatchObject({ aligner: got[0]!.aligner, pm: got[0]!.pm, version: VERSION });
      }
      expect(got[0]!.aligner).toMatch(/^[0-9a-f]{16}$/);
      expect(got[0]!.pm).toMatch(/^[0-9a-f]{16}$/);
      const sent = JSON.stringify(got);
      for (const telling of ['pat', 'tidy', 'main', 'house', 'chore', u.github.app!.clientId]) expect(sent.toLowerCase()).not.toContain(telling.toLowerCase());
    } finally {
      await u.close();
      await new Promise<void>((r) => makers.close(() => r()));
    }
  });
});

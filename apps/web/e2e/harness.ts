// Runs the built server (dist/server.js) against a stand-in for GitHub, and drives its page in
// Chromium, signed in as the PM. Used by the e2e tests, the screenshot script and `npm run dev`.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { FakeGitHub } from './github';

const SERVER = fileURLToPath(new URL('../dist/server.js', import.meta.url));

export interface Harness {
  github: FakeGitHub;
  /** Where Aligner runs. */
  url: string;
  browser?: Browser;
  /** A page signed in with GitHub, at `path` (e.g. "/?repo=pat/tidy&branch=main"). */
  open(path?: string, viewport?: { width: number; height: number }): Promise<Page>;
  /**
   * A file as the PM sees it: their draft's, kept in Aligner's data folder, or else the branch's on
   * GitHub. Undefined when there is none.
   */
  file(repo: string, branch: string, path: string): Buffer | undefined;
  /** Stops Aligner and starts it again, on the same port and data folder. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /** Repositories on the stand-in GitHub, with their files. */
  repos?: Record<string, Record<string, string | Uint8Array>>;
  /** False: Aligner has no GitHub app yet, as on its first start. */
  setUp?: boolean;
  /** Start no browser (for `npm run dev`). */
  headless?: false;
  env?: Record<string, string>;
}

/** Runs Aligner until `close()`. */
export async function startAligner(opts: HarnessOptions = {}): Promise<Harness> {
  const github = await FakeGitHub.start();
  for (const [name, files] of Object.entries(opts.repos ?? {})) github.addRepo(name, files);
  const app = opts.setUp === false ? undefined : github.createApp();
  const data = mkdtempSync(join(tmpdir(), 'aligner-data-'));
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '', PORT: '0', GITHUB_URL: github.web, GITHUB_API_URL: github.api, ALIGNER_DATA: data,
    ...(app ? { GITHUB_APP_SLUG: app.slug, GITHUB_CLIENT_ID: app.clientId, GITHUB_CLIENT_SECRET: app.clientSecret } : {}),
    ...opts.env,
  };
  let child: ChildProcess;
  const start = () => new Promise<string>((resolve, reject) => {
    child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString();
      const m = /running on port (\d+)/.exec(out);
      if (m) resolve(m[1]!);
    });
    child.on('exit', (code) => reject(new Error(`Aligner exited with ${code} before it started:\n${out}`)));
  });
  const stop = () => new Promise<void>((r) => { child.once('exit', () => r()); child.kill('SIGTERM'); });
  env.PORT = await start();
  const url = `http://localhost:${env.PORT}`;
  if (app) app.setupUrl = `${url}/`;
  const file = (repo: string, branch: string, path: string) => {
    try {
      const dir = join(data, 'drafts', github.user.login, ...repo.split('/'), encodeURIComponent(branch).replace(/\./g, '%2E'));
      const draft = JSON.parse(readFileSync(join(dir, 'draft.json'), 'utf8')) as { files: Record<string, { sha: string } | null> };
      if (path in draft.files) return draft.files[path] ? readFileSync(join(dir, draft.files[path]!.sha)) : undefined;
    } catch { /* no draft */ }
    return github.bytes(repo, branch, path);
  };
  const restart = async () => { await stop(); await start(); };
  const close = async () => {
    await stop();
    await github.close();
    rmSync(data, { recursive: true, force: true });
  };
  if (opts.headless === false) return { github, url, file, restart, open: () => { throw new Error('No browser'); }, close };
  // Playwright's own Chromium by default; ALIGNER_E2E_CHANNEL=chrome drives the installed Google Chrome instead.
  const browser = await chromium.launch({ channel: process.env.ALIGNER_E2E_CHANNEL || undefined }).catch(async (e: Error) => {
    await close();
    throw e;
  });
  return {
    github,
    url,
    browser,
    file,
    restart,
    async open(path = '/', viewport = { width: 1440, height: 900 }) {
      const page = await browser.newPage({ viewport });
      await page.goto(app ? `${url}/auth/login?to=${encodeURIComponent(path)}` : `${url}${path}`);
      return page;
    },
    async close() {
      await browser.close();
      await close();
    },
  };
}

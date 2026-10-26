// Runs Aligner for working on it: `npm run dev -- [folder…]`. Each folder (by default the example
// and Aligner's own product context) becomes a repository on a stand-in for GitHub, kept in memory:
// edits are committed there, not to the folders.
import { basename, resolve } from 'node:path';
import { readFolder } from '@aligner/core';
import { startAligner } from '../e2e/harness';

const repo = resolve(import.meta.dirname, '../../..');
const cwd = process.env.INIT_CWD ?? process.cwd();
const folders = process.argv.slice(2).map((f) => resolve(cwd, f));
const repos: Record<string, Record<string, Uint8Array>> = {};
for (const dir of folders.length ? folders : [resolve(repo, 'examples/tidy'), repo]) {
  const files = await readFolder(dir);
  // Only what Aligner reads: the product context, and the files at the root.
  repos[`pat/${basename(dir)}`] = Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith('product/') || !p.includes('/')));
}
const h = await startAligner({ repos, headless: false });
const first = Object.keys(repos)[0]!;
console.log(`Aligner is running at ${h.url}\nOpen ${h.url}/auth/login?to=${encodeURIComponent(`/?repo=${first}`)} to sign in as the stand-in GitHub's PM.`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void h.close().finally(() => process.exit(0)));

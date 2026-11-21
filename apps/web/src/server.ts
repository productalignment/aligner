// Aligner's server, as Railway runs it: `node server.js`. Its settings are environment
// variables:
//   PORT                       where to listen (Railway sets it; 8080 otherwise)
//   GITHUB_APP_SLUG,           Aligner's GitHub App, which it creates the first time it runs: the
//   GITHUB_CLIENT_ID,          PM gives these three to Railway once GitHub has created it
//   GITHUB_CLIENT_SECRET
//   RAILWAY_VOLUME_MOUNT_PATH  the volume that keeps the PM's drafts (Railway sets it), or
//   ALIGNER_DATA               another folder for them; without either, drafts last until a restart
//   RAILWAY_GIT_REPO_OWNER,    the repository and branch Aligner runs from (Railway sets them), which
//   RAILWAY_GIT_REPO_NAME,     the Update button brings up to date with the original
//   RAILWAY_GIT_BRANCH
//   GITHUB_URL,                another GitHub than github.com and api.github.com
//   GITHUB_API_URL
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appFromEnv } from './auth.ts';
import { startServer } from './http.ts';
import { Updates } from './updates.ts';

declare const ALIGNER_VERSION: string;

const env = process.env;
const app = appFromEnv(env);
const kept = env.ALIGNER_DATA || env.RAILWAY_VOLUME_MOUNT_PATH;
const copy = env.RAILWAY_GIT_REPO_OWNER && env.RAILWAY_GIT_REPO_NAME
  ? { repo: `${env.RAILWAY_GIT_REPO_OWNER}/${env.RAILWAY_GIT_REPO_NAME}`, branch: env.RAILWAY_GIT_BRANCH || 'main' }
  : undefined;
const server = await startServer({
  app,
  github: { web: env.GITHUB_URL ?? 'https://github.com', api: env.GITHUB_API_URL ?? 'https://api.github.com' },
  data: { dir: kept || join(tmpdir(), 'aligner'), durable: !!kept },
  updates: new Updates(ALIGNER_VERSION, copy),
}, Number(env.PORT ?? 8080));

const port = new URL(server.url).port;
console.log(`Aligner ${ALIGNER_VERSION} is running on port ${port}.${app ? '' : ' Open it to connect it to GitHub.'}${kept ? '' : ' Drafts last until it restarts: give it a volume to keep them.'}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void server.close().finally(() => process.exit(0)));
}

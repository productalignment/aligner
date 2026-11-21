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
//   ALIGNER_USAGE_STATS        off: send Aligner's makers no usage statistics (docs/usage-statistics.md);
//                              a URL: send them there rather than to productalignment.org
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appFromEnv } from './auth.ts';
import { startServer } from './http.ts';
import { Updates } from './updates.ts';
import { Usage, usageUrl } from './usage.ts';

declare const ALIGNER_VERSION: string;

const env = process.env;
const app = appFromEnv(env);
const kept = env.ALIGNER_DATA || env.RAILWAY_VOLUME_MOUNT_PATH;
const copy = env.RAILWAY_GIT_REPO_OWNER && env.RAILWAY_GIT_REPO_NAME
  ? { repo: `${env.RAILWAY_GIT_REPO_OWNER}/${env.RAILWAY_GIT_REPO_NAME}`, branch: env.RAILWAY_GIT_BRANCH || 'main' }
  : undefined;
const statsTo = usageUrl(env.ALIGNER_USAGE_STATS);
const usage = app && statsTo ? new Usage(statsTo, app.clientSecret, ALIGNER_VERSION) : undefined;
const server = await startServer({
  app,
  github: { web: env.GITHUB_URL ?? 'https://github.com', api: env.GITHUB_API_URL ?? 'https://api.github.com' },
  data: { dir: kept || join(tmpdir(), 'aligner'), durable: !!kept },
  updates: new Updates(ALIGNER_VERSION, copy),
  usage,
}, Number(env.PORT ?? 8080));

const port = new URL(server.url).port;
console.log(`Aligner ${ALIGNER_VERSION} is running on port ${port}.${app ? '' : ' Open it to connect it to GitHub.'}${kept ? '' : ' Drafts last until it restarts: give it a volume to keep them.'}${usage ? ' It shares anonymous usage statistics with its makers: ALIGNER_USAGE_STATS=off turns them off.' : ''}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void server.close().finally(() => process.exit(0)));
}

// Bundles the server into one dependency-free file (dist/server.js) and copies the files Aligner
// adds to new products, and its home-screen icon, into dist/assets. The UI is built by Vite into
// dist/ui.html.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const repo = resolve(app, '../..');
const dist = join(app, 'dist');

const { version } = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
await build({
  entryPoints: [join(app, 'src/server.ts')],
  define: { ALIGNER_VERSION: JSON.stringify(version) },
  outfile: join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Some bundled dependencies are CommonJS and call require().
  banner: { js: "import { createRequire as __alignerRequire } from 'node:module'; const require = __alignerRequire(import.meta.url);" },
  logLevel: 'warning',
});

rmSync(join(dist, 'assets'), { recursive: true, force: true });
mkdirSync(join(dist, 'assets'));
for (const [from, to] of [
  ['product/INSTRUCTIONS.md', 'INSTRUCTIONS.md'],
  ['CLAUDE.md', 'CLAUDE.md'],
  ['apps/web/ui/icon.png', 'apple-touch-icon.png'],
]) copyFileSync(join(repo, from), join(dist, 'assets', to));
console.log('built dist/server.js');

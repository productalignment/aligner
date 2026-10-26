// Files Aligner adds to every new product: the instructions for AI agents and the instruction
// block for CLAUDE.md and AGENTS.md; and Aligner's own icon. In the bundle they live in
// dist/assets; from source they come from the repo.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toBytes, toText, type FileChanges, type ProductStore } from '@aligner/core';
import { blobSha } from './drafts.ts';

const here = dirname(fileURLToPath(import.meta.url));

function read(bundled: string, fromRepo: string): Buffer {
  const a = join(here, 'assets', bundled);
  return readFileSync(existsSync(a) ? a : join(here, '../../..', fromRepo));
}

/** The icon an iPhone gives Aligner on its home screen: it asks the server for /apple-touch-icon.png. */
export const touchIcon = () => read('apple-touch-icon.png', 'apps/web/ui/icon.png');

export const BLOCK_BEGIN = '<!-- product-context:begin';
const BLOCK_END = '<!-- product-context:end -->';

/** The agent instruction block, cut from this repo's own CLAUDE.md. */
export function instructionBlock(): string {
  return blockIn(read('CLAUDE.md', 'CLAUDE.md').toString())! + '\n';
}

/** New files for a product (never overwrites), and blocks appended to agent files that lack them. */
export function contextExtras(): { files: Record<string, string>; blocks: Record<string, string> } {
  const block = instructionBlock();
  return {
    files: { 'product/INSTRUCTIONS.md': read('INSTRUCTIONS.md', 'product/INSTRUCTIONS.md').toString() },
    blocks: { 'CLAUDE.md': block, 'AGENTS.md': block },
  };
}

/**
 * The git blob SHA of every product/INSTRUCTIONS.md and instruction block (from its begin marker to
 * its end marker) Aligner has shipped, the current ones included: a test keeps them in step. A file
 * or block still the same as one of them is Aligner's own, which it brings up to date; one changed
 * by hand, or newer than this Aligner, stays as it is.
 */
export const SHIPPED = new Set([
  // product/INSTRUCTIONS.md
  '04269aea70873adcd6b6f147a65579f53da416b5', '54c73cb2279c3c8c3a25841c75c2c147b4ee02c9', '5ea3a30356d475033fb02e3eef49181f440d32a4',
  '6c3e5d261443f8a16b626cc99c2e1531acfa1cb6', '918829a1fd5d9ad5657a6b8cc71718d614003693', '92937622c899ae3769fe2bc2d1e5fb1cce1be34b',
  'c125d5ed25e8577c91be0223b012ea16e27e9548', 'da3294a059e754b58f1094ec61e8ffc7e8039ea4', 'e209150165ad58039f25227f3e59a1e5bd2197ac',
  'f1fe8c21bb2f2ff6405b72da9f4cc2ac83ab5e1e', 'ff31a63336fce88cb6be53a8ac062a1af39a4d93', '2db2cfd55d5b8b8fba0806f01f32e5c0bdbaa3ec',
  'd4a91a0be9b5eb027d509eadb1a479d209e771e2', '7ff5339f43651a9fc3cc9eeb1ae791e608171630',
  // the instruction block
  '07a600bbca70e2a6476e41ec1f5e6d52863a7766', '83458d0b165a90d85800ca738417eb83e3104eb8', '9916d3ef285cbbb299be87a16f9084c30b701e3b',
  'bdbbd01b8c8b7af22badaa39f922fa62feacf94a', 'ce78d4e5219e186adcb34ed860ff976975409d16', 'f6aa4985f811a30a69404e191f6083aeebd6282c',
  '07a5d64cd250f21b309965e7199619d833b8bd9f',
]);

/** The instruction block in an agent file, from its begin marker to its end marker; null when it has none. */
export function blockIn(text: string): string | null {
  const begin = text.indexOf(BLOCK_BEGIN);
  const end = text.indexOf(BLOCK_END, begin);
  return begin < 0 || end < 0 ? null : text.slice(begin, end + BLOCK_END.length);
}

/**
 * Brings the files Aligner installed in a product up to date in the PM's draft, where they are an
 * older version Aligner shipped: product/INSTRUCTIONS.md, and the instruction block in CLAUDE.md and
 * AGENTS.md. It runs as the PM commits, so the coding agent reads the rules for what this
 * Aligner writes. Returns whether it changed anything.
 */
export function updateExtras(store: ProductStore, shipped = SHIPPED): Promise<boolean> {
  return store.exclusive(async () => {
    const { files, blocks } = contextExtras();
    const changes: FileChanges = new Map();
    for (const [path, text] of Object.entries(files)) {
      const data = await store.read(path);
      if (data && toText(data) !== text && shipped.has(blobSha(data))) changes.set(path, text);
    }
    for (const [path, block] of Object.entries(blocks)) {
      const data = await store.read(path);
      const text = data ? toText(data) : '';
      const old = blockIn(text);
      const now = blockIn(block)!;
      if (old && old !== now && shipped.has(blobSha(toBytes(old)))) changes.set(path, text.replace(old, now));
    }
    if (changes.size) await store.write(changes, 'update the instructions for the coding agent');
    return changes.size > 0;
  });
}

/** The built single-file UI (dist/ui.html). */
export function uiHtml(): string {
  for (const p of [join(here, 'ui.html'), join(here, '../dist/ui.html')]) if (existsSync(p)) return readFileSync(p, 'utf8');
  throw new Error('The Aligner UI is not built. Run `npm run build -w aligner`.');
}

// Aligner keeps the instructions it installed in a product up to date: an older version it
// shipped is replaced as the PM commits; one changed by hand, or a newer one, stays as it is.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MemoryStore, toBytes } from '@aligner/core';
import { blobSha } from '../src/drafts';
import { SHIPPED, blockIn, contextExtras, updateExtras } from '../src/extras';

const repoFile = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

describe("the coding agent's instructions in a product", () => {
  it('knows the INSTRUCTIONS.md and instruction block it ships now, the same in CLAUDE.md and AGENTS.md', () => {
    expect(SHIPPED.has(blobSha(toBytes(repoFile('product/INSTRUCTIONS.md'))))).toBe(true);
    expect(SHIPPED.has(blobSha(toBytes(blockIn(repoFile('CLAUDE.md'))!)))).toBe(true);
    expect(blockIn(repoFile('AGENTS.md'))).toBe(blockIn(repoFile('CLAUDE.md')));
  });

  it('brings an older version it shipped up to date in the draft, and leaves one changed by hand', async () => {
    const { files, blocks } = contextExtras();
    const oldRules = '# Product context: format and rules\n\nOlder rules.\n';
    const oldBlock = '<!-- product-context:begin (installed by Aligner) -->\nOlder block.\n<!-- product-context:end -->';
    const store = new MemoryStore({
      'product/INSTRUCTIONS.md': oldRules,
      'CLAUDE.md': `# Rules\n\nOur own rules.\n\n${oldBlock}\n\nMore of our own.\n`,
      'AGENTS.md': '# AGENTS.md\n\n<!-- product-context:begin -->\nOur own block.\n<!-- product-context:end -->\n',
    });
    const shipped = new Set([blobSha(toBytes(oldRules)), blobSha(toBytes(oldBlock))]);
    expect(await updateExtras(store, shipped)).toBe(true);
    expect(store.text('product/INSTRUCTIONS.md')).toBe(files['product/INSTRUCTIONS.md']);
    expect(store.text('CLAUDE.md')).toBe(`# Rules\n\nOur own rules.\n\n${blockIn(blocks['CLAUDE.md']!)}\n\nMore of our own.\n`);
    expect(store.text('AGENTS.md')).toContain('Our own block.');
    expect(store.notes).toEqual(['update the instructions for the coding agent']);
    expect(await updateExtras(store, shipped)).toBe(false);
  });

  it('adds none to a product that has none', async () => {
    const store = new MemoryStore({ 'product/product.md': '# Product\n' });
    expect(await updateExtras(store)).toBe(false);
    expect([...store.files.keys()]).toEqual(['product/product.md']);
  });
});

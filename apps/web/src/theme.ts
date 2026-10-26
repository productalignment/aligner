// How the product looks, read from its code, so mockups are drawn in its colours, fonts
// and icons: colour and font tokens from its CSS (Tailwind v4 `@theme`, `:root` variables) or its
// Tailwind config, the Google Fonts its pages load, and the lucide icons it imports. The code comes
// from the branch's archive on GitHub.
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { ProductTheme } from '@aligner/core';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', 'vendor', 'product']);
const STYLE = new Set(['.css', '.scss', '.sass', '.less', '.pcss']);
const CODE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte', '.astro']);
const MAX_FILES = 4000;
const MAX_BYTES = 512 * 1024;

export interface SourceFile { path: string; text: string }

const extname = (name: string) => /.(\.[^./]+)$/.exec(name)?.[1] ?? '';

/** Whether a file of the repository is worth reading for its look: styles, code, Tailwind configs and HTML pages. */
export function isThemeFile(path: string, size: number): boolean {
  const parts = path.split('/');
  const name = parts.at(-1)!;
  if (parts.length > 9 || size > MAX_BYTES) return false;
  if (parts.some((p) => (p.startsWith('.') && p !== '.storybook') || SKIP.has(p))) return false;
  const ext = extname(name);
  return STYLE.has(ext) || CODE.has(ext) || name.endsWith('.html');
}

const COLOUR = /^(#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^)]*\))$/i;
const firstFamily = (list: string) => list.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '');
const GENERIC = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'inherit', 'cursive']);

export function readTheme(files: SourceFile[]): ProductTheme {
  const colours = new Map<string, string>(); // value → name
  const fonts: string[] = [];
  const fontLinks = new Set<string>();
  const icons = new Set<string>();
  const addFont = (list: string, first = false) => {
    const f = firstFamily(list);
    if (!f || f.startsWith('var(') || GENERIC.has(f.toLowerCase()) || fonts.includes(f)) return;
    if (first) fonts.unshift(f); else fonts.push(f);
  };

  for (const { path, text } of files) {
    const ext = extname(path.split('/').at(-1)!);
    if (STYLE.has(ext) || path.endsWith('.html')) {
      for (const m of text.matchAll(/--(?:color-)?([\w-]+)\s*:\s*([^;}\n]+)/g)) {
        const value = m[2]!.trim();
        if (m[0].startsWith('--font-')) addFont(value);
        else if (COLOUR.test(value) && !colours.has(value.toLowerCase())) colours.set(value.toLowerCase(), m[1]!);
      }
      for (const m of text.matchAll(/(?:^|[\s{;])(?:body|html|:root)\s*\{[^}]*?font-family\s*:\s*([^;}]+)/g)) addFont(m[1]!, true);
      for (const m of text.matchAll(/https:\/\/fonts\.googleapis\.com\/css2?\?[^"')\s]+/g)) fontLinks.add(m[0].replace(/&amp;/g, '&'));
    }
    if (/tailwind\.config\.\w+$/.test(path)) {
      for (const m of text.matchAll(/['"]?([\w-]+)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]/g)) if (!colours.has(m[2]!.toLowerCase())) colours.set(m[2]!.toLowerCase(), m[1]!);
      for (const m of text.matchAll(/(sans|serif|display|heading|body)\s*:\s*\[\s*['"]([^'"]+)['"]/g)) addFont(m[2]!, m[1] === 'sans' || m[1] === 'body');
    }
    if (CODE.has(ext)) {
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-(?:react|vue-next|vue|svelte|solid|angular|preact)['"]/g)) {
        for (const part of m[1]!.split(',')) {
          const name = part.trim().split(/\s+as\s+/)[0]!.replace(/^type\s+/, '').trim();
          if (/^[A-Z]\w*$/.test(name) && name !== 'LucideIcon' && name !== 'LucideProps') icons.add(name.replace(/^Lucide(?=[A-Z])/, '').replace(/Icon$/, ''));
        }
      }
    }
  }
  return {
    colours: [...colours].map(([value, name]) => ({ name: name.replace(/^color-/, ''), value })),
    fonts,
    fontLinks: [...fontLinks],
    icons: [...icons].sort(),
  };
}

/**
 * The files of a gzipped tar archive that `want` asks for, as text, read as it streams in. GitHub's
 * archives put every path under one folder (`owner-repo-sha/`), which is left out.
 */
export async function untar(gzipped: ReadableStream<Uint8Array>, want: (path: string, size: number) => boolean = isThemeFile): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  const stream = Readable.fromWeb(gzipped as import('node:stream/web').ReadableStream<Uint8Array>).pipe(createGunzip());
  let buf: Buffer = Buffer.alloc(0);
  let skip = 0; // bytes of an entry left out, still to pass
  let take: { kind: string; path: string; size: number; padded: number } | undefined;
  let longName: string | undefined; // from a pax ('x') or GNU ('L') header, for the next entry
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (skip) {
        const n = Math.min(skip, buf.length);
        skip -= n;
        buf = buf.subarray(n);
        if (skip) break;
      }
      if (take) {
        if (buf.length < take.padded) break;
        const data = buf.subarray(0, take.size).toString('utf8');
        if (take.kind === 'x') longName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data)?.[1];
        else if (take.kind === 'L') longName = data.replace(/\0.*$/s, '');
        else out.push({ path: take.path, text: data });
        buf = buf.subarray(take.padded);
        take = undefined;
        continue;
      }
      if (buf.length < 512) break;
      const header = buf.subarray(0, 512);
      buf = buf.subarray(512);
      if (header.every((b) => b === 0)) continue;
      const field = (at: number, len: number) => header.subarray(at, at + len).toString('utf8').replace(/\0.*$/s, '');
      const size = parseInt(field(124, 12).trim() || '0', 8);
      const type = String.fromCharCode(header[156]!);
      const prefix = field(345, 155);
      const path = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
      const padded = Math.ceil(size / 512) * 512;
      if (type !== 'x' && type !== 'L') longName = undefined;
      const rel = path.split('/').slice(1).join('/');
      if (type === 'x' || type === 'L') take = { kind: type, path, size, padded };
      else if ((type === '0' || type === '\0') && rel && out.length < MAX_FILES && want(rel, size)) take = { kind: 'file', path: rel, size, padded };
      else skip = padded;
    }
  }
  return out;
}

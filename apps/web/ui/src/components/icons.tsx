// The icons a mockup can use: lucide's, the set most apps' code imports. The product's own
// come first; the rest are found by name.
import { icons } from 'lucide';
import { createElement, type SVGProps } from 'react';

type IconNode = [tag: string, attrs: Record<string, string | number>][];
const NODES = icons as unknown as Record<string, IconNode>;

/** Every icon once (aliases share their icon's drawing), by name. */
export const ICON_NAMES: string[] = (() => {
  const seen = new Set<IconNode>();
  return Object.keys(NODES).filter((n) => {
    const node = NODES[n]!;
    if (!Array.isArray(node) || seen.has(node)) return false;
    seen.add(node);
    return true;
  });
})();

export const hasIcon = (name: string) => Array.isArray(NODES[name]);

const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

/** Icons whose name matches the query, best first: whole words, then the start of a word, then the letters in order. */
export function searchIcons(query: string, first: string[]): string[] {
  const own = first.filter(hasIcon);
  const q = query.trim().toLowerCase();
  if (!q) return [...own, ...ICON_NAMES.filter((n) => !own.includes(n))];
  const score = (name: string) => {
    const w = words(name);
    const flat = w.replace(/ /g, '');
    if (w === q || flat === q) return 0;
    if (w.startsWith(q) || flat.startsWith(q)) return 1;
    if (w.includes(` ${q}`)) return 2;
    if (flat.includes(q.replace(/ /g, ''))) return 3;
    let i = 0;
    for (const c of flat) if (c === q[i]) i++;
    return i === q.replace(/ /g, '').length ? 4 : -1;
  };
  return [...new Set([...own, ...ICON_NAMES])]
    .map((n) => ({ n, s: score(n) - (own.includes(n) ? 0.5 : 0) }))
    .filter((x) => x.s > -1)
    .sort((a, b) => a.s - b.s || a.n.length - b.n.length)
    .map((x) => x.n);
}

const ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** An icon as an SVG file, for painting it into the mockup picture. */
export function iconSvg(name: string, colour: string): string {
  const body = (NODES[name] ?? []).map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg ${ATTRS} stroke="${colour}">${body}</svg>`;
}

/** An icon drawn inside an SVG, in the box it's given. */
export function IconGlyph({ name, colour, ...box }: { name: string; colour: string } & Pick<SVGProps<SVGSVGElement>, 'x' | 'y' | 'width' | 'height' | 'className'>) {
  return (
    <svg {...box} viewBox="0 0 24 24" fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" overflow="visible">
      {(NODES[name] ?? []).map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

/** GitHub's mark, for signing in and connecting to GitHub. */
export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

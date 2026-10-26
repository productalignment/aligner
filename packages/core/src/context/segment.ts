// Context-free segmentation of a product context markdown file into line groups.
// Concatenating every segment's `raw` always reproduces the input exactly.

export interface RawField { key: string; value: string; line: number }

interface SegBase { raw: string; line: number /* 1-based line of the first line */ }
export type Seg =
  | (SegBase & { kind: 'frontmatter'; body: string[] })
  | (SegBase & { kind: 'comment' })
  | (SegBase & { kind: 'blank' })
  | (SegBase & { kind: 'heading'; level: number; text: string })
  | (SegBase & { kind: 'block'; level: number; id: string; name?: string; fields: RawField[]; listKey?: string })
  | (SegBase & { kind: 'fields'; fields: RawField[] })
  | (SegBase & { kind: 'leaf'; indent: 0 | 1; id: string; text: string; fields: RawField[] })
  | (SegBase & { kind: 'connection'; from: string; to: string; label?: string })
  | (SegBase & { kind: 'link'; box: string; to: string; label?: string })
  | (SegBase & { kind: 'invalid'; reason: string });

const HEADING = /^(#{1,6}) (.*)$/;
const BLOCK_HEAD = /^([A-Z]{2}-\d{3,})(?: (.+))?$/;
const FIELD0 = /^- ([a-z][a-z ]*[a-z]|[a-z]):(?: (.*))?$/;
const FIELD1 = /^ {2}- ([a-z][a-z ]*[a-z]|[a-z]): (.*)$/;
const LEAF0 = /^- ([A-Z]{2}-\d{3,}): (.*)$/;
const LEAF1 = /^ {2}- ([A-Z]{2}-\d{3,}): (.*)$/;
const CONNECTION = /^- (FS-\d{3,}) -> (FS-\d{3,})(?:: (.*))?$/;
/** A click zone and the screen it opens: "- 6.7, 67.2, 86.7, 8.1 -> SC-003: label". The checks read the numbers. */
const LINK = /^- ([\d.]+(?: *, *[\d.]+)*) -> ([A-Z]{2}-\d{3,})(?:: (.*))?$/;

/** Splits text into lines, each keeping its own line terminator. */
export function splitLines(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

const strip = (line: string) => line.replace(/\r?\n$/, '');

export function segment(text: string): Seg[] {
  const lines = splitLines(text);
  const segs: Seg[] = [];
  let i = 0;

  const take = (from: number, to: number) => lines.slice(from, to).join('');

  if (lines.length > 0 && strip(lines[0]!) === '---') {
    let j = 1;
    while (j < lines.length && strip(lines[j]!) !== '---') j++;
    if (j < lines.length) {
      segs.push({ kind: 'frontmatter', raw: take(0, j + 1), line: 1, body: lines.slice(1, j).map(strip) });
      i = j + 1;
    }
  }

  while (i < lines.length) {
    const start = i;
    const l = strip(lines[i]!);
    const lineNo = i + 1;

    if (l.trim() === '') {
      segs.push({ kind: 'blank', raw: lines[i]!, line: lineNo });
      i++;
      continue;
    }

    if (l.startsWith('<!--')) {
      while (i < lines.length && !strip(lines[i]!).includes('-->')) i++;
      const closed = i < lines.length;
      i = Math.min(i + 1, lines.length);
      // An unclosed comment would silently hide the rest of the file.
      segs.push(closed
        ? { kind: 'comment', raw: take(start, i), line: lineNo }
        : { kind: 'invalid', raw: take(start, i), line: lineNo, reason: 'Comment is not closed with "-->"' });
      continue;
    }

    const h = HEADING.exec(l);
    if (h) {
      const level = h[1]!.length;
      const rest = h[2]!.trim();
      i++;
      if (level > 3) {
        segs.push({ kind: 'invalid', raw: take(start, i), line: lineNo, reason: 'Headings deeper than ### are not allowed' });
        continue;
      }
      const b = BLOCK_HEAD.exec(rest);
      if (!b) {
        segs.push({ kind: 'heading', raw: take(start, i), line: lineNo, level, text: rest });
        continue;
      }
      const fields: RawField[] = [];
      let listKey: string | undefined;
      while (i < lines.length) {
        const f = FIELD0.exec(strip(lines[i]!));
        if (!f) break;
        const value = (f[2] ?? '').trim();
        i++;
        if (value === '') {
          listKey = f[1]!;
          break;
        }
        fields.push({ key: f[1]!, value, line: i });
      }
      const name = b[2]?.trim();
      segs.push({
        kind: 'block', raw: take(start, i), line: lineNo, level, id: b[1]!, fields,
        ...(name ? { name } : {}), ...(listKey ? { listKey } : {}),
      });
      continue;
    }

    const c = CONNECTION.exec(l);
    if (c) {
      i++;
      const label = c[3]?.trim();
      segs.push({ kind: 'connection', raw: take(start, i), line: lineNo, from: c[1]!, to: c[2]!, ...(label ? { label } : {}) });
      continue;
    }

    const k = LINK.exec(l);
    if (k) {
      i++;
      const label = k[3]?.trim();
      segs.push({ kind: 'link', raw: take(start, i), line: lineNo, box: k[1]!.trim(), to: k[2]!, ...(label ? { label } : {}) });
      continue;
    }

    const leaf0 = LEAF0.exec(l);
    if (leaf0) {
      i++;
      const fields: RawField[] = [];
      while (i < lines.length) {
        const f = FIELD1.exec(strip(lines[i]!));
        if (!f) break;
        i++;
        fields.push({ key: f[1]!, value: f[2]!.trim(), line: i });
      }
      segs.push({ kind: 'leaf', raw: take(start, i), line: lineNo, indent: 0, id: leaf0[1]!, text: leaf0[2]!.trim(), fields });
      continue;
    }

    const leaf1 = LEAF1.exec(l);
    if (leaf1) {
      i++;
      segs.push({ kind: 'leaf', raw: take(start, i), line: lineNo, indent: 1, id: leaf1[1]!, text: leaf1[2]!.trim(), fields: [] });
      continue;
    }

    if (FIELD0.test(l)) {
      const fields: RawField[] = [];
      while (i < lines.length) {
        const f = FIELD0.exec(strip(lines[i]!));
        if (!f || (f[2] ?? '').trim() === '') break;
        i++;
        fields.push({ key: f[1]!, value: f[2]!.trim(), line: i });
      }
      if (fields.length === 0) {
        i++;
        segs.push({ kind: 'invalid', raw: take(start, i), line: lineNo, reason: 'List field outside an item' });
      } else {
        segs.push({ kind: 'fields', raw: take(start, i), line: lineNo, fields });
      }
      continue;
    }

    i++;
    segs.push({ kind: 'invalid', raw: take(start, i), line: lineNo, reason: 'Line does not match the product context grammar' });
  }
  return segs;
}

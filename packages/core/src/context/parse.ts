// Interprets a segmented file against its FileDef, producing an item tree (product/INSTRUCTIONS.md).
import { segment, type RawField, type Seg } from './segment.ts';
import { FILES, ID_RE, PREFIX_TO_TYPE, STEP_TYPE_SET, TYPES, VISION_FIELDS, linkId, type FieldDef, type SectionDef } from './spec.ts';
import type { Finding, ItemType } from './types.ts';

export interface Node {
  kind: 'title' | 'section' | 'item' | 'vision';
  seg: number;
  parent: Node | null;
  children: Node[];
  /** section nodes */
  section?: SectionDef;
  /** item nodes */
  type?: ItemType;
  id?: string;
  fields?: Record<string, unknown>;
}

export interface ParsedDoc {
  path: string;
  fileKey: string;
  text: string;
  segs: Seg[];
  root: Node;
  items: Map<string, Node>;
  errors: Finding[];
}

export function parseDoc(path: string, fileKey: string, text: string): ParsedDoc {
  const def = FILES[fileKey]!;
  const segs = segment(text);
  const root: Node = { kind: 'title', seg: -1, parent: null, children: [] };
  const items = new Map<string, Node>();
  const errors: Finding[] = [];
  const err = (line: number, message: string, itemIds: string[] = []) =>
    errors.push({ code: 'E-PARSE', severity: 'error', message, items: itemIds, file: path, line });

  if (text.includes('\r')) err(1, 'Use LF line endings');
  if (text.length > 0 && !text.endsWith('\n')) err(text.split('\n').length, 'File must end with a newline');

  // Context while walking.
  let titleSeen = false;
  let titleItem: Node | null = null;
  let listType: ItemType | 'vision' | undefined = def.rootType; // item type allowed at this point
  let container: Node = root; // where new items attach
  let sectionIdx = -1;
  let block: Node | null = null; // current root block item (a persona, a screen)
  let childIdx = -1;

  const addItem = (node: Node, parentNode: Node) => {
    node.parent = parentNode;
    parentNode.children.push(node);
    if (node.id) {
      if (items.has(node.id)) {
        errors.push({ code: 'E-DUP-ID', severity: 'error', message: `Duplicate ID ${node.id}`, items: [node.id], file: path, line: segs[node.seg]!.line });
      } else items.set(node.id, node);
    }
  };

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s.kind === 'blank' || s.kind === 'comment') continue;
    if (s.kind === 'frontmatter') { err(s.line, 'Remove the frontmatter: product context files have none'); continue; }
    if (s.kind === 'invalid') { err(s.line, s.reason); continue; }

    if (!titleSeen) {
      titleSeen = true;
      if (typeof def.title === 'string') {
        if (s.kind !== 'heading' || s.level !== 1 || s.text !== def.title) err(s.line, `Expected title "# ${def.title}"`);
        else { root.seg = i; continue; }
      } else if (s.kind === 'block' && s.level === 1 && TYPES[def.title.type as keyof typeof TYPES].prefix === s.id.slice(0, 2)) {
        root.seg = i;
        titleItem = itemNode(s, i, def.title.type, err);
        addItem(titleItem, root);
        container = titleItem;
        listType = undefined;
        continue;
      } else {
        err(s.line, 'Expected the flow heading "# FL-nnn <name>"');
      }
    }

    if (s.kind === 'heading') {
      if (s.level === 2 && def.sections) {
        const idx = def.sections.findIndex((d) => d.heading === s.text);
        if (idx < 0) { err(s.line, `Unknown section "${s.text}"`); continue; }
        if (idx <= sectionIdx) { err(s.line, `Section "${s.text}" is out of order or repeated`); continue; }
        sectionIdx = idx;
        const node: Node = { kind: 'section', seg: i, parent: null, children: [], section: def.sections[idx]! };
        addItem(node, titleItem ?? root);
        container = node;
        listType = def.sections[idx]!.type;
        block = null;
        continue;
      }
      if (s.level === 3 && def.childSections && block) {
        const idx = def.childSections.findIndex((d) => d.heading === s.text);
        if (idx < 0) { err(s.line, `Unknown section "${s.text}"`); continue; }
        if (idx <= childIdx) { err(s.line, `Section "${s.text}" is out of order or repeated`); continue; }
        childIdx = idx;
        const node: Node = { kind: 'section', seg: i, parent: null, children: [], section: def.childSections[idx]! };
        addItem(node, block);
        container = node;
        listType = def.childSections[idx]!.type;
        continue;
      }
      err(s.line, `Unexpected heading "${s.text}"`);
      continue;
    }

    if (s.kind === 'fields') {
      if (listType === 'vision' && container.kind === 'section') {
        const node: Node = { kind: 'vision', seg: i, parent: null, children: [], fields: visionFields(s.fields, err) };
        addItem(node, container);
        listType = undefined; // only one vision block
      } else err(s.line, 'Field lines must directly follow an item');
      continue;
    }

    if (s.kind === 'block') {
      const type = PREFIX_TO_TYPE[s.id.slice(0, 2)];
      const td = type ? TYPES[type as keyof typeof TYPES] : undefined;
      if (!type || !td || td.form !== 'block' || def.rootType !== type || td.level !== s.level) {
        err(s.line, `${s.id} is not allowed here`, [s.id]);
        continue;
      }
      if (s.listKey) err(s.line, `Field "${s.listKey}" needs a value`, [s.id]);
      const node = itemNode(s, i, type, err);
      addItem(node, root);
      block = node; childIdx = -1; container = node;
      listType = undefined;
      continue;
    }

    if (s.kind === 'leaf') {
      const type = PREFIX_TO_TYPE[s.id.slice(0, 2)];
      const td = type ? TYPES[type as keyof typeof TYPES] : undefined;
      const expectedForm = type === 'step' ? 'step' : 'leaf';
      if (!type || !td || td.form !== expectedForm || listType !== type || s.indent !== 0) {
        err(s.line, `${s.id} is not allowed here`, [s.id]);
        continue;
      }
      addItem(itemNode(s, i, type, err), container);
      continue;
    }

    if (s.kind === 'connection') {
      if (listType !== 'connection') { err(s.line, 'Connection is not allowed here'); continue; }
      const id = `${s.from}>${s.to}`;
      const node: Node = {
        kind: 'item', seg: i, parent: null, children: [], type: 'connection', id,
        fields: { from: s.from, to: s.to, ...(s.label ? { label: s.label } : {}) },
      };
      addItem(node, container);
      continue;
    }

    if (s.kind === 'link') {
      if (listType !== 'link' || !block) { err(s.line, 'Link is not allowed here'); continue; }
      const id = linkId(block.id!, s.box, s.to);
      const node: Node = {
        kind: 'item', seg: i, parent: container, children: [], type: 'link', id,
        fields: { box: s.box, to: s.to, ...(s.label ? { label: s.label } : {}) },
      };
      // The same zone and screen again: an error, and the line stays in the file, under its screen.
      if (items.has(id)) { err(s.line, `${block.id} lists the click zone ${s.box} -> ${s.to} twice`, [block.id!]); container.children.push(node); continue; }
      addItem(node, container);
      continue;
    }
  }

  if (!titleSeen && text.trim() !== '') err(1, 'Missing title');
  return { path, fileKey, text, segs, root, items, errors };
}

function itemNode(s: Extract<Seg, { kind: 'block' | 'leaf' }>, seg: number, type: ItemType, err: (line: number, m: string, ids?: string[]) => void): Node {
  const td = TYPES[type as keyof typeof TYPES];
  const fields: Record<string, unknown> = {};
  if (s.kind === 'block') {
    if (s.name) fields.name = s.name;
  } else if (type === 'step') {
    // The label may be empty: a shape the PM placed on the canvas and hasn't named yet.
    const m = /^\[([a-z-]+)\](?: (.*))?$/.exec(s.text);
    if (!m || !STEP_TYPE_SET.has(m[1]!)) err(s.line, `${s.id} must be "- FS-nnn: [<step type>] <label>"`, [s.id]);
    else { fields.step_type = m[1]; fields.label = (m[2] ?? '').trim(); }
  } else {
    fields.text = s.text;
  }
  readFields(s.fields, td.fields, fields, s.id, err);
  for (const f of td.fields) if (f.kind === 'ids' && f.alwaysList && fields[f.prop] === undefined) fields[f.prop] = [];
  return { kind: 'item', seg, parent: null, children: [], type, id: s.id, fields };
}

function readFields(raw: RawField[], defs: FieldDef[], out: Record<string, unknown>, id: string, err: (line: number, m: string, ids?: string[]) => void) {
  let lastIdx = -1;
  const seen = new Set<string>();
  for (const f of raw) {
    const idx = defs.findIndex((d) => d.key === f.key);
    const def = defs[idx];
    if (!def) { err(f.line, `Unknown field "${f.key}" on ${id}`, [id]); continue; }
    if (seen.has(f.key)) { err(f.line, `Field "${f.key}" repeated on ${id}`, [id]); continue; }
    if (idx < lastIdx) err(f.line, `Field "${f.key}" is out of order on ${id}`, [id]);
    seen.add(f.key);
    lastIdx = Math.max(lastIdx, idx);
    switch (def.kind) {
      case 'text': out[def.prop] = f.value; break;
      case 'id':
        if (!ID_RE.test(f.value)) err(f.line, `"${f.key}" must be one ID`, [id]);
        out[def.prop] = f.value;
        break;
      case 'ids': {
        const list = f.value.split(',').map((v) => v.trim()).filter(Boolean);
        if (list.some((v) => !ID_RE.test(v))) err(f.line, `"${f.key}" must be IDs separated by ", "`, [id]);
        out[def.prop] = list;
        break;
      }
    }
  }
}

function visionFields(raw: RawField[], err: (line: number, m: string) => void): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let lastIdx = -1;
  for (const f of raw) {
    const idx = VISION_FIELDS.findIndex((v) => v.key === f.key);
    if (idx < 0) { err(f.line, `Unknown vision field "${f.key}"`); continue; }
    if (idx <= lastIdx) err(f.line, `Vision field "${f.key}" is out of order or repeated`);
    lastIdx = Math.max(lastIdx, idx);
    out[VISION_FIELDS[idx]!.prop] = f.value;
  }
  return out;
}

/** Index of the last segment belonging to a node's subtree. */
export function subtreeEnd(node: Node): number {
  let end = node.seg;
  for (const c of node.children) end = Math.max(end, subtreeEnd(c));
  return end;
}

/** First segment of a node including the comments directly attached above it. */
export function subtreeStart(doc: ParsedDoc, node: Node): number {
  let start = node.seg;
  while (start > 0 && doc.segs[start - 1]!.kind === 'comment') start--;
  return start;
}

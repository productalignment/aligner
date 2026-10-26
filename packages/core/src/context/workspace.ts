// In-memory product context with span-preserving edits.
// Every edit rewrites only the bytes of the items it touches, then re-parses that file.
import { assemble } from './model.ts';
import { parseDoc, subtreeEnd, subtreeStart, type Node, type ParsedDoc } from './parse.ts';
import { renderFile, renderOwn, renderVision } from './render.ts';
import { FILE_PATHS, FILES, FLOW_DIR, TYPES, VISION_FIELDS, flowPath, type SectionDef } from './spec.ts';
import { emptyModel, type Finding, type ItemType, type Model, type Prefix } from './types.ts';

type Fields = Record<string, unknown>;
export interface Position { parent?: string; after?: string | null }

const PATH_TO_KEY: Record<string, string> = Object.fromEntries(Object.entries(FILE_PATHS).map(([k, p]) => [p, k]));
const FLOW_FILE = new RegExp(`^${FLOW_DIR}/[^/]+\\.md$`);

export function fileKeyFor(path: string): string | undefined {
  return PATH_TO_KEY[path] ?? (FLOW_FILE.test(path) ? 'flow' : undefined);
}

/** Where items of each type live. */
const HOME: Record<Exclude<ItemType, 'vision_field' | 'flow'>, { fileKey: string; section?: string; childOf?: ItemType }> = {
  out_of_scope: { fileKey: 'product', section: 'Out of scope' },
  constraint: { fileKey: 'product', section: 'Constraints' },
  persona: { fileKey: 'personas' },
  job: { fileKey: 'personas', section: 'Jobs', childOf: 'persona' },
  step: { fileKey: 'flow', section: 'Steps', childOf: 'flow' },
  connection: { fileKey: 'flow', section: 'Connections', childOf: 'flow' },
  screen: { fileKey: 'screens' },
  link: { fileKey: 'screens', section: 'Links', childOf: 'screen' },
};

export class Workspace {
  readonly docs = new Map<string, ParsedDoc>();
  private readonly original = new Map<string, string>();
  private readonly deleted = new Set<string>();
  private cached: Model | undefined;

  constructor(files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) {
      const key = fileKeyFor(path);
      if (!key) continue;
      this.original.set(path, text);
      this.docs.set(path, parseDoc(path, key, text));
    }
  }

  get model(): Model {
    return (this.cached ??= assemble(this.docs.values()));
  }

  /** Parse errors plus file-level structure errors. */
  get parseErrors(): Finding[] {
    const out: Finding[] = [];
    for (const doc of this.docs.values()) {
      out.push(...doc.errors);
      if (doc.fileKey === 'flow') {
        const flow = doc.root.children.find((c) => c.type === 'flow');
        if (flow && doc.path !== flowPath(flow.id!)) {
          out.push({ code: 'E-PARSE', severity: 'error', message: `Flow file must be named ${flow.id}.md`, items: [flow.id!], file: doc.path, line: 1 });
        }
      }
    }
    if (!this.docs.has(FILE_PATHS.product!)) {
      out.push({ code: 'E-PARSE', severity: 'error', message: `${FILE_PATHS.product} is missing`, items: [], file: FILE_PATHS.product! });
    }
    // Duplicate IDs across files.
    const seen = new Map<string, string>();
    for (const doc of this.docs.values()) {
      for (const id of doc.items.keys()) {
        const other = seen.get(id);
        if (other && other !== doc.path) out.push({ code: 'E-DUP-ID', severity: 'error', message: `Duplicate ID ${id} (also in ${other})`, items: [id], file: doc.path });
        seen.set(id, doc.path);
      }
    }
    return out;
  }

  locate(id: string): { doc: ParsedDoc; node: Node } | undefined {
    for (const doc of this.docs.values()) {
      const node = doc.items.get(id);
      if (node) return { doc, node };
    }
    return undefined;
  }

  /** Current text of every file, with `null` for files deleted since load. */
  files(): Map<string, string | null> {
    const out = new Map<string, string | null>();
    for (const [p, d] of this.docs) out.set(p, d.text);
    for (const p of this.deleted) out.set(p, null);
    return out;
  }

  /** Files whose text differs from what was loaded. */
  changedFiles(): Map<string, string | null> {
    const out = new Map<string, string | null>();
    for (const [p, t] of this.files()) if (this.original.get(p) !== t) out.set(p, t);
    return out;
  }

  /** The next free ID of a kind: one above the highest in the files. */
  allocate(prefix: Prefix): string {
    let max = 0;
    for (const doc of this.docs.values()) {
      for (const id of doc.items.keys()) {
        for (const part of id.split('>')) {
          const m = /^([A-Z]{2})-(\d+)$/.exec(part);
          if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
        }
      }
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  }

  // ---- Edits --------------------------------------------------------------

  modify(id: string, patch: Fields) {
    const vf = VISION_FIELDS.find((v) => v.id === id);
    if (vf) return this.setVision({ ...this.model.vision, [vf.prop]: patch.text });
    const loc = this.mustLocate(id);
    const fields = { ...loc.node.fields };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') delete fields[k];
      else fields[k] = v;
    }
    if (loc.node.type === 'connection') {
      fields.from ||= loc.node.fields!.from;
      fields.to ||= loc.node.fields!.to;
    }
    this.write(loc.doc, splice(loc.doc, loc.node.seg, loc.node.seg, renderOwn(loc.node.type!, id, fields)));
  }

  setVision(vision: Model['vision']) {
    const doc = this.ensureDoc('product');
    const text = renderVision(vision);
    const section = doc.root.children.find((c) => c.section?.type === 'vision');
    const node = section?.children.find((c) => c.kind === 'vision');
    if (node) this.write(doc, splice(doc, node.seg, node.seg, text));
    else if (section) this.write(doc, insertAfter(doc, section.seg, text));
    else this.write(doc, insertAfter(doc, doc.root.seg, `\n## Vision\n${text}`));
  }

  /**
   * Adds an item. `fields` uses model property names. For connections the ID is derived from
   * `fields.from`/`fields.to`. `pos.parent` is required for jobs, steps and connections.
   * `pos.after`: an ID, `null` for first place, or omitted to append.
   */
  add(type: ItemType, id: string, fields: Fields, pos: Position = {}) {
    if (type === 'flow') return this.addFlow(id, fields);
    if (type === 'vision_field') throw new Error('Vision fields are modified, not added');
    const own = renderOwn(type, id, fields);
    this.insert(type, pos, TYPES[type].form === 'block' ? '\n' + own : own);
  }

  remove(id: string) {
    const loc = this.mustLocate(id);
    if (loc.node.type === 'flow') {
      this.docs.delete(loc.doc.path);
      if (this.original.has(loc.doc.path)) this.deleted.add(loc.doc.path);
      this.cached = undefined;
      return;
    }
    const section = loc.node.parent;
    if (loc.node.type === 'link' && section?.kind === 'section' && section.children.length === 1) {
      // A screen's last link takes its "### Links" heading with it.
      const start = section.seg > 0 && loc.doc.segs[section.seg - 1]!.kind === 'blank' ? section.seg - 1 : section.seg;
      this.write(loc.doc, splice(loc.doc, start, subtreeEnd(section), ''));
      return;
    }
    const [start, end] = removalRange(loc.doc, loc.node);
    this.write(loc.doc, splice(loc.doc, start, end, ''));
  }

  /**
   * Removes an item with its children, and unlinks it everywhere: connections to removed steps and
   * links to removed screens are removed, and removed IDs are stripped from `jobs` lists and
   * `screen` fields. Returns every ID that was removed or modified.
   */
  removeCascade(id: string): string[] {
    const loc = this.mustLocate(id);
    const removed = new Set<string>();
    const collect = (n: Node) => {
      if (n.id) removed.add(n.id);
      n.children.forEach(collect);
    };
    collect(loc.node);
    const connections: string[] = [];
    const modified: string[] = [];
    for (const doc of this.docs.values()) {
      for (const [iid, node] of doc.items) {
        if (removed.has(iid)) continue;
        if (node.type === 'connection') {
          if (removed.has(node.fields!.from as string) || removed.has(node.fields!.to as string)) connections.push(iid);
          continue;
        }
        if (node.type === 'link') {
          if (removed.has(node.fields!.to as string)) connections.push(iid);
          continue;
        }
        if (unlinkPatch(node, removed)) modified.push(iid);
      }
    }
    for (const iid of modified) this.modify(iid, unlinkPatch(this.mustLocate(iid).node, removed)!);
    for (const cid of connections) this.remove(cid);
    this.remove(id);
    return [...removed, ...connections, ...modified];
  }

  // ---- Internals ----------------------------------------------------------

  private addFlow(id: string, fields: Fields) {
    const m = emptyModel();
    m.flows.push({ id, name: String(fields.name), jobs: (fields.jobs as string[] | undefined) ?? [], steps: [], connections: [] });
    const path = flowPath(id);
    this.deleted.delete(path);
    this.write(null, renderFile('flow', m, id), path, 'flow');
  }

  private insert(type: Exclude<ItemType, 'vision_field' | 'flow'>, pos: Position, text: string) {
    const home = HOME[type];
    let doc: ParsedDoc;
    let parentNode: Node;
    if (home.childOf) {
      if (!pos.parent) throw new Error(`${type} needs a parent`);
      const loc = this.mustLocate(pos.parent);
      if (loc.node.type !== home.childOf) throw new Error(`${pos.parent} is not a ${home.childOf}`);
      doc = loc.doc;
      parentNode = loc.node;
    } else {
      doc = this.ensureDoc(home.fileKey);
      parentNode = doc.root;
    }

    // Find (or create) the container: a section under the parent, the parent itself, or the root.
    let container: Node = parentNode;
    if (home.section) {
      const found = parentNode.children.find((c) => c.section?.heading === home.section);
      if (!found) {
        const defs = (parentNode === doc.root || parentNode.type === 'flow'
          ? FILES[doc.fileKey]!.sections
          : FILES[doc.fileKey]!.childSections)!;
        const at = sectionInsertPoint(parentNode, defs, home.section);
        const heading = '#'.repeat(defs.find((d) => d.heading === home.section)!.level);
        this.write(doc, insertAfter(doc, at, `\n${heading} ${home.section}\n${text}`));
        return;
      }
      container = found;
    }

    const siblings = container.children.filter((c) => c.kind === 'item');
    let at: number;
    if (pos.after === null) {
      at = container.seg;
    } else if (pos.after !== undefined) {
      const anchor = siblings.find((c) => c.id === pos.after);
      if (!anchor) throw new Error(`${pos.after} is not in the same list`);
      at = subtreeEnd(anchor);
    } else {
      const lastSibling = siblings.at(-1);
      at = lastSibling ? subtreeEnd(lastSibling) : container.seg;
    }
    this.write(doc, insertAfter(doc, at, text));
  }

  private ensureDoc(fileKey: string): ParsedDoc {
    const path = FILE_PATHS[fileKey]!;
    const existing = this.docs.get(path);
    if (existing) return existing;
    this.write(null, renderFile(fileKey, emptyModel()), path, fileKey);
    return this.docs.get(path)!;
  }

  private mustLocate(id: string) {
    const loc = this.locate(id);
    if (!loc) throw new Error(`Unknown item ${id}`);
    return loc;
  }

  private write(doc: ParsedDoc | null, text: string, path = doc!.path, fileKey = doc!.fileKey) {
    this.docs.set(path, parseDoc(path, fileKey, text));
    this.cached = undefined;
  }
}

/** The fields of `node` without the removed IDs, or undefined when it links to none of them. */
function unlinkPatch(node: Node, removed: Set<string>): Fields | undefined {
  const patch: Fields = {};
  for (const [k, v] of Object.entries(node.fields ?? {})) {
    if (Array.isArray(v) && v.some((x) => removed.has(x))) patch[k] = v.filter((x) => !removed.has(x));
    // A target marks a spot on its screen, so it goes with the screen.
    else if (k === 'screen' && removed.has(v as string)) { patch[k] = undefined; patch.target = undefined; }
  }
  return Object.keys(patch).length ? patch : undefined;
}

// ---- Text surgery -----------------------------------------------------------

/** Replaces segments [from, to] (inclusive) with `text`. */
function splice(doc: ParsedDoc, from: number, to: number, text: string): string {
  const before = doc.segs.slice(0, from).map((s) => s.raw).join('');
  const after = doc.segs.slice(to + 1).map((s) => s.raw).join('');
  return before + text + after;
}

/** Inserts `text` after segment `index` (-1 = start of file). */
function insertAfter(doc: ParsedDoc, index: number, text: string): string {
  const before = doc.segs.slice(0, index + 1).map((s) => s.raw).join('');
  const after = doc.segs.slice(index + 1).map((s) => s.raw).join('');
  return before + text + after;
}

function sectionInsertPoint(parent: Node, defs: SectionDef[], heading: string): number {
  const idx = defs.findIndex((d) => d.heading === heading);
  let at = parent.seg;
  for (const c of parent.children) {
    const cIdx = c.section ? defs.indexOf(c.section) : -1;
    if (c.section && cIdx < idx) at = Math.max(at, subtreeEnd(c));
  }
  return at;
}

function removalRange(doc: ParsedDoc, node: Node): [number, number] {
  let start = subtreeStart(doc, node);
  const end = subtreeEnd(node);
  const isBlock = node.type ? TYPES[node.type as keyof typeof TYPES]?.form === 'block' : false;
  if (isBlock && start > 0 && doc.segs[start - 1]!.kind === 'blank') start--;
  return [start, end];
}

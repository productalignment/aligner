// Moving the PM's draft onto what was pushed meanwhile, item by item. What the draft did
// since its base (the items it added, changed and removed) is done again on top of theirs, field
// by field, so both sides' changes stay. Where both changed the same field of an item, the draft's
// value stays; where they removed an item the draft changed, it stays removed. Items both sides
// added under the same ID are renumbered in the draft.
import { VISION_FIELDS } from './context/spec.ts';
import type { Node } from './context/parse.ts';
import type { ItemType, Model } from './context/types.ts';
import { Workspace } from './context/workspace.ts';

type Fields = Record<string, unknown>;
/** An item, with the item it belongs to and the one before it in its list (null: it comes first). */
interface Item { type: ItemType; parent?: string; after: string | null; fields: Fields }

export interface Merged {
  /** The product context files that differ from theirs after the merge (path → text, null: removed). */
  files: Map<string, string | null>;
  /** IDs the draft added that theirs added too, and what they became (old → new), for the draft's other files. */
  renames: Map<string, string>;
  /** Items both sides changed, which keep the draft's version. */
  kept: string[];
  /** Items the draft changed that theirs removed, or added under one that theirs removed: the draft's change is gone. */
  dropped: string[];
  /** The draft as it was (renumbered), for naming those items. */
  model: Model;
}

const ID = /\b[A-Z]{2}-\d{3,}\b/g;

/** Renames IDs in a path or a text. */
export const renameIds = (text: string, renames: Map<string, string>) => (renames.size ? text.replace(ID, (id) => renames.get(id) ?? id) : text);

/**
 * Merges the draft (`ours`, the product context files as the PM sees them) with `theirs` (the
 * branch's latest commit), both coming from `base` (the commit the draft was made on). Each is the
 * text of the product context files by path, as `readContextFiles` gives them.
 */
export function mergeDraft(base: Record<string, string>, ours: Record<string, string>, theirs: Record<string, string>): Merged {
  const b = items(new Workspace(base));
  const t = new Workspace(theirs);
  const before = items(t);

  // Items both added under the same ID: the draft's take the next free numbers.
  const renames = new Map<string, string>();
  const o0 = items(new Workspace(ours));
  const taken = new Set([...o0.keys(), ...before.keys()]);
  for (const id of o0.keys()) {
    if (b.has(id) || !before.has(id) || id.includes('>') || id.startsWith('VI-')) continue;
    const prefix = id.slice(0, 2);
    let n = Math.max(...[...taken].filter((x) => x.startsWith(`${prefix}-`)).map((x) => Number(x.slice(3)) || 0));
    let next: string;
    do next = `${prefix}-${String(++n).padStart(3, '0')}`; while (taken.has(next));
    taken.add(next);
    renames.set(id, next);
  }
  const oursWs = renames.size ? new Workspace(Object.fromEntries(Object.entries(ours).map(([p, text]) => [renameIds(p, renames), renameIds(text, renames)]))) : undefined;
  const o = oursWs ? items(oursWs) : o0;

  const kept: string[] = [];
  const dropped: string[] = [];
  const fieldsIn = (id: string): Fields | undefined => (id.startsWith('VI-') ? visionItem(t.model, id).fields : t.locate(id)?.node.fields);

  // What the draft removed.
  for (const [id, was] of b) {
    if (was.type === 'vision_field' || o.has(id) || !t.locate(id)) continue;
    if (Object.keys(changes(was.fields, before.get(id)!.fields)).length) kept.push(id);
    t.removeCascade(id);
  }

  // What the draft changed, field by field.
  for (const [id, now] of o) {
    const was = b.get(id);
    if (!was) continue;
    const patch = changes(was.fields, now.fields);
    if (!Object.keys(patch).length) continue;
    const current = fieldsIn(id);
    if (!current) { dropped.push(id); continue; }
    if (Object.keys(patch).some((k) => norm(current[k]) !== norm(was.fields[k]) && norm(current[k]) !== norm(now.fields[k]))) kept.push(id);
    t.modify(id, patch);
  }

  // What the draft added, in its order: each after the item before it, where theirs has that one.
  for (const [id, now] of o) {
    if (b.has(id) || now.type === 'vision_field' || t.locate(id)) continue;
    const ends = now.type === 'connection' ? [now.fields.from, now.fields.to] : now.type === 'link' ? [now.fields.to] : [];
    const missing = [now.parent, ...ends].some((x) => typeof x === 'string' && !t.locate(x));
    if (missing) { dropped.push(id); continue; }
    const after = now.after === null ? null : t.locate(now.after) ? now.after : undefined;
    t.add(now.type, id, now.fields, { parent: now.parent, after });
  }

  return { files: t.changedFiles(), renames, kept, dropped, model: (oursWs ?? new Workspace(ours)).model };
}

/** Every item by ID, the files in order, the vision's parts as VI- items. */
function items(ws: Workspace): Map<string, Item> {
  const out = new Map<string, Item>();
  for (const v of VISION_FIELDS) out.set(v.id, visionItem(ws.model, v.id));
  for (const doc of [...ws.docs.values()].sort((x, y) => x.path.localeCompare(y.path))) {
    const walk = (node: Node) => {
      let after: string | null = null;
      for (const c of node.children) {
        if (c.kind === 'item' && c.id) {
          out.set(c.id, { type: c.type!, parent: owner(c), after, fields: { ...c.fields } });
          after = c.id;
        }
        walk(c);
      }
    };
    walk(doc.root);
  }
  return out;
}

function visionItem(m: Model, id: string): Item {
  const prop = VISION_FIELDS.find((v) => v.id === id)!.prop;
  return { type: 'vision_field', after: null, fields: { text: m.vision[prop] } };
}

function owner(node: Node): string | undefined {
  for (let p = node.parent; p; p = p.parent) if (p.kind === 'item') return p.id;
  return undefined;
}

const norm = (v: unknown) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? undefined : Array.isArray(v) ? v.join(', ') : String(v));

/** The fields that differ, with their new values; the ends of a connection or link are what it is, not fields to change. */
function changes(from: Fields, to: Fields): Fields {
  const out: Fields = {};
  for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) if (!['from', 'to', 'box'].includes(k) && norm(from[k]) !== norm(to[k])) out[k] = to[k];
  return out;
}

/** What to call an item when telling the PM about it: its name, label or text, never its ID. */
export function itemName(m: Model, id: string): string {
  if (id.startsWith('VI-')) return 'the vision';
  if (id.includes('@')) return 'a click zone';
  if (id.includes('>')) return 'a connector';
  const named = [...m.personas, ...m.flows, ...m.screens].find((x) => x.id === id)?.name
    ?? m.flows.flatMap((f) => f.steps).find((s) => s.id === id)?.label
    ?? [...m.out_of_scope, ...m.constraints, ...m.personas.flatMap((p) => p.jobs)].find((x) => x.id === id)?.text;
  if (!named) return 'an item';
  return `“${named.length > 48 ? `${named.slice(0, 47)}…` : named}”`;
}

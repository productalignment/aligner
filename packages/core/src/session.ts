// A product open in Aligner: applies the PM's edits to the product context files, wherever its
// store keeps them (on the server, a branch of the product's GitHub repository). Each edit
// is one write, which the server commits with the edits around it.
import { CONTEXT_DIR, FILE_PATHS, PREFIX_TO_TYPE, Workspace, emptyModel, formatTarget, linkId, parseTarget, renderRepo, type ItemType, type Prefix } from './context/index.ts';
import { loadWorkspace, validateFiles } from './files.ts';
import { toText, type FileChanges, type ProductStore } from './store.ts';
import type { EditOp, EditResult, Layout, Line, Lines, Markup, ProductRef, ProductSnapshot } from './api.ts';

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_PICTURE = 8 * 1024 * 1024;

export class ProductSession {
  constructor(readonly store: ProductStore, readonly ref: ProductRef) {}

  /**
   * Adds the product context skeleton: the files it lacks (never overwriting one), and the
   * `agentFiles.blocks` (e.g. CLAUDE.md, AGENTS.md), created or appended to a file that doesn't
   * contain `agentFiles.marker` yet. Returns the paths written.
   */
  init(extras: Record<string, string>, agentFiles?: { blocks: Record<string, string>; marker: string }): Promise<string[]> {
    return this.serial(async () => {
      const changes: FileChanges = new Map();
      for (const [path, text] of Object.entries({ ...renderRepo(emptyModel()), ...extras })) {
        if (!(await this.store.read(path))) changes.set(path, text);
      }
      for (const [path, block] of Object.entries(agentFiles?.blocks ?? {})) {
        const data = await this.store.read(path);
        const existing = data && toText(data);
        if (existing?.includes(agentFiles!.marker)) continue;
        changes.set(path, existing === null ? `# ${path}\n\n${block}` : `${existing}${existing.endsWith('\n') ? '' : '\n'}\n${block}`);
      }
      if (changes.size) await this.store.write(changes, 'add the product context');
      return [...changes.keys()];
    });
  }

  async snapshot(): Promise<ProductSnapshot> {
    const version = await this.store.version();
    const ws = await loadWorkspace(this.store);
    const model = ws.model;
    return {
      ...this.ref, hasContext: ws.docs.has(FILE_PATHS.product!), loadedAt: Date.now(), name: model.vision.the || this.ref.repo.split('/').pop()!, model,
      findings: await validateFiles(this.store, ws),
      version,
      layouts: await this.layouts([...model.flows.map((f) => f.id), MAP]),
      lines: await this.lines([...model.flows.map((f) => f.id), MAP]),
    };
  }

  /** The saved layouts of these canvases (flows, and the map); a missing or unreadable file means "lay it out automatically". */
  private layouts(ids: string[]): Promise<Record<string, Layout>> {
    return this.json(ids, layoutPath);
  }

  /** How the connectors of these flows, or the arrows of the map, are drawn; a missing or unreadable file means "as Aligner draws them". */
  private lines(ids: string[]): Promise<Record<string, Lines>> {
    return this.json(ids, linesPath);
  }

  private async json<T>(ids: string[], path: (id: string) => string): Promise<Record<string, T>> {
    const found = await Promise.all(ids.map(async (id) => {
      try {
        const data = await this.store.read(path(id));
        return data ? (JSON.parse(toText(data)) as T) : undefined;
      } catch { return undefined; }
    }));
    const out: Record<string, T> = {};
    ids.forEach((id, i) => { if (found[i]) out[id] = found[i]; });
    return out;
  }

  /**
   * Saves where a flow's steps are on its canvas, or, for `screens`, where the screens are
   * on the map; with null, removes the layout.
   */
  saveLayout(of: string, layout: Layout | null): Promise<ProductSnapshot> {
    return this.serial(async () => {
      if (of !== MAP && !(await loadWorkspace(this.store)).model.flows.some((f) => f.id === of)) throw new Error(`${of} is not a flow`);
      const what = of === MAP ? 'the screens on the map' : `the steps of ${of}`;
      const files: FileChanges = new Map([[layoutPath(of), layout && layoutText(layout)]]);
      const lines = !layout && (await this.lines([of]))[of];
      if (lines) {
        // Tidied up, the connectors keep their shapes and glued ends; their bends were for where things were.
        const model = (await loadWorkspace(this.store)).model;
        files.set(linesPath(of), linesText(arrowsOn(model, of), Object.fromEntries(Object.entries(lines).map(([id, { via: _via, ...l }]) => [id, l]))));
      }
      await this.store.write(files, layout ? `move ${what}` : `tidy up ${of === MAP ? 'the map' : of}`);
      return this.snapshot();
    });
  }

  /** Saves how a flow's connectors (`of`: its ID) or the map's arrows (`of`: `screens`) are drawn, keeping only theirs. */
  saveLines(of: string, lines: Lines): Promise<ProductSnapshot> {
    return this.serial(async () => {
      const model = (await loadWorkspace(this.store)).model;
      if (of !== MAP && !model.flows.some((f) => f.id === of)) throw new Error(`${of} is not a flow`);
      await this.store.write(new Map([[linesPath(of), linesText(arrowsOn(model, of), lines)]]), `draw the ${of === MAP ? 'arrows on the map' : `connectors of ${of}`}`);
      return this.snapshot();
    });
  }

  /** Changes whenever a file in product/ changes. */
  version(): Promise<string> {
    return this.store.version();
  }

  /** Applies one PM edit. Edits run one at a time, and the store takes in no new commit during one. */
  edit(op: EditOp): Promise<EditResult> {
    return this.change(async (ws, files) => {
      const screen = op.op === 'remove' ? ws.model.screens.find((s) => s.id === op.id) : undefined;
      const of = op.op === 'add' ? undefined : canvasOf(ws.model, op.id);
      const id = apply(ws, op);
      // A removed screen takes its screenshot, mockup and shapes with it; a removed flow, its layout and lines.
      if (screen) for (const rel of [screen.picture, screen.mockup, shapesPath(screen.id)]) if (rel) files.set(inContext(rel), null);
      if (op.op === 'remove' && id.startsWith('FL-')) for (const path of [layoutPath(id), linesPath(id)]) files.set(path, null);
      const lines = of && op.op !== 'add' && (op.op === 'remove' || id !== op.id) && (await this.lines([of]))[of];
      if (lines) {
        // A connector or arrow moved onto another step or screen keeps its shape and its other end; a removed one, nothing.
        const was = op.op === 'modify' && lines[op.id];
        if (was && id !== op.id) {
          const end = id.split('>')[0] === op.id.split('>')[0] ? 'to' : 'from';
          const { [end]: _moved, via: _via, ...kept } = was;
          lines[id] = kept;
        }
        files.set(linesPath(of), linesText(arrowsOn(ws.model, of), lines));
      }
      const canvas = op.op === 'add' && (op.at || op.layout) ? (op.type === 'step' ? op.parent : op.type === 'screen' || op.type === 'link' ? MAP : undefined) : undefined;
      if (canvas && op.op === 'add') {
        // A step or screen placed on its canvas, or a link drawn on the map: the layout keeps everything where it was.
        const saved = (await this.layouts([canvas]))[canvas] ?? {};
        files.set(layoutPath(canvas), layoutText({ ...saved, ...op.layout, ...(op.at ? { [id]: op.at } : {}) }));
      }
      return { id, note: describe(op, id) };
    });
  }

  /** Stores a screenshot in product/screens/ and links it to the screen. */
  setPicture(screenId: string, fileName: string, data: Uint8Array): Promise<EditResult> {
    return this.change(async (ws, files) => {
      const ext = extension(fileName);
      if (!MIME[ext]) throw new Error('Pictures must be PNG, JPEG, SVG, WebP or GIF');
      if (data.length > MAX_PICTURE) throw new Error('Pictures must be under 8 MB');
      const rel = `screens/${screenId}${ext}`;
      const old = screenOf(ws, screenId).picture;
      files.set(inContext(rel), data);
      if (old && old !== rel) files.set(inContext(old), null);
      ws.modify(screenId, { picture: rel });
      return { id: screenId, note: `screenshot of ${screenId}` };
    });
  }

  /** A screen picture as a data URL, so the single-file UI needs no file routes. */
  async picture(rel: string): Promise<string> {
    const path = inContext(rel);
    const mime = MIME[extension(path)];
    if (!mime) throw new Error('Not a picture');
    const data = await this.store.read(path);
    if (!data) throw new Error(`${path} is missing`);
    return `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
  }

  /** The shapes drawn over a screen (screens/SC-nnn.shapes.json), or null. */
  async markup(screenId: string): Promise<Markup | null> {
    screenOf(await loadWorkspace(this.store), screenId);
    try {
      const data = await this.store.read(inContext(shapesPath(screenId)));
      return data ? (JSON.parse(toText(data)) as Markup) : null;
    } catch {
      return null;
    }
  }

  /** Saves the shapes and the flattened mockup. With no shapes, the mockup is removed. */
  saveMockup(screenId: string, markup: Markup, png: Uint8Array): Promise<EditResult> {
    return this.change(async (ws, files) => {
      screenOf(ws, screenId);
      const rel = `screens/${screenId}.mockup.png`;
      if (!markup.shapes.length) {
        files.set(inContext(rel), null);
        files.set(inContext(shapesPath(screenId)), null);
        ws.modify(screenId, { mockup: null });
        return { id: screenId, note: `clear the mockup of ${screenId}` };
      }
      if (png.length > MAX_PICTURE) throw new Error('The mockup must be under 8 MB');
      files.set(inContext(rel), png);
      files.set(inContext(shapesPath(screenId)), JSON.stringify(markup, null, 2) + '\n');
      ws.modify(screenId, { mockup: rel });
      return { id: screenId, note: `mockup of ${screenId}` };
    });
  }

  // ---- internals ------------------------------------------------------------

  /** One change: the edit `fn` makes to the files, written at once with the files it rewrote. */
  private change(fn: (ws: Workspace, files: FileChanges) => Promise<{ id: string; note: string }>): Promise<EditResult> {
    return this.serial(async () => {
      const ws = await loadWorkspace(this.store);
      const files: FileChanges = new Map();
      const { id, note } = await fn(ws, files);
      for (const [path, text] of ws.changedFiles()) files.set(path, text);
      if (files.size) await this.store.write(files, note);
      return { snapshot: await this.snapshot(), id };
    });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    return this.store.exclusive(fn);
  }
}

const shapesPath = (screenId: string) => `screens/${screenId}.shapes.json`;
/** The map of the screens keeps its layout beside the flows', under this name. */
const MAP = 'screens';
const layoutPath = (of: string) => (of === MAP ? `${CONTEXT_DIR}/screens.layout.json` : `${CONTEXT_DIR}/flows/${of}.layout.json`);
const linesPath = (of: string) => (of === MAP ? `${CONTEXT_DIR}/screens.lines.json` : `${CONTEXT_DIR}/flows/${of}.lines.json`);
/** The IDs of a flow's connections, or of the map's arrows (the screens' links). */
const arrowsOn = (model: Workspace['model'], of: string) => new Set(of === MAP
  ? model.screens.flatMap((s) => s.links.map((l) => linkId(s.id, l.box, l.to)))
  : (model.flows.find((f) => f.id === of)?.connections ?? []).map((c) => `${c.from}>${c.to}`));
/** The canvas an item is drawn on: the flow of a step or connection, or the map for a screen or link. */
const canvasOf = (model: Workspace['model'], id: string) => (model.screens.some((s) => s.id === id) || arrowsOn(model, MAP).has(id)
  ? MAP
  : model.flows.find((f) => f.steps.some((s) => s.id === id) || arrowsOn(model, f.id).has(id))?.id);
const extension = (name: string) => /\.[^./]+$/.exec(name)?.[0].toLowerCase() ?? '';

function layoutText(layout: Layout) {
  const rounded = Object.fromEntries(Object.entries(layout).map(([k, p]) => [k, { x: Math.round(p.x), y: Math.round(p.y) }]));
  return JSON.stringify(rounded, null, 2) + '\n';
}

const SHAPES: Line['shape'][] = ['curved', 'elbow', 'straight'];

/** The lines of these connectors or arrows, with their numbers rounded; none: no file. */
function linesText(ids: Set<string>, lines: Lines) {
  const round = (p?: { x: number; y: number }, by = 1) => (Number.isFinite(p?.x) && Number.isFinite(p?.y) ? { x: Math.round(p!.x * by) / by, y: Math.round(p!.y * by) / by } : undefined);
  const kept = Object.entries(lines).flatMap(([id, l]) => {
    if (!ids.has(id)) return [];
    const line = Object.fromEntries(Object.entries({ shape: SHAPES.includes(l.shape!) ? l.shape : undefined, from: round(l.from, 1000), to: round(l.to, 1000), via: round(l.via) }).filter(([, v]) => v !== undefined));
    return Object.keys(line).length ? [[id, line] as const] : [];
  });
  return kept.length ? JSON.stringify(Object.fromEntries(kept), null, 2) + '\n' : null;
}

/** The path of a file in product/, given relative to it; refuses one outside it. */
function inContext(rel: string): string {
  if (rel.includes('\\') || rel.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Pictures must live in ${CONTEXT_DIR}/`);
  return `${CONTEXT_DIR}/${rel}`;
}

function screenOf(ws: Workspace, screenId: string) {
  const screen = ws.model.screens.find((s) => s.id === screenId);
  if (!screen) throw new Error(`${screenId} is not a screen`);
  return screen;
}

/** What an edit did, for the commit that carries it (e.g. "add FS-012 to FL-002"). */
function describe(op: EditOp, id: string): string {
  const name = (x: string) => (x.startsWith('VI-') ? 'the vision'
    : x.includes('@') ? `the click zone on ${x.slice(0, x.indexOf('@'))} to ${x.slice(x.lastIndexOf('>') + 1)}`
      : x.replace('>', ' -> '));
  if (op.op === 'modify') return `edit ${name(op.id)}`;
  if (op.op === 'remove') return `remove ${name(op.id)}`;
  if (op.type === 'link') return `link ${op.parent} to ${String(op.fields.to)}`;
  return `add ${name(id)}${op.parent ? ` to ${op.parent}` : ''}${op.zone ? `, opened from ${op.zone.screen}` : ''}`;
}

/** Applies an edit to the workspace; returns the ID of the item it is about. */
function apply(ws: Workspace, op: EditOp): string {
  switch (op.op) {
    case 'modify': {
      if (!op.id.startsWith('VI-') && !ws.locate(op.id)) throw new Error(`Unknown item ${op.id}`);
      const loc = ws.locate(op.id);
      if (loc?.node.type === 'link') {
        // Another screen, or another zone: still a zone on its screen, opening a screen, once.
        const fields = zoned({ ...loc.node.fields, ...op.fields });
        checkLink(ws, loc.node.parent!.parent!.id!, fields, op.id);
        ws.modify(op.id, fields);
        return linkId(loc.node.parent!.parent!.id!, String(fields.box), String(fields.to));
      } else if (loc?.node.type === 'connection' && (op.fields.from || op.fields.to)) {
        // A connector's end moved onto another step of its flow.
        const from = String(op.fields.from ?? loc.node.fields!.from);
        const to = String(op.fields.to ?? loc.node.fields!.to);
        const flow = ws.model.flows.find((f) => f.connections.some((c) => `${c.from}>${c.to}` === op.id))!;
        if (![from, to].every((s) => flow.steps.some((x) => x.id === s))) throw new Error(`A connector joins steps of ${flow.id}`);
        if (from === to) throw new Error('A connector joins two steps');
        const id = `${from}>${to}`;
        if (id !== op.id && ws.locate(id)) throw new Error('Those steps are connected already');
        ws.modify(op.id, { ...op.fields, from, to });
        return id;
      } else ws.modify(op.id, op.fields);
      return op.id;
    }
    case 'add': {
      const fields = op.type === 'link' ? zoned(op.fields) : op.fields;
      if (op.type === 'link') checkLink(ws, String(op.parent), fields);
      const id = op.type === 'connection' ? `${op.fields.from}>${op.fields.to}`
        : op.type === 'link' ? linkId(String(op.parent), String(fields.box), String(fields.to))
          : ws.allocate(Object.entries(PREFIX_TO_TYPE).find(([, t]) => t === op.type)![0] as Prefix);
      ws.add(op.type, id, fields, { parent: op.parent, after: op.after });
      if (op.type === 'step' && op.link) ws.add('connection', `${op.link}>${id}`, { from: op.link, to: id }, { parent: op.parent });
      if (op.type === 'screen' && op.on) {
        if (typeOf(ws, op.on) !== 'step') throw new Error(`${op.on} is not a step`);
        ws.modify(op.on, { screen: id, target: undefined });
      }
      if (op.type === 'screen' && op.zone) {
        // A new screen at the end of a click zone's arrow: the zone opens it.
        const link = zoned({ box: op.zone.box, to: id });
        checkLink(ws, op.zone.screen, link);
        ws.add('link', linkId(op.zone.screen, String(link.box), id), link, { parent: op.zone.screen });
      }
      return id;
    }
    case 'remove':
      if (!ws.locate(op.id)) throw new Error(`Unknown item ${op.id}`);
      ws.removeCascade(op.id);
      return op.id;
  }
}

const typeOf = (ws: Workspace, id: string): ItemType | undefined => ws.locate(id)?.node.type;

/** A link's fields with its click zone written the one way. */
function zoned(fields: Record<string, unknown>): Record<string, unknown> {
  const zone = parseTarget(String(fields.box ?? ''));
  if (!zone) throw new Error('A click zone is "x, y, width, height", in percent of the screen\'s picture');
  return { ...fields, box: formatTarget(zone) };
}

/** A link joins a click zone on a screen to another screen, once. `was`: the link it replaces. */
function checkLink(ws: Workspace, screen: string, fields: Record<string, unknown>, was?: string) {
  if (typeOf(ws, screen) !== 'screen') throw new Error(`${screen} is not a screen`);
  if (typeOf(ws, String(fields.to)) !== 'screen') throw new Error(`${String(fields.to)} is not a screen`);
  const id = linkId(screen, String(fields.box), String(fields.to));
  if (id !== was && ws.locate(id)) throw new Error('That click zone already opens that screen');
}

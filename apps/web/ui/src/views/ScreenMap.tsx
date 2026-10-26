// The Screens tab as a map, a wireflow: every screen on one canvas, its click zones (blue boxes
// around what opens another screen), and an arrow from each zone to the screen it opens. Pick a flow
// to light up its way through the screens, with a dashed arrow where it goes from one screen to
// another and no click zone leads there yet. Where the PM puts the screens is kept in
// `screens.layout.json`. No IDs.
import {
  applyNodeChanges, Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Panel, Position, ReactFlow, ReactFlowProvider,
  useInternalNode, useNodes, useReactFlow, useViewport, ViewportPortal, type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import { Monitor, MonitorSmartphone, Pencil, Plus, SquareMousePointer, Wand2, X } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Layout, Line } from '@aligner/core/api';
import { linkId, parseTarget, type Flow, type Screen, type Step, type Target } from '@aligner/core/context';
import { useApp } from '../state';
import { EditableText } from '../components/edit';
import { cx, Tip } from '../components/ui';
import { endOn, facing, glueAt, LineControls, linePath, useLines, type Drag, type Glued } from '../components/connector';
import { placeAll, useElkLayout } from '../components/layout';
import { Picture, fitBox, usePictureRatios } from '../components/Picture';
import { LargeScreen } from '../components/Target';

type Tool = 'screen' | 'zone';
type Pos = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Tone = 'normal' | 'lit' | 'faded' | 'gap';

/** A screen shows as its picture, in its own shape: tall for a phone, wide for a laptop. */
const BLANK = { width: 169, height: 300 };
const cardOf = (ratio: number | undefined) => (ratio ? fitBox(ratio, 320, 300) : BLANK);
const CAPTION = 30;
const COLOUR: Record<Tone, string> = { normal: '#3b82f6', lit: '#2563eb', faded: '#bfdbfe', gap: '#f59e0b' };

const image = (s: Screen) => s.mockup ?? s.picture;

export function ScreenMap() {
  const { product } = useApp();
  // A tool picked in the toolbar: a new screen goes where the map is clicked; a click zone is drawn on the screen clicked.
  const [tool, setTool] = useState<Tool | null>(null);
  // The flow lit up on the map, as the Flows page filters by job.
  const [shown, setShown] = useState('');
  const flow = product.model.flows.find((f) => f.id === shown);
  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
      <div className="relative min-h-[28rem] flex-1 overflow-hidden rounded-2xl bg-white shadow-xs">
        <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-xl bg-white/95 p-1 shadow-sm ring-1 ring-neutral-200">
          <Tip label="Screen">
            <button data-map-tool="screen" aria-pressed={tool === 'screen'} onClick={() => setTool(tool === 'screen' ? null : 'screen')} className={cx('rounded-lg px-1.5 py-1', tool === 'screen' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100')}>
              <MonitorSmartphone className="size-[18px]" />
            </button>
          </Tip>
          <span className="mx-0.5 h-5 w-px bg-neutral-200" />
          <Tip label="Click zone: what opens another screen">
            <button data-map-tool="zone" aria-pressed={tool === 'zone'} onClick={() => setTool(tool === 'zone' ? null : 'zone')} className={cx('rounded-lg px-1.5 py-1', tool === 'zone' ? 'bg-blue-500 text-white' : 'text-blue-500 hover:bg-blue-50')}>
              <SquareMousePointer className="size-[18px]" />
            </button>
          </Tip>
          {product.model.flows.length > 0 && (
            <>
              <span className="mx-0.5 h-5 w-px bg-neutral-200" />
              <select data-flow-filter value={flow ? shown : ''} onChange={(e) => setShown(e.target.value)} className="min-w-0 max-w-56 truncate rounded-lg bg-transparent px-1.5 py-1 text-[13px] text-neutral-600 outline-none hover:bg-neutral-100">
                <option value="">All flows</option>
                {product.model.flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </>
          )}
        </div>
        <ReactFlowProvider><MapCanvas tool={tool} onTool={setTool} flow={flow} /></ReactFlowProvider>
      </div>
    </div>
  );
}

// ---- A flow on the map -----------------------------------------------------------------

/** A step on one screen leading, through steps on none, to a step on another. */
interface Move { from: string; to: string; step: Step }

/** The screens a flow goes through, in its order from its start, and each move between two of them. */
function walk(flow: Flow): { screens: string[]; moves: Move[] } {
  const steps = new Map(flow.steps.map((s) => [s.id, s]));
  const next = (id: string) => flow.connections.filter((c) => c.from === id).map((c) => steps.get(c.to)).filter((s): s is Step => !!s);
  const order: Step[] = [];
  const queue = flow.steps.filter((s) => !flow.connections.some((c) => c.to === s.id));
  while (queue.length) {
    const s = queue.shift()!;
    if (order.includes(s)) continue;
    order.push(s);
    queue.push(...next(s.id));
  }
  for (const s of flow.steps) if (!order.includes(s)) order.push(s);
  const moves: Move[] = [];
  for (const s of flow.steps) {
    if (!s.screen) continue;
    const seen = new Set([s.id]);
    const reach = (id: string) => {
      for (const t of next(id)) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        if (!t.screen) reach(t.id);
        else if (t.screen !== s.screen) moves.push({ from: s.screen!, to: t.screen, step: s });
      }
    };
    reach(s.id);
  }
  return { screens: [...new Set(order.flatMap((s) => (s.screen ? [s.screen] : [])))], moves };
}

const overlaps = (a: Target | null, b: Target | null) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---- The canvas ------------------------------------------------------------------------------
// Whiteboard basics, as on a flow's canvas: drag a screen to move it, click to select, double-click
// to open its mockup, Delete removes the selected arrow, Escape lets go.

type ScreenData = {
  screen: Screen; image?: string; card: { width: number; height: number }; zones: { id: string; box: Target; to: string; opens: string }[];
  faded: boolean; editing: boolean; order?: number;
};

/**
 * What lights up on the map, and what a click zone does when clicked. The screens read it, so they
 * stay as they are while it changes: rebuilt, React Flow measures them again and drops the arrows meanwhile.
 */
interface Light {
  tone: (id: string, from: string, to: string) => Tone;
  sel?: string; focus?: string; target?: string;
  onZone: (id: string) => void; onRemove: (id: string) => void; onHover: (id?: string) => void;
}
const LightContext = createContext<Light | null>(null);
type ArrowData = {
  box?: Target; label?: string; tone: Tone; selected: boolean; editing: boolean; gap?: string; line?: Line;
  onEdit?: () => void; onDone?: (label?: string) => void; onFix?: () => void;
  /** Its end dropped on a screen: glued to a dot or a point of its border there, or onto another screen. */
  onEnd?: (onto: Glued) => void;
  onLine?: (line: Line) => void;
};

function MapCanvas({ tool, onTool, flow }: { tool: Tool | null; onTool: (t: Tool | null) => void; flow?: Flow }) {
  const { product, at, nav, go, edit, host, onSnapshot, fail } = useApp();
  const { screenToFlowPosition } = useReactFlow();
  const screens = product.model.screens;
  const saved = product.layouts.screens;
  const ratios = usePictureRatios(screens.flatMap((s) => image(s) ?? []));
  const card = (s: Screen) => cardOf(image(s) ? ratios?.get(image(s)!) : undefined);
  const size = (s: Screen) => ({ width: card(s).width, height: card(s).height + CAPTION });
  const known = (id: string) => screens.some((s) => s.id === id);
  const pairs = [...new Set(screens.flatMap((s) => s.links.filter((l) => l.to !== s.id && known(l.to)).map((l) => `${s.id}>${l.to}`)))];
  const shape = `${screens.map((s) => `${s.id}:${size(s).width}x${size(s).height}`).join(',')}|${pairs.join(',')}`;
  // The automatic layout, left to right along the arrows, only while the PM hasn't placed anything.
  const laidOut = useElkLayout(
    saved ? [] : screens.map((s) => ({ id: s.id, ...size(s) })),
    saved ? [] : pairs.map((p) => ({ id: p, source: p.split('>')[0]!, target: p.split('>')[1]! })),
    `map:${at.repo}@${at.branch}:${saved ? 'saved' : shape}`,
    { node: 60, layer: 130 },
    // Screens nothing leads to come first, and the arrows back to them are the ones turned round.
    { 'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST', 'elk.spacing.edgeNode': '30' },
  );
  const byId = (id: string) => screens.find((s) => s.id === id)!;
  const placed = saved
    ? placeAll(screens.map((s) => s.id), saved, (id) => screens.filter((s) => s.links.some((l) => l.to === id)).map((s) => s.id), (id) => card(byId(id)).width, 120, 380)
    : laidOut;
  const ready = !!placed && !!ratios;

  const [nodes, setNodes] = useState<Node<ScreenData>[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [sel, setSel] = useState<string>(); // the arrow selected
  const [hover, setHover] = useState<string>(); // the click zone under the pointer
  const [labelling, setLabelling] = useState<string>();
  // The screen opened large to draw a click zone on, and the screen the zone opens when that is known already (a dashed arrow's).
  const [drawing, setDrawing] = useState<{ screen: string; to?: string }>();
  // A click zone drawn, waiting for the click on the screen it opens; its arrow follows the pointer.
  const [pending, setPending] = useState<{ screen: string; box: string }>();
  const [pointer, setPointer] = useState<Pos>();
  const [over, setOver] = useState<string>();

  // What lights up: the selected arrow; or the selected screen and the arrows that touch it; or the flow picked, with its dashed gaps.
  const way = flow ? walk(flow) : undefined;
  const used = new Set<string>();
  const gaps = new Map<string, Move>();
  for (const m of way?.moves ?? []) {
    const links = screens.find((s) => s.id === m.from)?.links.filter((l) => l.to === m.to) ?? [];
    const link = links.find((l) => overlaps(parseTarget(l.box), parseTarget(m.step.target))) ?? links[0];
    if (link) used.add(linkId(m.from, link.box, link.to));
    else if (!gaps.has(`${m.from}>${m.to}`) || (m.step.target && !gaps.get(`${m.from}>${m.to}`)!.step.target)) gaps.set(`${m.from}>${m.to}`, m);
  }
  const focus = known(nav.selected ?? '') ? nav.selected : undefined;
  const tone = (id: string, from: string, to: string): Tone => {
    if (sel) return id === sel ? 'lit' : 'faded';
    if (focus) return from === focus || to === focus ? 'lit' : 'faded';
    if (way) return used.has(id) ? 'lit' : 'faded';
    if (hover) return id === hover ? 'lit' : 'normal';
    return 'normal';
  };

  const light: Light = {
    tone, sel, focus, target: pending && over !== pending.screen ? over : undefined,
    onZone: (id) => { setSel(id); go({ selected: undefined }); },
    onRemove: (id) => { setSel(undefined); void edit({ op: 'remove', id }); },
    onHover: setHover,
  };

  // The nodes follow the files and the flow picked; while a screen is dragged it follows the pointer until it's dropped and saved.
  // They keep what React Flow measured of them: without it, it measures them again and drops the arrows meanwhile.
  const placedKey = placed ? JSON.stringify([...placed]) : '';
  useEffect(() => {
    if (!ready) return;
    setNodes(screens.map((s) => {
      const order = way ? way.screens.indexOf(s.id) : -1;
      const now = nodesRef.current.find((n) => n.id === s.id);
      return {
        id: s.id,
        type: 'screen',
        position: (now?.dragging ? now.position : placed!.get(s.id)) ?? { x: 0, y: 0 },
        ...(now?.measured ? { measured: now.measured } : {}),
        data: {
          screen: s, image: image(s), card: card(s),
          zones: s.links.flatMap((l) => { const box = parseTarget(l.box); return box && known(l.to) ? [{ id: linkId(s.id, l.box, l.to), box, to: l.to, opens: byId(l.to).name }] : []; }),
          faded: !!way && order < 0, editing: nav.editing === s.id, ...(order >= 0 ? { order: order + 1 } : {}),
        },
        ...size(s),
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, placedKey, shape, product.model, flow?.id, nav.editing]);

  const positions = (): Layout => Object.fromEntries(nodesRef.current.map((n) => [n.id, n.position]));
  const saveLayout = (layout: Layout | null) => host.api.saveLayout(at, 'screens', layout).then(onSnapshot).catch(fail);
  const { lines, change, moveEnd } = useLines('screens');
  const letGo = () => { setPending(undefined); setPointer(undefined); onTool(null); };
  // A click zone waits for its screen only while its tool is picked.
  useEffect(() => { if (tool !== 'zone') { setPending(undefined); setPointer(undefined); } }, [tool]);

  /** A new screen centred on a point, its name ready to type; opened by the pending click zone when there is one. */
  const addScreenAt = async (point: Pos, zone?: { screen: string; box: string }) => {
    const p = screenToFlowPosition(point);
    letGo();
    const id = await edit({
      op: 'add', type: 'screen', fields: { name: 'New screen' }, at: { x: p.x - BLANK.width / 2, y: p.y - BLANK.height / 2 }, layout: positions(),
      ...(zone ? { zone } : {}),
    });
    if (id) go({ selected: id, editing: id });
  };
  // A new arrow leaves the screens where they are: the automatic layout would move them all.
  const link = (screen: string, box: string, to: string) => edit({ op: 'add', type: 'link', parent: screen, fields: { box, to }, layout: positions() });
  const openLarge = (screen: string, to?: string) => {
    const s = byId(screen);
    if (!image(s)) { fail(new Error(`${s.name} has no picture yet: add a screenshot or draw a mockup, then mark what opens another screen on it.`)); return; }
    setDrawing({ screen, to });
  };
  /** A dashed arrow becomes a click zone: the step's target when it has one, or a box drawn on the screen opened large. */
  const fix = (m: Move) => (m.step.target ? void link(m.from, m.step.target, m.to) : openLarge(m.from, m.to));

  // Delete removes the selected arrow; Escape lets go.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if (typing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); void edit({ op: 'remove', id: sel }); setSel(undefined); }
      if (e.key === 'Escape') { setSel(undefined); go({ selected: undefined }); letGo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!ready && nodes.length === 0) return null;

  const edges: Edge<ArrowData>[] = [
    ...screens.flatMap((s) => s.links.filter((l) => known(l.to)).map((l): Edge<ArrowData> => {
      const id = linkId(s.id, l.box, l.to);
      const t = tone(id, s.id, l.to);
      return {
        id, source: s.id, target: l.to, type: 'arrow', zIndex: 1000,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: COLOUR[t] },
        style: { stroke: COLOUR[t], strokeWidth: sel === id ? 2.5 : t === 'lit' ? 2 : 1.5 },
        data: {
          box: parseTarget(l.box) ?? undefined, label: l.label, tone: t, selected: sel === id, editing: labelling === id,
          onEdit: () => { setSel(id); setLabelling(id); },
          onDone: (label) => {
            setLabelling(undefined);
            if (label !== undefined && label !== (l.label ?? '')) void edit({ op: 'modify', id, fields: { label } });
          },
          line: lines[id] ?? {},
          onLine: (line) => change(id, line),
          onEnd: (onto) => {
            if (onto.id === s.id) return;
            // It stays selected, under its new ID when it now opens another screen.
            void moveEnd(id, 'to', onto.glue, onto.id === l.to ? undefined : () => edit({ op: 'modify', id, fields: { to: onto.id } })).then(setSel);
          },
        },
      };
    })),
    ...[...gaps.values()].map((m): Edge<ArrowData> => ({
      id: `gap:${m.from}>${m.to}`, source: m.from, target: m.to, type: 'arrow', zIndex: 1000,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: COLOUR.gap },
      style: { stroke: COLOUR.gap, strokeWidth: 2, strokeDasharray: '6 5' },
      data: { box: parseTarget(m.step.target) ?? undefined, tone: 'gap', selected: false, editing: false, gap: m.step.label, onFix: () => fix(m) },
    })),
  ];

  const from = pending && nodes.find((n) => n.id === pending.screen);
  const drawn = drawing && byId(drawing.screen);
  return (
    <div
      className={cx('size-full', tool && '[&_.react-flow__pane]:!cursor-crosshair [&_.react-flow__node]:!cursor-crosshair')}
      onMouseMove={(e) => { if (pending) setPointer(screenToFlowPosition({ x: e.clientX, y: e.clientY })); }}
      onDoubleClick={(e) => {
        // Double-click on empty canvas adds a screen there.
        if ((e.target as Element).classList.contains('react-flow__pane') && !tool && !pending) void addScreenAt({ x: e.clientX, y: e.clientY });
      }}
    >
      {(tool === 'zone' || pending) && !drawing && (
        <div data-map-hint className="absolute left-1/2 top-16 z-10 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-white px-4 py-1.5 text-[13px] text-neutral-700 shadow-sm ring-1 ring-neutral-200 lg:top-3">
          {pending ? 'Click the screen it opens, or an empty spot for a new screen' : 'Click the screen the button, link or tab is on'}
          <button onClick={letGo} title="Cancel" className="rounded p-0.5 text-neutral-400 hover:text-neutral-800"><X className="size-4" /></button>
        </div>
      )}
      <LightContext.Provider value={light}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: { top: '64px', bottom: '28px', left: '28px', right: '28px' } }}
          minZoom={0.1}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          nodesConnectable={false}
          // The map keeps what is selected itself (an arrow, or a screen): React Flow's own selection would re-render the arrows under the pointer.
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
          onNodesChange={(changes) => setNodes((n) => applyNodeChanges(changes.filter((c) => c.type === 'position' || c.type === 'dimensions'), n))}
          onNodeDragStop={() => void saveLayout(positions())}
          onNodeMouseEnter={(_, n) => setOver(n.id)}
          onNodeMouseLeave={() => setOver(undefined)}
          onNodeClick={(_, n) => {
            if (pending) { if (n.id !== pending.screen) { void link(pending.screen, pending.box, n.id); letGo(); } return; }
            if (tool === 'zone') { openLarge(n.id); return; }
            setSel(undefined);
            go({ selected: n.id });
          }}
          onNodeDoubleClick={(_, n) => { if (!tool && !pending) go({ screen: n.id, selected: undefined }); }}
          onEdgeClick={(_, e) => { if (e.data?.onFix) e.data.onFix(); else { setSel(e.id); go({ selected: undefined }); } }}
          onEdgeDoubleClick={(_, e) => e.data?.onEdit?.()}
          onPaneClick={(e) => {
            if (pending) { void addScreenAt({ x: e.clientX, y: e.clientY }, pending); return; }
            if (tool === 'screen') { void addScreenAt({ x: e.clientX, y: e.clientY }); return; }
            setSel(undefined);
            go({ selected: undefined });
          }}
        >
          <Background gap={24} size={1} color="#ececec" />
          <Controls showInteractive={false} position="bottom-right" />
          {saved && (
            <Panel position="top-left" className="!m-3 !mt-16">
              <Tip label="Lay the map out automatically again">
                <button data-tidy-up onClick={() => void saveLayout(null)} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[12px] text-neutral-600 shadow-sm ring-1 ring-neutral-200 hover:text-neutral-900">
                  <Wand2 className="size-3.5" /> Tidy up
                </button>
              </Tip>
            </Panel>
          )}
          {from && pointer && (
            <ViewportPortal>
              <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" style={{ zIndex: 1002 }}>
                <path d={curve(ends(zoneRect(cardRect(from.position, from.data), parseTarget(pending!.box)!), cardRect(from.position, from.data), { ...pointer, w: 0, h: 0 }, false)).path} fill="none" stroke={COLOUR.lit} strokeWidth={2} strokeDasharray="6 5" />
              </svg>
            </ViewportPortal>
          )}
        </ReactFlow>
      </LightContext.Provider>
      {drawn && (
        <LargeScreen
          path={image(drawn)!}
          ratio={ratios?.get(image(drawn)!) ?? BLANK.width / BLANK.height}
          hint={drawing!.to ? `Drag around what opens ${byId(drawing!.to).name}` : 'Drag around what opens another screen'}
          zones={drawn.links.filter((l) => known(l.to)).map((l) => ({ box: l.box, opens: byId(l.to).name }))}
          onDraw={(box) => {
            const { screen, to } = drawing!;
            setDrawing(undefined);
            if (!box) return;
            if (to) void link(screen, box, to);
            else setPending({ screen, box });
          }}
          onClose={() => { setDrawing(undefined); letGo(); }}
        />
      )}
    </div>
  );
}

// ---- A screen, its click zones, and the arrows --------------------------------------------------

function ScreenNode({ data }: NodeProps<Node<ScreenData>>) {
  const { screen: s, card, zones, faded, editing, order } = data;
  const { edit, go } = useApp();
  const light = useContext(LightContext)!;
  const selected = light.focus === s.id;
  const target = light.target === s.id;
  return (
    <div data-map-screen={s.name} title={s.id} className={cx('relative', faded && 'opacity-35')} style={{ width: card.width }}>
      <Handle type="source" position={Position.Right} isConnectable={false} className="!opacity-0" />
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <div
        className={cx('relative overflow-hidden rounded-2xl bg-white shadow-xs ring-1 ring-neutral-200', selected && '!ring-2 !ring-neutral-900 ring-offset-2', target && '!ring-2 !ring-blue-500 ring-offset-2')}
        style={{ height: card.height }}
      >
        {data.image ? <Picture path={data.image} alt={s.name} className="size-full object-contain" /> : <div className="flex size-full items-center justify-center"><Monitor className="size-8 text-neutral-300" /></div>}
        {target && <div className="absolute inset-0 bg-blue-500/5" />}
        {s.mockup && <span className="absolute left-2 top-2 rounded-full bg-amber-300 px-2 py-0.5 text-[11px] font-medium text-amber-950">Mockup</span>}
        {zones.map((z) => {
          const on = light.sel === z.id;
          return (
            <div
              key={z.id}
              data-zone={z.opens}
              title={`Opens ${z.opens}`}
              className={cx('nodrag absolute cursor-pointer rounded-[4px] border-2 border-blue-500', on ? 'bg-blue-500/30' : 'bg-blue-500/15', light.tone(z.id, s.id, z.to) === 'faded' && 'opacity-25')}
              style={{ left: `${z.box.x}%`, top: `${z.box.y}%`, width: `${z.box.w}%`, height: `${z.box.h}%` }}
              onClick={(e) => { e.stopPropagation(); light.onZone(z.id); }}
              onMouseEnter={() => light.onHover(z.id)}
              onMouseLeave={() => light.onHover(undefined)}
            >
              {on && (
                <button title="Remove" onClick={(e) => { e.stopPropagation(); light.onRemove(z.id); }} className="absolute -right-2 -top-2 rounded-full bg-blue-500 p-0.5 text-white shadow-sm hover:bg-blue-600">
                  <X className="size-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {order !== undefined && <span data-order className="absolute -left-2.5 -top-2.5 flex size-6 items-center justify-center rounded-full bg-neutral-900 text-[12px] font-semibold text-white shadow-sm">{order}</span>}
      {selected && (
        <span className="absolute -right-3 -top-3">
          <Tip label={s.mockup ? 'Edit the mockup' : 'Draw a mockup'}>
            <button data-open-mockup onClick={(e) => { e.stopPropagation(); go({ screen: s.id, selected: undefined }); }} className="rounded-full bg-white p-1.5 text-neutral-600 shadow-sm ring-1 ring-neutral-200 hover:text-neutral-900">
              <Pencil className="size-3.5" />
            </button>
          </Tip>
        </span>
      )}
      <div className="mt-2 text-[13px] font-medium text-neutral-800" onDoubleClick={(e) => { e.stopPropagation(); go({ editing: s.id }); }}>
        {editing
          ? <span className="nodrag block"><EditableText value={s.name} startEditing placeholder="Screen name…" onDone={() => go({ editing: undefined })} onSave={(name) => void edit({ op: 'modify', id: s.id, fields: { name } })} /></span>
          : <span className="block truncate">{s.name}</span>}
      </div>
    </div>
  );
}

/** A screen's picture on the map, from where its node is. */
const cardRect = (at: Pos, data: ScreenData): Rect => ({ ...at, w: data.card.width, h: data.card.height });
const zoneRect = (c: Rect, b: Target): Rect => ({ x: c.x + (c.w * b.x) / 100, y: c.y + (c.h * b.y) / 100, w: (c.w * b.w) / 100, h: (c.h * b.h) / 100 });

/**
 * Where an arrow starts and ends: it leaves its click zone (`from`, on the screen `card`) on the side
 * facing the screen it opens, and ends on that screen's facing side, level with the zone where it can,
 * so screens side by side get straight arrows. A screen in the same column is reached round the side.
 */
function ends(from: Rect, card: Rect, to: Rect, self: boolean) {
  const centre = from.x + from.w / 2;
  const column = to.x < card.x + card.w && card.x < to.x + to.w;
  const right = column ? centre >= card.x + card.w / 2 : to.x + to.w / 2 >= centre;
  // Arrows each way between two zones level with each other run side by side, not on one line.
  const sy = from.y + from.h / 2 + (right ? -1 : 1) * Math.min(4, from.h / 4);
  const intoRight = column ? right : !right;
  const ty = Math.min(to.y + to.h - 14, Math.max(to.y + 14, self ? sy + 36 : sy));
  return { sx: right ? from.x + from.w : from.x, sy, sRight: right, tx: intoRight ? to.x + to.w : to.x, ty, tRight: intoRight };
}

type Ends = ReturnType<typeof ends>;
type Curve = { path: string; mid: Pos; points: Pos[] };

/** A cubic curve's points, every twentieth of the way, to see what it crosses. */
const sample = (p0: Pos, p1: Pos, p2: Pos, p3: Pos): Pos[] => Array.from({ length: 21 }, (_, i) => {
  const t = i / 20;
  const [a, b, c, d] = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3];
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
});

/** A curve between an arrow's ends, leaving and entering each side straight. */
function curve(e: Ends): Curve {
  const s = { x: e.sx, y: e.sy };
  const t = { x: e.tx, y: e.ty };
  const reach = Math.max(50, Math.abs(e.tx - e.sx) / 2);
  const c1 = { x: s.x + (e.sRight ? reach : -reach), y: s.y };
  const c2 = { x: t.x + (e.tRight ? reach : -reach), y: t.y };
  const points = sample(s, c1, c2, t);
  return { path: `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${t.x} ${t.y}`, mid: points[10]!, points };
}

/** A path along straight lines with rounded corners, as round a block. */
function corners(points: Pos[]): Curve {
  const toward = (a: Pos, b: Pos, d: number) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: a.x + ((b.x - a.x) * d) / l, y: a.y + ((b.y - a.y) * d) / l }; };
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1]!, points[i]!, points[i + 1]!];
    const r = Math.min(14, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const [p, q] = [toward(b, a, r), toward(b, c, r)];
    path += ` L ${p.x} ${p.y} Q ${b.x} ${b.y}, ${q.x} ${q.y}`;
  }
  path += ` L ${points.at(-1)!.x} ${points.at(-1)!.y}`;
  const along = points.slice(1).flatMap((b, i) => Array.from({ length: 12 }, (_, k) => ({ x: points[i]!.x + ((b.x - points[i]!.x) * k) / 12, y: points[i]!.y + ((b.y - points[i]!.y) * k) / 12 })));
  return { path, mid: { x: (points[2]!.x + points[3]!.x) / 2, y: points[2]!.y }, points: along };
}

/**
 * The arrow's curve; when it would cross other screens, a way round them instead: out beside its own
 * screen, along a free row between the screens in between (or below or above them all), and in
 * beside the other. The way that crosses the fewest screens wins, the nearest first.
 */
function route(e: Ends, from: Rect, to: Rect, others: Rect[]): Curve {
  const crossed = (c: Curve) => others.filter((r) => c.points.some((p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h + CAPTION)).length;
  const direct = curve(e);
  if (!crossed(direct)) return direct;
  const out = e.sRight ? Math.max(from.x + from.w, e.sx) + 28 : Math.min(from.x, e.sx) - 28;
  const into = e.tRight ? to.x + to.w + 28 : to.x - 28;
  const between = others.filter((r) => r.x < Math.max(out, into) && Math.min(out, into) < r.x + r.w);
  const way = (y: number) => corners([{ x: e.sx, y: e.sy }, { x: out, y: e.sy }, { x: out, y }, { x: into, y }, { x: into, y: e.ty }, { x: e.tx, y: e.ty }]);
  // The rows free of the screens in between, by how near they are to the arrow's ends.
  const taken = between.map((r) => [r.y - 8, r.y + r.h + CAPTION + 8] as const).sort((a, b) => a[0] - b[0]);
  const rows = taken.slice(1).flatMap((r, i) => {
    const top = Math.max(...taken.slice(0, i + 1).map((t) => t[1]));
    return r[0] - top >= 16 ? [(top + r[0]) / 2] : [];
  }).sort((a, b) => Math.abs(a - (e.sy + e.ty) / 2) - Math.abs(b - (e.sy + e.ty) / 2));
  const ways = [direct, ...rows.map(way), way(Math.max(from.y + from.h, to.y + to.h, ...between.map((r) => r.y + r.h)) + CAPTION + 28), way(Math.min(from.y, to.y, ...between.map((r) => r.y)) - 36)];
  return ways.map((c) => ({ c, n: crossed(c) })).reduce((a, b) => (b.n < a.n ? b : a)).c;
}

/** A screen's picture as a box an arrow's end glues to; its name under it takes the end too. */
const spotOf = (n: { id: string; position: Pos; data: ScreenData }) => {
  const box = cardRect(n.position, n.data);
  return { id: n.id, box: { x: box.x, y: box.y, w: box.w, h: box.h }, area: { x: box.x, y: box.y, w: box.w, h: box.h + CAPTION } };
};

/**
 * An arrow from a click zone to the screen it opens, round the screens in between. Selected, it works
 * as a flow's connectors do: its end is dragged onto a dot or the border of the screen it opens,
 * or onto another screen; it is bent by its middle, and made curved, elbowed or straight. Once shaped,
 * it is drawn as shaped, through the screens.
 */
function Arrow({ id, source, target, markerEnd, style, data }: EdgeProps<Edge<ArrowData>>) {
  const s = useInternalNode<Node<ScreenData>>(source);
  const t = useInternalNode<Node<ScreenData>>(target);
  const nodes = useNodes<Node<ScreenData>>();
  const others = nodes.filter((n) => n.id !== source && n.id !== target).map((n) => cardRect(n.position, n.data));
  const { zoom } = useViewport();
  const [drag, setDrag] = useState<Drag>();
  if (!s || !t || !data) return null;
  const line = drag?.what === 'via' ? { ...data.line, via: drag.p } : data.line ?? {};
  const spots = () => nodes.map(spotOf);
  const glued = drag?.what === 'to' ? glueAt(spots(), drag.p, zoom) : undefined;
  const card = cardRect(s.internals.positionAbsolute, s.data);
  const toCard = drag?.what === 'to' && glued ? glued.box : cardRect(t.internals.positionAbsolute, t.data);
  const glue = drag?.what === 'to' ? glued?.glue : line.to;
  const free = drag?.what === 'to' && !glued;
  // Where the end is: glued to a point of the screen, following the pointer, or on the side facing the zone.
  const end = free ? drag.p : glue && { x: toCard.x + glue.x * toCard.w, y: toCard.y + glue.y * toCard.h };
  const zone = data.box ? zoneRect(card, data.box) : card;
  const e = ends(zone, card, line.via ? { ...line.via, w: 0, h: 0 } : end ? { ...end, w: 0, h: 0 } : toCard, source === target && !drag);
  const shaped = !!(line.shape || line.via || line.to || drag);
  let path: string, mid: Pos, b: Pos;
  if (shaped) {
    const a = { x: e.sx, y: e.sy, pos: e.sRight ? Position.Right : Position.Left };
    const ending = end && !glue ? facing(end, line.via ?? a) : glue ? endOn(toCard, glue, a) : { x: e.tx, y: e.ty, pos: e.tRight ? Position.Right : Position.Left };
    if (!glue && !end && line.via) Object.assign(ending, endOn(toCard, undefined, line.via));
    const [p, mx, my] = linePath(a, ending, line);
    [path, mid, b] = [p, { x: mx, y: my }, ending];
  } else {
    ({ path, mid } = route(e, card, toCard, others));
    b = { x: e.tx, y: e.ty };
  }
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={16} />
      {(data.label || data.editing || data.gap !== undefined) && (
        <EdgeLabelRenderer>
          <div
            data-arrow-label={data.label ?? ''}
            style={{ transform: `translate(-50%, ${data.selected ? '-170%' : '-50%'}) translate(${mid.x}px, ${mid.y}px)`, zIndex: 1001 }}
            className={cx('nodrag nopan pointer-events-auto absolute', data.tone === 'faded' && 'opacity-40')}
            onDoubleClick={(ev) => { ev.stopPropagation(); data.onEdit?.(); }}
          >
            {data.gap !== undefined ? (
              <button data-gap title={`“${data.gap}” goes there, but no click zone does yet`} onClick={data.onFix} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11.5px] font-medium text-amber-900 ring-1 ring-amber-300 hover:bg-amber-200">
                <Plus className="size-3" /> Click zone
              </button>
            ) : (
              <div className={cx('rounded-md px-1.5 py-0.5 text-[11.5px]', data.selected ? 'bg-blue-600 text-white' : 'bg-white text-neutral-600 ring-1 ring-neutral-200')}>
                {data.editing ? (
                  <input
                    autoFocus
                    defaultValue={data.label ?? ''}
                    placeholder="when, or how"
                    onBlur={(ev) => data.onDone?.(ev.target.value.trim())}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); if (ev.key === 'Escape') data.onDone?.(); }}
                    className="w-28 bg-transparent text-center outline-none"
                  />
                ) : data.label}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
      {data.selected && data.onEnd && data.onLine && (
        <LineControls
          a={{ x: e.sx, y: e.sy }} b={b} mid={mid} labelled={!!(data.label || data.editing)} line={data.line ?? {}} ends={['to']}
          drag={drag} setDrag={setDrag} glued={glued} spots={spots} onLine={data.onLine} onEnd={(_, onto) => data.onEnd!(onto)} onEdit={() => data.onEdit?.()}
        />
      )}
    </>
  );
}

const NODE_TYPES = { screen: ScreenNode };
const EDGE_TYPES = { arrow: Arrow };

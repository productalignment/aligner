// A flow as a flowchart: shapes carry the step types, a step's screen shows inside it, and
// the jobs the flow serves are colour dots. No IDs.
import {
  applyNodeChanges, Background, BaseEdge, ConnectionMode, Controls, EdgeLabelRenderer, Handle, MarkerType, Panel, Position, ReactFlow, ReactFlowProvider,
  useInternalNode, useReactFlow, useViewport, type Edge, type EdgeProps, type InternalNode, type Node, type NodeProps,
} from '@xyflow/react';
import { Link2, Pencil, SquareMousePointer, Wand2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Layout, Line } from '@aligner/core/api';
import { STEP_TYPES, type Flow, type Job, type Screen, type Step, type StepType } from '@aligner/core/context';
import { jobColours, screenImage, useApp } from '../state';
import { AddInline, DeleteButton, EditableText, Popover } from '../components/edit';
import { cx, Dot, Label, Tip } from '../components/ui';
import { endOn, facing, glueAt, LineControls, linePath, useLines, type Box, type Drag, type End, type Glued } from '../components/connector';
import { placeAll, useElkLayout } from '../components/layout';
import { fitBox, usePictureRatio, usePictureRatios } from '../components/Picture';
import { LargeScreen, TargetPicture } from '../components/Target';

export const TYPE_NAME: Record<StepType, string> = {
  'start-end': 'Start or end', 'user-action': 'User action', 'user-decision': 'User decision',
  'system-action': 'System action', 'system-decision': 'System decision',
};

/** System steps (what the backend does) are violet; the user's are neutral. */
const SYSTEM = (t: StepType) => t === 'system-action' || t === 'system-decision';

/** The step types as small shapes, for pickers. */
export function ShapeIcon({ type, className }: { type: StepType; className?: string }) {
  const stroke = 'currentColor';
  return (
    <svg viewBox="0 0 24 16" className={cx('h-4 w-6', className)} fill="none" stroke={stroke} strokeWidth="1.6">
      {type === 'start-end' && <rect x="2" y="3" width="20" height="10" rx="5" fill="currentColor" />}
      {type === 'user-action' && <rect x="3" y="2.5" width="18" height="11" rx="2" />}
      {type === 'system-action' && <rect x="3" y="2.5" width="18" height="11" rx="2" />}
      {(type === 'user-decision' || type === 'system-decision') && <polygon points="12,1 22,8 12,15 2,8" />}
    </svg>
  );
}

const NO_JOB = '-';

export function Flows() {
  const { product, nav, go, edit } = useApp();
  const flows = product.model.flows;
  const flow = flows.find((f) => f.id === nav.flow) ?? flows[0];
  const colours = jobColours(product.model);
  const jobs = product.model.personas.flatMap((p) => p.jobs);
  const unlinked = flows.filter((f) => !f.jobs.some((id) => jobs.some((j) => j.id === id)));
  // The job the menu is filtered to: a job's ID, NO_JOB for the flows that serve none, or '' for all (also once the chosen one is gone).
  const [chosen, setJob] = useState('');
  const job = (chosen === NO_JOB ? unlinked.length > 0 : jobs.some((j) => j.id === chosen)) ? chosen : '';
  const shown = job === NO_JOB ? unlinked : job ? flows.filter((f) => f.jobs.includes(job)) : flows;
  // A shape picked in the toolbar, waiting for a click on the canvas to place it.
  const [placing, setPlacing] = useState<StepType | null>(null);
  useEffect(() => setPlacing(null), [flow?.id]);
  return (
    // The flows are a menu on the left; on a phone it sits above the flow, and the view scrolls so the canvas keeps room to draw in.
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 md:flex-row md:overflow-hidden">
      <nav data-flow-menu className="flex shrink-0 flex-col gap-0.5 md:w-56 md:overflow-y-auto">
        {jobs.length > 0 && (
          <select data-job-filter value={job} onChange={(e) => setJob(e.target.value)} className="mb-1.5 w-full truncate rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-600">
            <option value="">All jobs</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.name ?? j.text}</option>)}
            {unlinked.length > 0 && <option value={NO_JOB}>Serves no job yet</option>}
          </select>
        )}
        {shown.map((f) => (
          <button
            key={f.id}
            title={f.id}
            data-flow-link={f.name}
            aria-current={f.id === flow?.id ? 'page' : undefined}
            onClick={() => go({ flow: f.id, selected: undefined })}
            className={cx('flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors', f.id === flow?.id ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-white hover:text-neutral-900')}
          >
            <span className="mt-[5px] flex shrink-0 gap-0.5">{f.jobs.length ? f.jobs.map((j) => <Dot key={j} colour={colours.get(j)} className="size-2" />) : <Dot className="size-2" />}</span>
            {f.name}
          </button>
        ))}
        <AddInline label="Flow" placeholder="Flow name…" once onAdd={async (name) => { const id = await edit({ op: 'add', type: 'flow', fields: job && job !== NO_JOB ? { name, jobs: [job] } : { name } }); if (id) go({ flow: id, selected: undefined }); }} />
      </nav>
      {flow ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <FlowHeader flow={flow} />
          <div className="relative min-h-[28rem] flex-1 overflow-hidden rounded-2xl bg-white shadow-xs">
            <Toolbar placing={placing} onPlacing={setPlacing} />
            <ReactFlowProvider key={flow.id}><FlowDiagram flow={flow} placing={placing} onPlaced={() => setPlacing(null)} /></ReactFlowProvider>
            {/* The selected step's panel floats over the canvas, so selecting never resizes the canvas under the pointer. */}
            <StepPanel flow={flow} />
          </div>
        </div>
      ) : (
        <p className="flex-1 pt-32 text-center text-sm text-neutral-400">No flows yet. Add one in the list, or from a job on the Product page.</p>
      )}
    </div>
  );
}

function FlowHeader({ flow }: { flow: Flow }) {
  const { product, edit, nav, go } = useApp();
  const [linking, setLinking] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const colours = jobColours(product.model);
  const jobs = product.model.personas.flatMap((p) => p.jobs);
  const served = flow.jobs.flatMap((id) => jobs.filter((j) => j.id === id));
  const openJob = (job: string) => go({ view: 'product', job, selected: undefined });
  return (
    <div className="group/item mb-3 flex flex-wrap items-center gap-3">
      <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
        <EditableText value={flow.name} title={flow.id} startEditing={nav.editing === flow.id} onDone={() => go({ editing: undefined })} onSave={(name) => void edit({ op: 'modify', id: flow.id, fields: { name } })} />
      </h1>
      {served.length > 0 && (
        <span className="relative min-w-0 max-w-full">
          {/* The jobs it serves, as a link to them on the Product page: one opens it, several offer a choice. */}
          <button
            data-flow-jobs
            onClick={() => (served.length === 1 ? openJob(served[0]!.id) : setChoosing(true))}
            className="inline-flex max-w-[min(36rem,100%)] items-center gap-2 text-[13px] text-neutral-600 underline decoration-neutral-300 underline-offset-4 hover:text-neutral-900 hover:decoration-neutral-900"
          >
            {served.map((j) => <Dot key={j.id} colour={colours.get(j.id)} />)}
            <span className="truncate">{served.length === 1 ? served[0]!.name ?? served[0]!.text : `Serves ${served.length} jobs`}</span>
          </button>
          {choosing && (
            <Popover onClose={() => setChoosing(false)} width={420}>
              {served.map((j) => (
                <button key={j.id} data-open-job={j.text} title={j.id} onClick={() => openJob(j.id)} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-50">
                  <Dot colour={colours.get(j.id)} className="mt-1" />
                  <JobLabel job={j} />
                </button>
              ))}
            </Popover>
          )}
        </span>
      )}
      <span className="relative">
        <button
          data-link-jobs
          onClick={() => setLinking(true)}
          title="Which jobs it serves"
          className={served.length ? 'rounded p-1 text-neutral-400 hover:bg-white hover:text-neutral-800' : 'rounded-full px-2.5 py-1 text-[13px] italic text-neutral-500 hover:bg-white hover:text-neutral-800'}
        >
          {served.length ? <Link2 className="size-3.5" /> : 'Which job does this flow serve?'}
        </button>
        {linking && <JobPicker flow={flow} onClose={() => setLinking(false)} />}
      </span>
      <DeleteButton label="Delete flow" onDelete={() => void edit({ op: 'remove', id: flow.id }).then(() => go({ flow: undefined, selected: undefined }))} />
    </div>
  );
}

/** A job in a list: its name over its sentence, or the sentence alone while it has no name. */
function JobLabel({ job }: { job: Job }) {
  if (!job.name) return <span>{job.text}</span>;
  return <span><span className="block font-medium text-neutral-900">{job.name}</span><span className="text-neutral-500">{job.text}</span></span>;
}

/** The jobs a flow serves, chosen by their names and sentences, grouped by persona. */
function JobPicker({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const { product, edit } = useApp();
  const colours = jobColours(product.model);
  const toggle = (id: string) => {
    const jobs = flow.jobs.includes(id) ? flow.jobs.filter((j) => j !== id) : [...flow.jobs, id];
    void edit({ op: 'modify', id: flow.id, fields: { jobs } });
  };
  return (
    <Popover onClose={onClose} width={420}>
      <div className="max-h-80 overflow-auto">
        {product.model.personas.map((p) => (
          <div key={p.id} className="mb-1">
            <Label className="px-2 pb-1 pt-2">{p.name}</Label>
            {p.jobs.map((j) => (
              <label key={j.id} title={j.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-neutral-700 hover:bg-neutral-50">
                <input type="checkbox" className="mt-0.5 accent-neutral-900" checked={flow.jobs.includes(j.id)} onChange={() => toggle(j.id)} />
                <Dot colour={colours.get(j.id)} className="mt-1" />
                <JobLabel job={j} />
              </label>
            ))}
          </div>
        ))}
        {!product.model.personas.some((p) => p.jobs.length) && <p className="px-2 py-3 text-[13px] text-neutral-400">No jobs yet. Add them to a persona on the Product page.</p>}
      </div>
    </Popover>
  );
}

/** The shapes. Click one, then click the canvas to put it there, ready to type in. */
function Toolbar({ placing, onPlacing }: { placing: StepType | null; onPlacing: (t: StepType | null) => void }) {
  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-xl bg-white/95 p-1 shadow-sm ring-1 ring-neutral-200">
      {STEP_TYPES.map((t) => [
        t === 'system-action' && <span key="divider" className="mx-0.5 h-5 w-px bg-neutral-200" />,
        <Tip key={t} label={TYPE_NAME[t]}>
          <button
            data-step-type={t}
            aria-pressed={placing === t}
            onClick={() => onPlacing(placing === t ? null : t)}
            className={cx('rounded-lg px-1.5 py-1', placing === t ? 'bg-neutral-900 text-white' : SYSTEM(t) ? 'text-violet-500 hover:bg-violet-50' : 'text-neutral-500 hover:bg-neutral-100')}
          >
            <ShapeIcon type={t} />
          </button>
        </Tip>,
      ])}
    </div>
  );
}

// ---- Canvas -----------------------------------------------------------------------
// Miro/FigJam basics: pick a shape and click to place it; drag a step to move it; drag
// from one of its dots to another step to connect them, or to empty space for a new step; double-click
// to add a step or edit a label; click to select; Delete removes. Where the PM puts steps is kept beside the flow (`FL-nnn.layout.json`).

type StepData = { step: Step; selected: boolean; editing: boolean; image?: string; picture: { width: number; height: number } };

const DECISION = (t: StepType) => t === 'user-decision' || t === 'system-decision';
const CAPTION = 52;
/** A decision is a small diamond with its question written below it, as a gateway in BPMN. */
const GATEWAY = 56;
const QUESTION = { width: 150, height: 50 };
/** A step with a screen shows the picture in its own shape: wide for desktop screenshots, tall for phones. */
const pictureBox = (ratio: number | undefined) => fitBox(ratio ?? 0.75, 240, 160);
function sizeOf(step: Step, image: string | undefined, ratio: number | undefined) {
  if (DECISION(step.step_type)) return { width: GATEWAY, height: GATEWAY };
  if (image) {
    const box = pictureBox(ratio);
    return { width: Math.max(box.width, 160), height: box.height + CAPTION };
  }
  return step.step_type === 'start-end' ? { width: 170, height: 48 } : { width: 180, height: 60 };
}

function FlowDiagram({ flow, placing, onPlaced }: { flow: Flow; placing: StepType | null; onPlaced: () => void }) {
  const { product, at, nav, go, edit, host, onSnapshot, fail } = useApp();
  const { screenToFlowPosition } = useReactFlow();
  const saved = product.layouts[flow.id];
  const image = (s: Step) => (DECISION(s.step_type) ? undefined : screenImage(product.model, s.screen));
  const ratios = usePictureRatios(flow.steps.flatMap((s) => image(s) ?? []));
  const size = (s: Step) => sizeOf(s, image(s), image(s) ? ratios?.get(image(s)!) : undefined);
  const shape = `${flow.steps.map((s) => `${s.id}${s.step_type}:${size(s).width}x${size(s).height}`).join(',')}|${flow.connections.map((c) => `${c.from}>${c.to}`).join(',')}`;
  // The automatic layout, only while the PM hasn't placed anything.
  // A decision's question takes room below it, so the layout keeps that much free on both sides of the diamond.
  const room = (s: Step) => (DECISION(s.step_type) ? { width: QUESTION.width, height: GATEWAY + 2 * QUESTION.height } : size(s));
  const laidOut = useElkLayout(
    saved ? [] : flow.steps.map((s) => ({ id: s.id, ...room(s) })),
    saved ? [] : flow.connections.map((c) => ({ id: `${c.from}>${c.to}`, source: c.from, target: c.to })),
    `flow:${flow.id}:${at.repo}@${at.branch}:${saved ? 'saved' : shape}`,
  );
  const auto = laidOut && new Map([...laidOut].map(([id, p]) => {
    const s = flow.steps.find((x) => x.id === id);
    return [id, s && DECISION(s.step_type) ? { x: p.x + (QUESTION.width - GATEWAY) / 2, y: p.y + QUESTION.height } : p];
  }));
  const step = (id: string) => flow.steps.find((s) => s.id === id)!;
  const placed = saved ? placeAll(flow.steps.map((s) => s.id), saved, (id) => flow.connections.filter((c) => c.to === id).map((c) => c.from), (id) => size(step(id)).width, 90, 200) : auto;
  const ready = !!placed && !!ratios;

  const [nodes, setNodes] = useState<Node<StepData>[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [edgeSel, setEdgeSel] = useState<string>();
  const [edgeEditing, setEdgeEditing] = useState<string>();

  // The nodes follow the files; while a step is dragged they follow the pointer until it's dropped and saved.
  const placedKey = placed ? JSON.stringify([...placed]) : '';
  useEffect(() => {
    if (!ready) return;
    setNodes(flow.steps.map((s) => ({
      id: s.id,
      type: 'step',
      position: placed!.get(s.id) ?? { x: 0, y: 0 },
      data: { step: s, selected: nav.selected === s.id, editing: nav.editing === s.id, image: image(s), picture: pictureBox(image(s) ? ratios?.get(image(s)!) : undefined) },
      ...size(s),
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, placedKey, shape, flow, nav.selected, nav.editing]);

  const positions = (): Layout => Object.fromEntries(nodesRef.current.map((n) => [n.id, n.position]));
  const saveLayout = (layout: Layout | null) => host.api.saveLayout(at, flow.id, layout).then(onSnapshot).catch(fail);
  const { lines, change, moveEnd } = useLines(flow.id);
  /** A connector's end dropped on a step: glued there on its own step, or moved onto another one, keeping its shape. */
  const dropEnd = (c: { from: string; to: string }, end: End, onto: Glued) => {
    const id = `${c.from}>${c.to}`;
    if (onto.id === c[end]) return moveEnd(id, end, onto.glue);
    const moved = { ...c, [end]: onto.id };
    if (moved.from === moved.to || flow.connections.some((x) => x.from === moved.from && x.to === moved.to)) return Promise.resolve(id);
    return moveEnd(id, end, onto.glue, () => edit({ op: 'modify', id, fields: { [end]: onto.id } }));
  };

  /**
   * A new step centred on a point on the screen, optionally connected from another step. It starts
   * with no label and its text box open; left empty, it stays an empty shape.
   */
  const addStepAt = async (point: { x: number; y: number }, link?: Step, type?: StepType) => {
    const at = screenToFlowPosition(point);
    const step_type: StepType = type ?? 'user-action';
    const box = sizeOf({ id: '', step_type, label: '' }, undefined, undefined);
    const id = await edit({
      op: 'add', type: 'step', parent: flow.id, ...(link ? { link: link.id } : {}),
      at: { x: at.x - box.width / 2, y: at.y - box.height / 2 }, layout: positions(),
      fields: { step_type, label: '' },
    });
    // Only its text box opens, as on a whiteboard; the step's panel waits for a click on it.
    if (id) go({ selected: undefined, editing: id });
  };

  // Delete removes what's selected; Escape lets go.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if (typing) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (edgeSel) { e.preventDefault(); void edit({ op: 'remove', id: edgeSel }); setEdgeSel(undefined); }
        else if (nav.selected && flow.steps.some((s) => s.id === nav.selected)) { e.preventDefault(); void edit({ op: 'remove', id: nav.selected }).then(() => go({ selected: undefined })); }
      }
      if (e.key === 'Escape') { setEdgeSel(undefined); go({ selected: undefined }); onPlaced(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Until the first layout is ready there's nothing to show. After that the canvas stays up while a
  // save reloads the pictures and positions, so the view never jumps.
  if (!ready && nodes.length === 0) return null;

  const edges: Edge<ConnectorData>[] = flow.connections.map((c) => {
    const id = `${c.from}>${c.to}`;
    const lit = edgeSel === id || nav.selected === c.from || nav.selected === c.to;
    const colour = edgeSel === id ? '#171717' : lit ? '#404040' : '#a3a3a3';
    return {
      id, source: c.from, target: c.to, type: 'connector',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: colour },
      style: { stroke: colour, strokeWidth: edgeSel === id ? 2.5 : lit ? 2 : 1.5 },
      data: {
        label: c.label, line: lines[id] ?? {}, selected: edgeSel === id, editing: edgeEditing === id,
        // It stays selected, as on Miro, under its new ID when it now joins other steps.
        onEnd: (end, onto) => void dropEnd(c, end, onto).then(setEdgeSel),
        onLine: (line) => change(id, line),
        onEdit: () => { setEdgeSel(id); setEdgeEditing(id); },
        onDone: (label?: string) => {
          setEdgeEditing(undefined);
          if (label !== undefined && label !== (c.label ?? '')) void edit({ op: 'modify', id, fields: { label } });
        },
      },
    };
  });

  return (
    <div
      className={cx('size-full', placing && '[&_.react-flow__pane]:!cursor-crosshair')}
      onDoubleClick={(e) => {
        // Double-click on empty canvas adds a step there.
        if ((e.target as Element).classList.contains('react-flow__pane')) void addStepAt({ x: e.clientX, y: e.clientY });
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={50}
        proOptions={{ hideAttribution: true }}
        onNodesChange={(changes) => setNodes((n) => applyNodeChanges(changes.filter((c) => c.type === 'position' || c.type === 'dimensions'), n))}
        onNodeDragStop={() => void saveLayout(positions())}
        onNodeClick={(_, n) => { setEdgeSel(undefined); go({ selected: n.id }); }}
        onNodeDoubleClick={(_, n) => go({ selected: n.id, editing: n.id })}
        onEdgeClick={(_, e) => { setEdgeSel(e.id); go({ selected: undefined }); }}
        onEdgeDoubleClick={(_, e) => { setEdgeSel(e.id); setEdgeEditing(e.id); }}
        onPaneClick={(e) => {
          setEdgeSel(undefined);
          go({ selected: undefined });
          // A shape picked in the toolbar goes where the canvas was clicked; then the tool lets go, as on a whiteboard.
          if (placing) { onPlaced(); void addStepAt({ x: e.clientX, y: e.clientY }, undefined, placing); }
        }}
        onConnect={({ source, target }) => {
          if (!source || !target || source === target || flow.connections.some((c) => c.from === source && c.to === target)) return;
          void edit({ op: 'add', type: 'connection', parent: flow.id, fields: { from: source, to: target } });
        }}
        onConnectEnd={(e, state) => {
          if (state.toNode || !state.fromNode) return; // a dot was reached: onConnect has it
          const point = 'changedTouches' in e ? e.changedTouches[0]! : e;
          const from = flow.steps.find((s) => s.id === state.fromNode!.id);
          if (!from) return;
          // Dropped anywhere on a step connects to it, as on a whiteboard; on empty canvas, it makes a new step there.
          const onto = document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node')?.getAttribute('data-id');
          if (onto && onto !== from.id) {
            if (!flow.connections.some((c) => c.from === from.id && c.to === onto)) void edit({ op: 'add', type: 'connection', parent: flow.id, fields: { from: from.id, to: onto } });
          } else if (!onto) void addStepAt({ x: point.clientX, y: point.clientY }, from);
        }}
      >
        <Background gap={24} size={1} color="#ececec" />
        <Controls showInteractive={false} position="bottom-right" />
        {saved && (
          <Panel position="top-left" className="!m-3 !mt-16">
            <Tip label="Lay the flow out automatically again">
              <button data-tidy-up onClick={() => void saveLayout(null)} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[12px] text-neutral-600 shadow-sm ring-1 ring-neutral-200 hover:text-neutral-900">
                <Wand2 className="size-3.5" /> Tidy up
              </button>
            </Tip>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

/** Four dots on a step's sides, shown on hover: drag from one to draw a connector. */
function Dots() {
  const dot = '!size-3 !border-2 !border-neutral-400 !bg-white opacity-0 transition-opacity group-hover:opacity-100 hover:!border-neutral-900';
  return (
    <>
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].map((p) => (
        <Handle key={p} id={p} type="source" position={p} className={dot} />
      ))}
    </>
  );
}

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const { step, selected, editing, image, picture } = data;
  const { edit, go } = useApp();
  const label = editing
    ? <span className="nodrag block w-full"><EditableText value={step.label} startEditing multiline optional placeholder="Type…" className="block" inputClassName="text-center" onDone={() => go({ editing: undefined })} onSave={(l) => void edit({ op: 'modify', id: step.id, fields: { label: l } })} /></span>
    : <span className={DECISION(step.step_type) ? 'line-clamp-3' : 'line-clamp-2'}>{step.label}</span>;
  if (DECISION(step.step_type)) {
    const system = SYSTEM(step.step_type);
    return (
      <div data-step={step.label} title={step.id} className="group relative size-full">
        <Dots />
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible">
          <polygon points="50,2 98,50 50,98 2,50" fill={system ? '#f5f3ff' : '#ffffff'} stroke={selected ? '#171717' : system ? '#a78bfa' : '#a3a3a3'} strokeWidth={selected ? 5 : 3} />
        </svg>
        <div style={{ width: QUESTION.width }} className={cx('absolute left-1/2 top-full mt-1.5 -translate-x-1/2 text-center text-[12px] leading-tight', system ? 'text-violet-950' : 'text-neutral-800')}>{label}</div>
      </div>
    );
  }
  // The shape says the type; with a screen, the step is a card of it, captioned in the type's colours.
  const caption =
    step.step_type === 'start-end' ? 'bg-neutral-900 text-white'
      : step.step_type === 'system-action' ? 'bg-violet-50 text-violet-950'
          : 'bg-white text-neutral-900';
  const shape = image ? cx('rounded-xl bg-white ring-1', step.step_type === 'system-action' ? 'ring-violet-300' : 'ring-neutral-300')
    : step.step_type === 'start-end' ? 'rounded-full'
      : step.step_type === 'system-action' ? 'rounded-xl ring-1 ring-violet-300'
          : 'rounded-xl ring-1 ring-neutral-300';
  return (
    <div data-step={step.label} title={step.id} className="group relative size-full">
      <Dots />
      <div className={cx('flex size-full flex-col overflow-hidden text-center text-[12.5px] leading-tight shadow-xs', shape, !image && caption, selected && 'ring-2 !ring-neutral-900 ring-offset-2')}>
        {image && (
          <div className="flex shrink-0 justify-center border-b border-neutral-200 bg-neutral-50">
            <TargetPicture path={image} target={step.target} {...picture} />
          </div>
        )}
        <div className={cx('flex flex-1 items-center justify-center px-3', image && caption)}>{label}</div>
      </div>
    </div>
  );
}

type ConnectorData = {
  label?: string; line: Line; selected: boolean; editing: boolean; onEdit: () => void; onDone: (label?: string) => void;
  /** An end dropped on a step, glued to one of its dots or a point on its border, or (none) to the side facing the other end. */
  onEnd: (end: End, onto: Glued) => void;
  onLine: (line: Line) => void;
};

const boxOf = (n: InternalNode): Box => ({
  ...n.internals.positionAbsolute, w: n.measured.width ?? 0, h: n.measured.height ?? 0,
  diamond: DECISION((n.data as StepData).step.step_type),
});

/**
 * A connector between two steps, drawn as the PM shaped it. Selected, it works as on Miro:
 * drag an end onto a step's dot or border to glue it there, or onto another step to reconnect it;
 * drag its middle to bend it; pick curved, elbowed or straight above it. Its label is edited in place.
 */
function Connector({ id, source, target, markerEnd, style, data }: EdgeProps<Edge<ConnectorData>>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  const { getInternalNode, getNodes } = useReactFlow();
  const { zoom } = useViewport();
  const [drag, setDrag] = useState<Drag>();
  if (!s || !t || !data) return null;
  const line = drag?.what === 'via' ? { ...data.line, via: drag.p } : data.line;
  // While an end is dragged it shows where it would glue, on whichever step is under the pointer.
  const spots = () => getNodes().flatMap((n) => { const x = getInternalNode(n.id); return x ? [{ id: n.id, box: boxOf(x) }] : []; });
  const glued = drag && drag.what !== 'via' ? glueAt(spots(), drag.p, zoom) : undefined;
  const boxFor = (end: End) => (drag?.what === end && glued ? glued.box : boxOf(end === 'from' ? s : t));
  const glue = (end: End) => (drag?.what === end ? glued?.glue : line[end]);
  const [sb, tb] = [boxFor('from'), boxFor('to')];
  const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  // An end off every step follows the pointer; one glued somewhere is fixed; the others face what they lead to.
  const fixed = (end: End, b: Box) => (drag?.what === end && !glued ? drag.p : glue(end) && { x: b.x + glue(end)!.x * b.w, y: b.y + glue(end)!.y * b.h });
  const [pf, pt] = [fixed('from', sb), fixed('to', tb)];
  const a = pf && !glue('from') ? facing(pf, line.via ?? pt ?? centre(tb)) : endOn(sb, glue('from'), line.via ?? pt ?? centre(tb));
  const b = pt && !glue('to') ? facing(pt, line.via ?? pf ?? centre(sb)) : endOn(tb, glue('to'), line.via ?? pf ?? centre(sb));
  const [path, mx, my] = linePath(a, b, line);
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={20} />
      {(data.label || data.editing) && (
        <EdgeLabelRenderer>
          <div
            data-connector-label={data.label ?? ''}
            style={{ transform: `translate(-50%, ${data.selected ? '-170%' : '-50%'}) translate(${mx}px, ${my}px)` }}
            className={cx('nodrag nopan pointer-events-auto absolute rounded-md px-1.5 py-0.5 text-[11.5px]', data.selected ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 ring-1 ring-neutral-200')}
            onDoubleClick={(e) => { e.stopPropagation(); data.onEdit(); }}
          >
            {data.editing ? (
              <input
                autoFocus
                defaultValue={data.label ?? ''}
                placeholder="label"
                onBlur={(e) => data.onDone(e.target.value.trim())}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') data.onDone(); }}
                className="w-24 bg-transparent text-center outline-none"
              />
            ) : data.label}
          </div>
        </EdgeLabelRenderer>
      )}
      {data.selected && (
        <LineControls
          a={a} b={b} mid={{ x: mx, y: my }} labelled={!!(data.label || data.editing)} line={data.line} ends={['from', 'to']}
          drag={drag} setDrag={setDrag} glued={glued} spots={spots} onLine={data.onLine} onEnd={data.onEnd} onEdit={data.onEdit}
        />
      )}
    </>
  );
}

const NODE_TYPES = { step: StepNode };
const EDGE_TYPES = { connector: Connector };

// ---- The selected step -------------------------------------------------------------

const NEW_SCREEN = '+new';

function StepPanel({ flow }: { flow: Flow }) {
  const { product, nav, go, edit } = useApp();
  const step = flow.steps.find((s) => s.id === nav.selected);
  if (!step) return null;
  const screen = product.model.screens.find((s) => s.id === step.screen);
  const image = screenImage(product.model, step.screen);
  return (
    <aside data-step-panel className="absolute right-3 top-3 z-10 max-h-[calc(100%-1.5rem)] w-80 overflow-auto rounded-2xl bg-white p-5 shadow-lg ring-1 ring-neutral-200">
      <div className="mb-4 flex items-start gap-2">
        <div title={step.id} className={cx('min-w-0 flex-1 text-[16px] font-semibold leading-snug', step.label ? 'text-neutral-900' : 'text-neutral-400')}>{step.label || 'Untitled step'}</div>
        <button onClick={() => go({ selected: undefined })} className="rounded p-0.5 text-neutral-400 hover:text-neutral-700" title="Close"><X className="size-4" /></button>
      </div>

      <div className="mb-5 flex gap-1">
        {STEP_TYPES.map((t) => (
          <Tip key={t} label={TYPE_NAME[t]}><button onClick={() => void edit({ op: 'modify', id: step.id, fields: { step_type: t } })} className={cx('rounded-lg px-1.5 py-1', step.step_type === t ? 'bg-neutral-900 text-white' : SYSTEM(t) ? 'text-violet-500 hover:bg-violet-50' : 'text-neutral-400 hover:bg-neutral-100')}>
            <ShapeIcon type={t} />
          </button></Tip>
        ))}
      </div>

      <Section label="Screen">
        <select
          data-step-screen
          value={step.screen ?? ''}
          onChange={(e) => void (e.target.value === NEW_SCREEN
            // A new screen, named after the step until the PM renames it.
            ? edit({ op: 'add', type: 'screen', on: step.id, fields: { name: step.label.slice(0, 60) } })
            // A target marks a spot on the old screen, so it goes with it.
            : edit({ op: 'modify', id: step.id, fields: { screen: e.target.value || null, target: null } }))}
          className="w-full rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[13px]"
        >
          <option value="">No screen</option>
          {product.model.screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value={NEW_SCREEN}>+ New screen</option>
        </select>
        {screen && (
          <div className="mt-2 overflow-hidden rounded-xl bg-neutral-50 ring-1 ring-neutral-200">
            {image ? <StepPicture path={image} step={step} screen={screen} /> : <div className="flex h-24 items-center justify-center text-xs text-neutral-400">No screenshot yet</div>}
            <button data-open-screen onClick={() => go({ view: 'screens', screen: screen.id })} className="flex w-full items-center gap-1.5 border-t border-neutral-100 px-3 py-2 text-[12px] text-neutral-500 hover:text-neutral-900"><Pencil className="size-3.5" /> {screen.mockup ? 'Edit the mockup' : 'Draw a mockup'}</button>
          </div>
        )}
      </Section>

    </aside>
  );
}

/**
 * The step's screen with its target. The tap-zone tool opens the screen large over the page,
 * to drag on it and mark what the user taps, or to pick one of the screen's click zones.
 */
function StepPicture({ path, step, screen }: { path: string; step: Step; screen: Screen }) {
  const { product, edit } = useApp();
  const [drawing, setDrawing] = useState(false);
  const ratio = usePictureRatio(path);
  if (!ratio) return <div className="h-64" />;
  const save = (target: string | null) => { setDrawing(false); void edit({ op: 'modify', id: step.id, fields: { target } }); };
  const name = (id: string) => product.model.screens.find((s) => s.id === id)?.name ?? id;
  const zones = screen.links.map((l) => ({ box: l.box, opens: name(l.to) }));
  return (
    <div className="relative flex justify-center">
      <TargetPicture path={path} target={step.target} {...fitBox(ratio, 278, 380)} onChange={save} />
      <span className="absolute left-2 top-2 rounded-xl bg-white/95 p-1 shadow-sm ring-1 ring-neutral-200">
        <Tip label="Mark what the user taps" align="start">
          <button data-tap-zone aria-pressed={drawing} onClick={() => setDrawing(true)} className={cx('rounded-lg p-1.5', drawing ? 'bg-blue-500 text-white' : 'text-blue-500 hover:bg-blue-50')}>
            <SquareMousePointer className="size-4" />
          </button>
        </Tip>
      </span>
      {drawing && (
        <LargeScreen
          path={path} ratio={ratio} target={step.target} zones={zones} onDraw={save} onPick={save} onClose={() => setDrawing(false)}
          hint={zones.length ? 'Drag around what the user taps, or click one of the screen\u2019s click zones' : 'Drag on the screen around what the user taps'}
        />
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mb-5"><Label className="mb-1.5">{label}</Label>{children}</div>;
}

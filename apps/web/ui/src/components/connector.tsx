// Connectors as on Miro, for a flow's canvas and the map of the screens: a selected one gets a
// bar to make it curved, elbowed or straight, a handle in its middle to bend it, and handles on its
// ends, which glue to a dot or the border of the step or screen they are dropped on.
import { EdgeLabelRenderer, getBezierPath, getSmoothStepPath, Position, useReactFlow } from '@xyflow/react';
import { useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Line, Lines } from '@aligner/core/api';
import { useApp } from '../state';
import { cx, Tip } from './ui';

export type Pos = { x: number; y: number };
export type End = 'from' | 'to';
/** A step or screen's box on the canvas; a decision's outline is the diamond inside it. */
export type Box = { x: number; y: number; w: number; h: number; diamond?: boolean };
export type Ending = Pos & { pos: Position };

/** The four dots on a box's sides, in fractions of it. */
const DOTS: Pos[] = [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }];
const SHAPES: { shape: NonNullable<Line['shape']>; name: string; path: string }[] = [
  { shape: 'curved', name: 'Curved', path: 'M3 13 C 10 13, 14 3, 21 3' },
  { shape: 'elbow', name: 'Elbowed', path: 'M3 13 H 12 V 3 H 21' },
  { shape: 'straight', name: 'Straight', path: 'M3 13 L 21 3' },
];

const pointAt = (b: Box, f: Pos): Pos => ({ x: b.x + f.x * b.w, y: b.y + f.y * b.h });
const sideOf = (f: Pos): Position => (Math.abs(f.x - 0.5) >= Math.abs(f.y - 0.5) ? (f.x > 0.5 ? Position.Right : Position.Left) : (f.y > 0.5 ? Position.Bottom : Position.Top));

/** Where an end is on its box: where it's glued, or the middle of the side facing `toward`. */
export function endOn(b: Box, glue: Pos | undefined, toward: Pos): Ending {
  if (glue) return { ...pointAt(b, glue), pos: sideOf(glue) };
  const dx = toward.x - (b.x + b.w / 2);
  const dy = toward.y - (b.y + b.h / 2);
  const f = Math.abs(dx) / (b.w / 2 + 1) >= Math.abs(dy) / (b.h / 2 + 1) ? (dx > 0 ? DOTS[1]! : DOTS[3]!) : (dy > 0 ? DOTS[2]! : DOTS[0]!);
  return { ...pointAt(b, f), pos: sideOf(f) };
}

/** An end that isn't on a box (it follows the pointer), leaving toward a point. */
export const facing = (p: Pos, toward: Pos): Ending => ({ ...p, pos: endOn({ ...p, w: 0, h: 0 }, undefined, toward).pos });

/** The nearest point on a box's outline (its diamond, or the box), in fractions of the box, and how far it is. */
function nearestOnBorder(b: Box, p: Pos): { f: Pos; d: number } {
  const corners = b.diamond ? DOTS : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  let best = { f: corners[0]!, d: Infinity };
  corners.forEach((c, i) => {
    const [u, v] = [pointAt(b, c), pointAt(b, corners[(i + 1) % 4]!)];
    const len = (v.x - u.x) ** 2 + (v.y - u.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - u.x) * (v.x - u.x) + (p.y - u.y) * (v.y - u.y)) / len));
    const q = { x: u.x + t * (v.x - u.x), y: u.y + t * (v.y - u.y) };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { f: { x: (q.x - b.x) / (b.w || 1), y: (q.y - b.y) / (b.h || 1) }, d };
  });
  return best;
}

const inside = (b: Box, p: Pos) => (b.diamond
  ? Math.abs(p.x - (b.x + b.w / 2)) / (b.w / 2) + Math.abs(p.y - (b.y + b.h / 2)) / (b.h / 2) <= 1
  : p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);

/** What an end can be dropped on: its box, and the area that takes it besides (a screen's name under its picture). */
export type Spot = { id: string; box: Box; area?: Box };
export type Glued = { id: string; box: Box; glue?: Pos };

/**
 * Where a dragged end glues, as on Miro: to a dot near the pointer, to the border near it, or,
 * anywhere else on the step or screen, to the side facing the other end. Nothing off every one.
 */
export function glueAt(spots: Spot[], p: Pos, zoom: number): Glued | undefined {
  const near = 14 / zoom;
  for (const { id, box, area } of [...spots].reverse()) {
    const dot = DOTS.find((f) => { const q = pointAt(box, f); return Math.hypot(p.x - q.x, p.y - q.y) <= near; });
    if (dot) return { id, box, glue: dot };
    const border = nearestOnBorder(box, p);
    if (border.d <= near / 1.5) return { id, box, glue: border.f };
    if (inside(box, p) || (area && inside(area, p))) return { id, box };
  }
  return undefined;
}

/** The connector's path in its shape, through the point it was bent through, and the middle of it. */
export function linePath(a: Ending, b: Ending, line: Line): [string, number, number] {
  const ends = { sourceX: a.x, sourceY: a.y, sourcePosition: a.pos, targetX: b.x, targetY: b.y, targetPosition: b.pos };
  const via = line.via;
  if (line.shape === 'elbow') {
    const [path, x, y] = getSmoothStepPath({ ...ends, borderRadius: 10, offset: 20, ...(via ? { centerX: via.x, centerY: via.y } : {}) });
    return [path, x, y];
  }
  if (line.shape === 'straight') {
    return via ? [`M ${a.x} ${a.y} L ${via.x} ${via.y} L ${b.x} ${b.y}`, via.x, via.y] : [`M ${a.x} ${a.y} L ${b.x} ${b.y}`, (a.x + b.x) / 2, (a.y + b.y) / 2];
  }
  if (!via) { const [path, x, y] = getBezierPath(ends); return [path, x, y]; }
  // A curve that passes through the point it was bent through, halfway along.
  const c = { x: 2 * via.x - (a.x + b.x) / 2, y: 2 * via.y - (a.y + b.y) / 2 };
  return [`M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`, via.x, via.y];
}

/**
 * How the connectors of a flow, or the arrows of the map (`screens`), are drawn. A change shows at
 * once; the saved lines take over when they're back.
 */
export function useLines(of: string) {
  const { product, at, host, onSnapshot, fail } = useApp();
  const [drawing, setDrawing] = useState<Lines>();
  const lines = drawing ?? product.lines[of] ?? {};
  const save = (next: Lines) => {
    setDrawing(next);
    return host.api.saveLines(at, of, next).then(onSnapshot).catch(fail).finally(() => setDrawing(undefined));
  };
  return {
    lines,
    /** A line changed: its shape, or its bend. */
    change: (id: string, line: Line) => void save({ ...lines, [id]: line }),
    /**
     * An end dropped: glued where it was dropped on its own step or screen, or, with `reconnect`, moved onto
     * another one, which resolves to the connector's new ID. The server keeps its shape and other end.
     * Resolves to the connector's ID, new or not.
     */
    moveEnd: async (id: string, end: End, glue: Pos | undefined, reconnect?: () => Promise<string | undefined>) => {
      const { [id]: line = {}, ...rest } = lines;
      if (!reconnect) { void save({ ...rest, [id]: { ...line, [end]: glue } }); return id; }
      const next = await reconnect();
      if (next && glue) void save({ ...rest, [next]: { ...line, via: undefined, [end]: glue } });
      return next;
    },
  };
}

/** What's being dragged of a connector, kept by the connector to draw it there. */
export type Drag = { what: End | 'via'; p: Pos; moved?: boolean };

/**
 * The selected connector's bar of shapes, its middle handle and the handles on its draggable `ends`;
 * while an end is dragged, the dots of the box under it.
 */
export function LineControls({ a, b, mid, labelled, line, ends, drag, setDrag, glued, spots, onLine, onEnd, onEdit }: {
  a: Pos; b: Pos; mid: Pos; labelled: boolean; line: Line; ends: End[];
  drag?: Drag; setDrag: (d?: Drag) => void; glued?: Glued; spots: () => Spot[];
  onLine: (line: Line) => void; onEnd: (end: End, onto: Glued) => void; onEdit: () => void;
}) {
  const { screenToFlowPosition, getZoom } = useReactFlow();
  const point = (ev: ReactPointerEvent) => screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
  const grab = (what: End | 'via') => ({
    onPointerDown: (ev: ReactPointerEvent) => { ev.stopPropagation(); ev.currentTarget.setPointerCapture(ev.pointerId); setDrag({ what, p: point(ev) }); },
    onPointerMove: (ev: ReactPointerEvent) => { if (drag) setDrag({ what, p: point(ev), moved: true }); },
    // A double-click on a handle labels the connector, as one on its line does.
    onDoubleClick: (ev: ReactMouseEvent) => { ev.stopPropagation(); onEdit(); },
    onPointerUp: (ev: ReactPointerEvent) => {
      setDrag(undefined);
      if (!drag?.moved) return; // a click, not a drag
      const p = point(ev);
      if (what === 'via') { onLine({ ...line, via: p }); return; }
      const onto = glueAt(spots(), p, getZoom());
      if (onto) onEnd(what, onto);
    },
  });
  const handle = 'nodrag nopan pointer-events-auto absolute cursor-grab touch-none rounded-full border-2 border-blue-600 bg-white';
  const place = (p: Pos) => ({ transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`, zIndex: 1003 });
  const shape = line.shape ?? 'curved';
  return (
    <EdgeLabelRenderer>
      {!drag && (
        <div data-line-shapes style={{ transform: `translate(-50%, -100%) translate(${mid.x}px, ${Math.min(a.y, b.y, mid.y - (labelled ? 24 : 0)) - 16}px)`, zIndex: 1003 }} className="nodrag nopan pointer-events-auto absolute flex gap-0.5 rounded-xl bg-white p-1 shadow-md ring-1 ring-neutral-200">
          {SHAPES.map((x) => (
            <Tip key={x.shape} label={x.name}>
              <button
                data-line-shape={x.shape}
                aria-pressed={shape === x.shape}
                // Another shape, or the same one again, starts unbent.
                onClick={() => onLine({ ...line, shape: x.shape === 'curved' ? undefined : x.shape, via: undefined })}
                className={cx('rounded-lg px-1 py-0.5', shape === x.shape ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100')}
              >
                <svg viewBox="0 0 24 16" className="h-4 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={x.path} /></svg>
              </button>
            </Tip>
          ))}
        </div>
      )}
      {glued && DOTS.map((f, i) => (
        <div key={i} style={place(pointAt(glued.box, f))} className={cx('pointer-events-none absolute size-3 rounded-full border-2', glued.glue === f ? 'border-blue-600 bg-blue-600' : 'border-blue-400 bg-white')} />
      ))}
      {ends.map((end) => (
        <div key={end} data-line-end={end} title="Drag onto a dot or the border, or onto another one" style={place(end === 'from' ? a : b)} className={cx(handle, 'size-3.5')} {...grab(end)} />
      ))}
      {drag?.what !== 'from' && drag?.what !== 'to' && (
        <div data-line-bend title="Drag to bend it" style={place(mid)} className={cx(handle, 'size-3 border-blue-500')} {...grab('via')} />
      )}
    </EdgeLabelRenderer>
  );
}

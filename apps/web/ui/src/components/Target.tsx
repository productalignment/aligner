// What the user taps on a screen, as blue boxes in percent of its picture, as in Mobbin's flows: a
// step's target, and the click zones that open other screens on the Screens map.
import { ArrowRight, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { formatTarget, parseTarget, type Target } from '@aligner/core/context';
import { Picture, fitBox } from './Picture';

/** A click zone on a screen, and the name of the screen it opens. */
export interface Zone { box: string; opens: string }

const inside = (t: Target | null, p: { x: number; y: number }) => !!t && p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h;

/**
 * A screen's picture at `width` × `height` (its own shape) with the step's target on it. With
 * `onChange`, × clears the box, and while `drawing`, dragging on the picture draws it. `zones` shows
 * the screen's click zones with where each leads; with `onPick`, a click on one picks its box.
 */
export function TargetPicture({ path, target, width, height, drawing, onChange, zones = [], onPick }: {
  path: string; target?: string; width: number; height: number; drawing?: boolean; onChange?: (target: string | null) => void;
  zones?: Zone[]; onPick?: (box: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Target | null>(null);
  const saved = parseTarget(target);
  const shown = draft ?? saved;

  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const clamp = (v: number) => Math.min(100, Math.max(0, v));
    return { x: clamp(((e.clientX - r.left) / r.width) * 100), y: clamp(((e.clientY - r.top) / r.height) * 100) };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!onChange || !drawing) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = at(e);
    setDraft({ ...start.current, w: 0, h: 0 });
  };
  const move = (e: PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const p = at(e);
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const up = () => {
    const s = start.current;
    if (draft && draft.w > 1 && draft.h > 1) onChange?.(formatTarget(draft));
    // A click with no drag on one of the screen's click zones picks it.
    else if (s && onPick) { const z = zones.find((x) => inside(parseTarget(x.box), s)); if (z) onPick(z.box); }
    start.current = null;
    setDraft(null);
  };

  return (
    <div
      ref={ref}
      data-target-picture
      className={drawing ? 'relative cursor-crosshair touch-none select-none' : 'relative'}
      style={{ width, height }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
    >
      <Picture path={path} alt="" className="size-full object-contain" />
      {zones.map((z) => {
        const b = parseTarget(z.box);
        return b && (
          <div
            key={`${z.box}>${z.opens}`}
            data-zone={z.opens}
            className="pointer-events-none absolute rounded-md border-2 border-dashed border-blue-500 bg-blue-500/10"
            style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
          >
            <span className="absolute -top-2.5 right-1.5 inline-flex max-w-[12rem] items-center gap-1 truncate rounded-full bg-blue-500 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm">
              <ArrowRight className="size-3 shrink-0" />{z.opens}
            </span>
          </div>
        );
      })}
      {shown && (
        <div
          data-target
          className="pointer-events-none absolute rounded-md border-2 border-blue-500 bg-blue-500/20"
          style={{ left: `${shown.x}%`, top: `${shown.y}%`, width: `${shown.w}%`, height: `${shown.h}%` }}
        >
          {onChange && !draft && saved && (
            <button
              title="Clear"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onChange(null)}
              className="pointer-events-auto absolute -right-2 -top-2 rounded-full bg-blue-500 p-0.5 text-white shadow-sm hover:bg-blue-600"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A screen opened as large as the window allows, over the page, to drag a box on it: what the
 * user taps in a step, or a new click zone on the map. Its click zones show, with where each
 * leads. Drawing, Escape or a click beside it closes it.
 */
export function LargeScreen({ path, ratio, hint, target, zones, onDraw, onPick, onClose }: {
  path: string; ratio: number; hint: string; target?: string; zones?: Zone[];
  onDraw: (box: string | null) => void; onPick?: (box: string) => void; onClose: () => void;
}) {
  const [room, setRoom] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const resize = () => setRoom({ width: window.innerWidth, height: window.innerHeight });
    // Escape closes this view only: it is caught before the canvas would let go of what is selected.
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('keydown', key, true); };
  }, [onClose]);
  return createPortal(
    <div data-tap-zone-view className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-neutral-900/60 p-6" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex items-center gap-3 rounded-full bg-white px-4 py-1.5 text-center text-[13px] text-neutral-700 shadow-sm">
        {hint}
        <button onClick={onClose} title="Close" className="rounded p-0.5 text-neutral-400 hover:text-neutral-800"><X className="size-4" /></button>
      </div>
      <div className="overflow-hidden rounded-xl bg-white shadow-2xl">
        <TargetPicture path={path} target={target} {...fitBox(ratio, room.width - 48, room.height - 120)} drawing onChange={onDraw} zones={zones} onPick={onPick} />
      </div>
    </div>,
    document.body,
  );
}

// The mockup editor, a small Miro: a frame (a blank phone or laptop, or the screenshot) on
// an endless canvas, with rectangles, circles, lines, text, sticky notes, icons and pasted pictures drawn on and
// around it, in the product's own colours, fonts and icons. Saved as the shapes and as the
// flattened picture the coding agent reads.
import {
  Bold, BringToFront, Check, Circle, Frame as FrameIcon, Image as ImageIcon, ImagePlus, Italic, Laptop, Maximize, Minus, MousePointer2, SendToBack,
  Smartphone, Smile, Square, SquareRoundCorner, StickyNote, Type, Underline, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import type { ProductTheme } from '@aligner/core/api';
import type { Screen } from '@aligner/core/context';
import { markBusy, markDone, useApp } from '../state';
import { DeleteButton, Popover } from '../components/edit';
import { cx, Tip } from '../components/ui';
import { IconGlyph, searchIcons } from '../components/icons';
import {
  DEFAULT_PALETTE, FRAMES, FRAME_RADIUS, GENERIC_FONTS, NOTE, bounds, boxFrom, dash, flatten, fontCss, handlePoint, handlesOf, keepsRatio,
  lineHeight, moveBy, reshape, screenshotFrame, screenshotHeight, snap45, textLayout, touches, union,
  type Box, type Frame, type Handle, type Markup, type Paint, type Shape, type Stroke, type TextShape,
} from '../components/markup';

/** The screenshot the screenshot frame shows, with its natural size. */
export interface Screenshot { url: string; width: number; height: number }

type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'text' | 'note' | 'icon';
type Point = { x: number; y: number };
type View = { x: number; y: number; zoom: number };
type Swatch = { name: string; value: string };

const BLUE = '#2563eb';
const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: 'select', label: 'Select', icon: <MousePointer2 className="size-4" /> },
  { id: 'rect', label: 'Rectangle', icon: <Square className="size-4" /> },
  { id: 'ellipse', label: 'Circle', icon: <Circle className="size-4" /> },
  { id: 'line', label: 'Line', icon: <Minus className="size-4 -rotate-45" /> },
  { id: 'text', label: 'Text', icon: <Type className="size-4" /> },
  { id: 'note', label: 'Sticky note', icon: <StickyNote className="size-4" /> },
];
const FRAME_KINDS: { kind: Frame['kind']; label: string; icon: ReactNode }[] = [
  { kind: 'phone', label: 'Phone', icon: <Smartphone className="size-4" /> },
  { kind: 'laptop', label: 'Laptop', icon: <Laptop className="size-4" /> },
  { kind: 'screenshot', label: 'Screenshot', icon: <ImageIcon className="size-4" /> },
];
const FONT_NAME: Record<string, string> = { 'system-ui': 'System', serif: 'Serif', monospace: 'Mono' };
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];

// ---- The product's look ------------------------------------------------------------------

const themes = new Map<string, Promise<ProductTheme>>();

function useTheme(): ProductTheme | null {
  const { host, at } = useApp();
  const [theme, setTheme] = useState<ProductTheme | null>(null);
  useEffect(() => {
    let live = true;
    const key = `${at.repo}@${at.branch}`;
    if (!themes.has(key)) themes.set(key, host.api.theme(at).catch(() => ({ colours: [], fonts: [], fontLinks: [], icons: [] })));
    markBusy();
    void themes.get(key)!.then((t) => {
      if (!live) return;
      // Its fonts, loaded the way its own pages load them.
      for (const href of t.fontLinks) {
        if (document.querySelector(`link[data-font="${CSS.escape(href)}"]`)) continue;
        const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
        link.dataset.font = href;
        document.head.append(link);
      }
      setTheme(t);
    }).finally(markDone);
    return () => { live = false; };
  }, [host, at]);
  return theme;
}

function luminance(c: string): number {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(c);
  if (!m) return 1;
  const hex = m[1]!.length === 3 ? m[1]!.replace(/./g, '$&$&') : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function looks(theme: ProductTheme | null) {
  const palette: Swatch[] = theme?.colours.length ? theme.colours : DEFAULT_PALETTE.map((value) => ({ name: value, value }));
  const ink = [...palette].sort((a, b) => luminance(a.value) - luminance(b.value))[0]?.value ?? '#171717';
  const fonts = [...(theme?.fonts ?? []), ...GENERIC_FONTS];
  return { palette, ink, fonts, font: fonts[0]! };
}

function newShape(tool: Exclude<Tool, 'select'>, a: Point, b: Point, ink: string, font: string, icon = ''): Shape {
  const stroke: Stroke = { color: ink, opacity: 1, width: 2, style: 'solid' };
  const fill: Paint = { color: '#ffffff', opacity: 1 };
  const box = boxFrom(a, b);
  switch (tool) {
    case 'rect': return { kind: 'rect', ...box, fill, stroke, radius: 8 };
    case 'ellipse': return { kind: 'ellipse', ...box, fill, stroke };
    case 'line': return { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke };
    case 'text': return { kind: 'text', x: a.x, y: a.y - lineHeight({ size: 16 }) / 2, text: '', font, size: 16, color: ink };
    case 'note': return { kind: 'text', x: a.x - NOTE.width / 2, y: a.y - NOTE.width / 2, w: NOTE.width, text: '', font, size: 16, color: ink, note: true };
    case 'icon': return { kind: 'icon', x: a.x - 12, y: a.y - 12, w: 24, h: 24, name: icon, color: ink };
  }
}

const round = (s: Shape): Shape => (s.kind === 'line'
  ? { ...s, x1: Math.round(s.x1), y1: Math.round(s.y1), x2: Math.round(s.x2), y2: Math.round(s.y2) }
  : { ...s, x: Math.round(s.x), y: Math.round(s.y) });

/** A pasted or dropped picture as a data URL, made smaller when it's very large. */
async function readPicture(file: File): Promise<{ src: string; width: number; height: number }> {
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the picture'));
    r.readAsDataURL(file);
  });
  return fitPicture(src);
}

/** A picture's data URL with its size, made smaller when it's very large. */
async function fitPicture(src: string): Promise<{ src: string; width: number; height: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
  const width = img.naturalWidth || 300; // an SVG may have no size of its own
  const height = img.naturalHeight || 200;
  const k = Math.min(1, 1600 / Math.max(width, height));
  if (k === 1 && src.length < 1_500_000) return { src, width, height };
  const c = document.createElement('canvas');
  c.width = Math.round(width * k);
  c.height = Math.round(height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return { src: c.toDataURL('image/webp', 0.9), width: c.width, height: c.height };
}

/** A new mockup: on the screenshot when the screen has one, else on a blank phone. */
const blank = (screenshot: Screenshot | null): Markup =>
  ({ frame: screenshot ? screenshotFrame(screenshot.width, screenshot.height) : { kind: 'phone', ...FRAMES.phone }, shapes: [] });

/** A sketch the coding agent saved as the mockup, as a picture filling the frame, to draw over:
 *  the screenshot's frame, or else a phone or laptop of the sketch's shape. */
function sketched(pic: { src: string; width: number; height: number }, screenshot: Screenshot | null): Markup {
  const base = screenshot ? screenshotFrame(screenshot.width, screenshot.height) : { kind: pic.height >= pic.width ? 'phone' as const : 'laptop' as const, ...FRAMES[pic.height >= pic.width ? 'phone' : 'laptop'] };
  const h = Math.round((base.width * pic.height) / pic.width);
  return { frame: { ...base, height: Math.max(base.height, h) }, shapes: [{ kind: 'image', x: 0, y: 0, w: base.width, h, src: pic.src }] };
}

// ---- The editor ----------------------------------------------------------------------------

type Drag =
  | { kind: 'pan'; start: Point; view: View }
  | { kind: 'draw'; tool: 'rect' | 'ellipse' | 'line'; start: Point }
  | { kind: 'move'; start: Point; before: Markup; index: number; moved: boolean }
  | { kind: 'reshape'; handle: Handle; index: number; before: Markup }
  | { kind: 'frame'; start: Point; before: Markup }
  | { kind: 'marquee'; start: Point; base: number[] };

export function MockupEditor({ screen, screenshot }: { screen: Screen; screenshot: Screenshot | null }) {
  const { host, at, onSnapshot, fail } = useApp();
  const theme = useTheme();
  const look = looks(theme);
  const [markup, setMarkup] = useState<Markup | null>(null);
  const [history, setHistory] = useState<Markup[]>([]);
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [tool, setTool] = useState<Tool>('select');
  const [icon, setIcon] = useState('');
  const [selection, setSelection] = useState<number[]>([]);
  const [editing, setEditing] = useState<{ index: number; before: Markup } | null>(null);
  const [original, setOriginal] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [menu, setMenu] = useState<Point | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const drag = useRef<Drag | null>(null);
  /** A drag is under way: the shape's menu hides and saving waits. */
  const [held, setHeld] = useState(false);
  const space = useRef(false);
  const lastChange = useRef<{ key: string; at: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  // The mockup as saved; a new one is a phone, or the screenshot when the screen has one. A mockup
  // with no shapes is the agent's sketch: it opens as a picture on the frame.
  useEffect(() => {
    let live = true;
    markBusy();
    void host.api.markup(at, screen.id)
      .then(async (m) => m ?? (screen.mockup ? sketched(await fitPicture(await host.api.picture(at, screen.mockup)), screenshot) : blank(screenshot)))
      .then((m) => { if (live) setMarkup(m); })
      .catch((e) => { fail(e); if (live) setMarkup({ frame: { kind: 'phone', ...FRAMES.phone }, shapes: [] }); })
      .finally(markDone);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.id]);

  // A screenshot added before anything is drawn becomes the frame; a blank frame the PM picked stays.
  const hadScreenshot = useRef(!!screenshot);
  useEffect(() => {
    const had = hadScreenshot.current;
    hadScreenshot.current = !!screenshot;
    if (screenshot && !had && markup && !markup.shapes.length) { setMarkup({ ...markup, frame: screenshotFrame(screenshot.width, screenshot.height) }); setView(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshot]);

  // A replaced screenshot resizes the screenshot frame; with no screenshot left, it becomes a phone.
  useEffect(() => {
    if (!markup || markup.frame.kind !== 'screenshot') return;
    const base = screenshot ? screenshotFrame(screenshot.width, screenshot.height) : { kind: 'phone' as const, ...FRAMES.phone };
    // A frame pulled longer than its screenshot stays as long.
    const frame = base.kind === 'screenshot' && base.width === markup.frame.width ? { ...base, height: Math.max(base.height, markup.frame.height) } : base;
    if (frame.kind !== markup.frame.kind || frame.width !== markup.frame.width || frame.height !== markup.frame.height) {
      setMarkup({ ...markup, frame });
      if (markup.shapes.length) setStatus('dirty');
    }
  }, [screenshot, markup]);

  // Text is measured again once its fonts arrive.
  useEffect(() => {
    document.fonts.addEventListener('loadingdone', rerender);
    return () => document.fonts.removeEventListener('loadingdone', rerender);
  }, []);
  useEffect(() => {
    const fonts = [...new Set((markup?.shapes ?? []).flatMap((s) => (s.kind === 'text' ? [fontCss(s)] : [])))];
    void Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => undefined))).then(rerender);
  }, [markup?.shapes, theme]);

  /** A change; `before` is what undo goes back to. Changes of the same `key` in a row (a slider) undo as one. */
  const commit = useCallback((next: Markup, before?: Markup, key?: string) => {
    const now = Date.now();
    const same = key && lastChange.current?.key === key && now - lastChange.current.at < 1500;
    lastChange.current = key ? { key, at: now } : null;
    setMarkup((prev) => {
      if (!same && (before ?? prev)) setHistory((h) => [...h.slice(-49), (before ?? prev)!]);
      return next;
    });
    setStatus('dirty');
  }, []);

  // Saves a moment after the last change: the shapes and the picture of them.
  useEffect(() => {
    if (status !== 'dirty' || !markup || editing || held) return;
    const t = setTimeout(async () => {
      setStatus('saving');
      try {
        const png = markup.shapes.length ? await flatten(markup, screenshot) : '';
        onSnapshot((await host.api.saveMockup(at, screen.id, markup, png)).snapshot);
        setStatus((s) => (s === 'saving' ? 'saved' : s));
      } catch (e) {
        fail(e);
        setStatus('dirty');
      }
    }, 600);
    return () => clearTimeout(t);
  }, [status, markup, editing, held, screenshot, host, at, screen.id, onSnapshot, fail]);

  // ---- View: fit, zoom, pan ----

  // What the canvas shows: the mockup, or the screenshot alone (Original).
  const shown = useMemo<Markup | null>(
    () => markup && (original && screenshot ? { frame: screenshotFrame(screenshot.width, screenshot.height), shapes: [] } : markup),
    [markup, original, screenshot],
  );

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !shown) return;
    const b = union([{ x: 0, y: 0, w: shown.frame.width, h: shown.frame.height }, ...shown.shapes.map(bounds)])!;
    const zoom = Math.min(2, (el.clientWidth - 96) / b.w, (el.clientHeight - 96) / b.h);
    setView({ zoom, x: (el.clientWidth - b.w * zoom) / 2 - b.x * zoom, y: (el.clientHeight - b.h * zoom) / 2 - b.y * zoom });
  }, [shown]);
  useLayoutEffect(() => { if (shown && !view) fit(); }, [shown, view, fit]);

  const zoomAt = (factor: number, at?: Point) => setView((v) => {
    if (!v) return v;
    const el = box.current!;
    const p = at ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    const zoom = Math.min(8, Math.max(0.1, v.zoom * factor));
    return { zoom, x: p.x - ((p.x - v.x) * zoom) / v.zoom, y: p.y - ((p.y - v.y) * zoom) / v.zoom };
  });

  // The wheel pans; with Ctrl or Cmd (and a trackpad pinch), it zooms.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
      else setView((v) => (v ? { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY } : v));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const world = (e: { clientX: number; clientY: number }): Point => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view!.x) / view!.zoom, y: (e.clientY - r.top - view!.y) / view!.zoom };
  };
  const centre = (): Point => world({ clientX: box.current!.getBoundingClientRect().left + box.current!.clientWidth / 2, clientY: box.current!.getBoundingClientRect().top + box.current!.clientHeight / 2 });

  // ---- Changes ----

  const setShapes = (shapes: Shape[], before?: Markup, key?: string) => markup && commit({ ...markup, shapes }, before, key);
  const updateSelected = (fn: (s: Shape) => Shape, key: string) => markup && setShapes(markup.shapes.map((s, i) => (selection.includes(i) ? fn(s) : s)), undefined, key);
  const add = (shape: Shape) => {
    if (!markup) return;
    commit({ ...markup, shapes: [...markup.shapes, round(shape)] });
    setSelection([markup.shapes.length]);
  };
  const remove = () => {
    if (!markup || !selection.length) return;
    setShapes(markup.shapes.filter((_, i) => !selection.includes(i)));
    setSelection([]);
  };
  const order = (to: 'front' | 'back') => {
    if (!markup) return;
    const picked = markup.shapes.filter((_, i) => selection.includes(i));
    const rest = markup.shapes.filter((_, i) => !selection.includes(i));
    setShapes(to === 'front' ? [...rest, ...picked] : [...picked, ...rest]);
    setSelection(picked.map((_, k) => (to === 'front' ? rest.length + k : k)));
    setMenu(null);
  };
  const undo = () => {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setMarkup(prev);
    setSelection([]);
    lastChange.current = null;
    setStatus('dirty');
  };

  const addPicture = async (file: File, at?: Point) => {
    if (!markup || !view) return;
    const pic = await readPicture(file);
    const w = Math.min(pic.width, markup.frame.width * 0.8);
    const h = (w * pic.height) / pic.width;
    const c = at ?? centre();
    add({ kind: 'image', x: c.x - w / 2, y: c.y - h / 2, w, h, src: pic.src });
    setTool('select');
  };

  // ---- Keys and paste ----

  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.key === ' ') { space.current = e.type === 'keydown'; if (e.type === 'keydown') e.preventDefault(); return; }
      if (e.type !== 'keydown') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); }
      if (e.key === 'a' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (markup && !original) { setTool('select'); setSelection(markup.shapes.map((_, i) => i)); } }
      if (e.key === 'Escape') { setSelection([]); setTool('select'); setMenu(null); }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target) || original) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      void addPicture(file).catch(fail);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('paste', onPaste); };
  });

  // ---- Pointer ----

  const shapeAt = (t: EventTarget) => {
    const hit = (t as Element).closest?.('[data-shape-index]');
    return hit ? Number(hit.getAttribute('data-shape-index')) : -1;
  };

  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    setMenu(null);
    if (!markup || !view || e.button === 2) return;
    if (editing) return; // the click ends the typing (the text box's blur)
    const p = world(e);
    if (e.button === 1 || space.current || original) {
      drag.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, view };
    } else if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
      drag.current = { kind: 'draw', tool, start: p };
      setDraft(newShape(tool, p, p, look.ink, look.font));
    } else if (tool === 'text' || tool === 'note') {
      e.preventDefault(); // keeps the focus in the text box that opens
      const shape = newShape(tool, p, p, look.ink, look.font);
      setMarkup({ ...markup, shapes: [...markup.shapes, round(shape)] });
      setSelection([markup.shapes.length]);
      setEditing({ index: markup.shapes.length, before: markup });
      setTool('select');
      return;
    } else if (tool === 'icon') {
      add(newShape('icon', p, p, look.ink, look.font, icon));
      setTool('select');
      return;
    } else {
      const handle = (e.target as Element).getAttribute('data-handle') as Handle | null;
      const index = shapeAt(e.target);
      if ((e.target as Element).hasAttribute('data-frame-handle')) {
        drag.current = { kind: 'frame', start: p, before: markup };
      } else if (handle && selection.length === 1) {
        drag.current = { kind: 'reshape', handle, index: selection[0]!, before: markup };
      } else if (index >= 0) {
        if (e.shiftKey) { setSelection((s) => (s.includes(index) ? s.filter((i) => i !== index) : [...s, index])); return; }
        if (!selection.includes(index)) setSelection([index]);
        drag.current = { kind: 'move', start: p, before: markup, index, moved: false };
      } else {
        const base = e.shiftKey ? selection : [];
        setSelection(base);
        drag.current = { kind: 'marquee', start: p, base };
      }
    }
    svg.current!.setPointerCapture(e.pointerId);
    setHeld(true);
  };

  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !markup || !view) return;
    const p = world(e);
    if (d.kind === 'pan') {
      setView({ ...d.view, x: d.view.x + e.clientX - d.start.x, y: d.view.y + e.clientY - d.start.y });
    } else if (d.kind === 'draw') {
      if (d.tool === 'line') setDraft(newShape('line', d.start, e.shiftKey ? snap45(d.start, p) : p, look.ink, look.font));
      else {
        const b = boxFrom(d.start, p, e.shiftKey ? 1 : undefined);
        setDraft(newShape(d.tool, { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, look.ink, look.font));
      }
    } else if (d.kind === 'move') {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * view.zoom < 3) return;
      d.moved = true;
      const picked = selection.includes(d.index) ? selection : [d.index];
      setMarkup({ ...d.before, shapes: d.before.shapes.map((s, i) => (picked.includes(i) ? round(moveBy(s, dx, dy)) : s)) });
    } else if (d.kind === 'frame') {
      setMarkup({ ...d.before, frame: { ...d.before.frame, height: Math.max(200, Math.round(d.before.frame.height + p.y - d.start.y)) } });
    } else if (d.kind === 'reshape') {
      const s = d.before.shapes[d.index]!;
      setMarkup({ ...d.before, shapes: d.before.shapes.map((x, i) => (i === d.index ? reshape(s, d.handle, p, e.shiftKey || keepsRatio(s)) : x)) });
    } else {
      const m = boxFrom(d.start, p);
      setMarquee(m);
      const touched = markup.shapes.flatMap((s, i) => (touches(m, bounds(s)) ? [i] : []));
      setSelection([...new Set([...d.base, ...touched])]);
    }
  };

  const up = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    setHeld(false);
    if (!d || !markup || !view) return;
    if (d.kind === 'draw' && draft) {
      const b = bounds(draft);
      const clicked = Math.max(b.w, b.h) * view.zoom < 4;
      if (clicked && d.tool !== 'line') {
        const size = d.tool === 'rect' ? { w: 120, h: 80 } : { w: 96, h: 96 };
        add(newShape(d.tool, { x: d.start.x - size.w / 2, y: d.start.y - size.h / 2 }, { x: d.start.x + size.w / 2, y: d.start.y + size.h / 2 }, look.ink, look.font));
      } else if (!clicked) add(draft);
      setDraft(null);
      setTool('select');
    } else if (d.kind === 'move') {
      if (d.moved) commit(markup, d.before);
      else if (!e.shiftKey) setSelection([d.index]);
    } else if (d.kind === 'reshape' || d.kind === 'frame') {
      commit(markup, d.before);
    } else if (d.kind === 'marquee') {
      setMarquee(null);
    }
  };

  const finishText = (text: string) => {
    if (!editing || !markup) return;
    const { index, before } = editing;
    setEditing(null);
    const t = text.replace(/\s+$/, '');
    if (!t) {
      setMarkup(before);
      setSelection([]);
      if (before.shapes.length !== markup.shapes.length) return; // a new text left empty: as if never placed
      commit({ ...markup, shapes: markup.shapes.filter((_, i) => i !== index) }, before);
      return;
    }
    const next = { ...markup, shapes: markup.shapes.map((s, i) => (i === index ? { ...s, text: t } as Shape : s)) };
    if (JSON.stringify(next) !== JSON.stringify(before)) commit(next, before);
  };

  // ---- Drawing ----

  const picked = shown?.shapes.filter((_, i) => selection.includes(i)) ?? [];
  const pickedBox = union(picked.map(bounds));
  const single = picked.length === 1 ? picked[0]! : null;
  const z = view?.zoom ?? 1;
  const editingShape = editing && markup?.shapes[editing.index]?.kind === 'text' ? markup.shapes[editing.index] as TextShape : null;
  const cursor = original || space.current ? 'cursor-grab' : tool === 'select' ? 'cursor-default' : 'cursor-crosshair';

  return (
    <div
      ref={box}
      className="relative size-full overflow-hidden rounded-2xl bg-neutral-100 ring-1 ring-neutral-200"
      style={view ? { backgroundImage: 'radial-gradient(#d4d4d4 1px, transparent 1px)', backgroundSize: `${20 * z}px ${20 * z}px`, backgroundPosition: `${view.x}px ${view.y}px` } : undefined}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
        if (!file || original) return;
        e.preventDefault();
        void addPicture(file, world(e)).catch(fail);
      }}
    >
      {shown && view && (
        <svg
          ref={svg}
          data-markup
          className={cx('absolute inset-0 size-full touch-none select-none', cursor)}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onDoubleClick={(e) => {
            const i = shapeAt(e.target);
            if (i >= 0 && markup!.shapes[i]!.kind === 'text') { setSelection([i]); setEditing({ index: i, before: markup! }); }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const i = shapeAt(e.target);
            if (i < 0 || original) return;
            if (!selection.includes(i)) setSelection([i]);
            const r = box.current!.getBoundingClientRect();
            setMenu({ x: e.clientX - r.left, y: e.clientY - r.top });
          }}
        >
          <defs>
            <clipPath id={`frame-${screen.id}`}><rect width={shown.frame.width} height={shown.frame.height} rx={FRAME_RADIUS[shown.frame.kind]} /></clipPath>
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${z})`}>
            <rect data-frame={shown.frame.kind} width={shown.frame.width} height={shown.frame.height} rx={FRAME_RADIUS[shown.frame.kind]} fill="#ffffff" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.12))' }} />
            {shown.frame.kind === 'screenshot' && screenshot && (
              <image href={screenshot.url} width={shown.frame.width} height={screenshotHeight(shown.frame, screenshot)} preserveAspectRatio="none" clipPath={`url(#frame-${screen.id})`} />
            )}
            {!original && (
              <rect
                data-frame-handle x={shown.frame.width / 2 - 24 / z} y={shown.frame.height + 6 / z} width={48 / z} height={6 / z} rx={3 / z}
                fill="#a3a3a3" className="cursor-ns-resize hover:fill-neutral-600"
              ><title>Pull to make the screen longer</title></rect>
            )}
            {/* The text being typed shows in its text box; a sticky note keeps its square under it. */}
            {shown.shapes.map((s, i) => (editing?.index === i ? s.kind === 'text' && s.note && <ShapeSvg key={i} shape={{ ...s, text: '' }} zoom={z} /> : <ShapeSvg key={i} shape={s} index={i} zoom={z} />))}
            {draft && <ShapeSvg shape={draft} zoom={z} />}
            {pickedBox && !editing && <Selection shapes={picked} box={pickedBox} single={single} zoom={z} />}
            {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill={`${BLUE}14`} stroke={BLUE} strokeWidth={1 / z} pointerEvents="none" />}
          </g>
        </svg>
      )}

      {editingShape && view && <TextBox key={editing!.index} shape={editingShape} view={view} onChange={(text) => setMarkup((m) => m && { ...m, shapes: m.shapes.map((s, i) => (i === editing!.index ? { ...s, text } as Shape : s)) })} onDone={finishText} />}

      {single && pickedBox && view && !editing && !held && !original && (
        <ShapeMenu
          shape={single} at={{ x: pickedBox.x * z + view.x + (pickedBox.w * z) / 2, y: pickedBox.y * z + view.y }} palette={look.palette} fonts={look.fonts}
          onChange={(fn, key) => updateSelected(fn, key)}
        />
      )}

      {menu && (
        <div className="absolute z-30 w-44 rounded-xl border border-neutral-200 bg-white p-1 text-[13px] shadow-lg" style={{ left: menu.x, top: menu.y }}>
          <button data-order="front" onClick={() => order('front')} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-100"><BringToFront className="size-4 text-neutral-500" /> Bring to front</button>
          <button data-order="back" onClick={() => order('back')} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-100"><SendToBack className="size-4 text-neutral-500" /> Send to back</button>
        </div>
      )}

      {/* Tools */}
      <div className="absolute left-3 top-3 z-20 flex items-center gap-0.5 rounded-xl bg-white p-1 shadow-sm ring-1 ring-neutral-200">
        {TOOLS.map((t) => (
          <Tip key={t.id} label={t.label}>
            <ToolButton data-tool={t.id} active={tool === t.id} disabled={original} onClick={() => { setTool(t.id); if (t.id !== 'select') setSelection([]); }}>{t.icon}</ToolButton>
          </Tip>
        ))}
        <IconTool active={tool === 'icon'} disabled={original} first={theme?.icons ?? []} onPick={(name) => { setIcon(name); setTool('icon'); setSelection([]); }} />
        <Tip label="Picture">
          <label className={cx('rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100', original ? 'pointer-events-none opacity-30' : 'cursor-pointer')}>
            <ImagePlus className="size-4" />
            <input data-picture-input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addPicture(f).catch(fail); }} />
          </label>
        </Tip>
        <span className="mx-1 h-5 w-px bg-neutral-200" />
        {markup && <FrameTool frame={markup.frame} screenshot={screenshot} disabled={original} onPick={(frame) => { commit({ ...markup, frame }); setView(null); }} />}
        <span className="mx-1 h-5 w-px bg-neutral-200" />
        <Tip label="Undo"><ToolButton disabled={!history.length || original} onClick={undo}><Undo2 className="size-4" /></ToolButton></Tip>
      </div>

      <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
        <span data-save-status={status} className="text-[12px] text-neutral-400">{status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved' : markup?.shapes.length ? 'Mockup saved' : ''}</span>
        {!!markup?.shapes.length && <DeleteButton label="Clear the mockup" always onDelete={() => { setShapes([]); setSelection([]); }} />}
        {screenshot && (
          <div className="flex rounded-full bg-white p-0.5 text-[12px] shadow-sm ring-1 ring-neutral-200">
            {[false, true].map((o) => (
              <button
                key={String(o)} data-view-original={o}
                // A blank frame and the screenshot differ in size: the view fits the one shown.
                onClick={() => { if (o !== original && markup?.frame.kind !== 'screenshot') setView(null); setOriginal(o); setSelection([]); }}
                className={cx('rounded-full px-3 py-1', original === o ? 'bg-neutral-900 text-white' : 'text-neutral-500')}
              >{o ? 'Original' : 'Mockup'}</button>
            ))}
          </div>
        )}
      </div>

      <div className="absolute bottom-3 right-3 z-20 flex flex-col rounded-xl bg-white p-1 shadow-sm ring-1 ring-neutral-200">
        <Tip label="Zoom in" side="top"><ToolButton onClick={() => zoomAt(1.25)}><ZoomIn className="size-4" /></ToolButton></Tip>
        <Tip label="Zoom out" side="top"><ToolButton onClick={() => zoomAt(0.8)}><ZoomOut className="size-4" /></ToolButton></Tip>
        <Tip label="Fit" side="top"><ToolButton onClick={fit}><Maximize className="size-4" /></ToolButton></Tip>
      </div>
    </div>
  );
}

function ToolButton({ active, className, ...props }: { active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} aria-pressed={active} className={cx('rounded-lg p-1.5 disabled:opacity-30', active ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100', className)} />;
}

// ---- Shapes as SVG -------------------------------------------------------------------------

function strokeProps(s: Stroke) {
  return { stroke: s.color, strokeOpacity: s.opacity, strokeWidth: s.width, strokeDasharray: dash(s).join(' ') || undefined, strokeLinecap: 'round' as const };
}

function ShapeSvg({ shape: s, index, zoom }: { shape: Shape; index?: number; zoom: number }) {
  const tag = index === undefined ? { pointerEvents: 'none' as const } : { 'data-shape-index': index, 'data-shape': s.kind };
  switch (s.kind) {
    case 'rect':
      return <rect {...tag} x={s.x} y={s.y} width={s.w} height={s.h} rx={Math.min(s.radius, s.w / 2, s.h / 2)} fill={s.fill.color} fillOpacity={s.fill.opacity} {...strokeProps(s.stroke)} pointerEvents={index === undefined ? 'none' : 'all'} />;
    case 'ellipse':
      return <ellipse {...tag} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} fill={s.fill.color} fillOpacity={s.fill.opacity} {...strokeProps(s.stroke)} pointerEvents={index === undefined ? 'none' : 'all'} />;
    case 'line':
      return (
        <g {...tag}>
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth={Math.max(s.stroke.width, 12 / zoom)} />
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...strokeProps(s.stroke)} />
        </g>
      );
    case 'text': {
      const l = textLayout(s);
      return (
        <g {...tag}>
          <rect x={s.x} y={s.y} width={l.w} height={l.h} {...(s.note ? { fill: NOTE.colour, rx: 4, style: { filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.15))' } } : { fill: 'transparent' })} />
          <text fill={s.color} style={{ font: l.font }} textDecoration={s.underline ? 'underline' : undefined} dominantBaseline="central">
            {l.lines.map((line, i) => <tspan key={i} x={s.x + l.pad} y={s.y + l.pad + i * l.lineHeight + l.lineHeight / 2}>{line}</tspan>)}
          </text>
        </g>
      );
    }
    case 'icon':
      return (
        <g {...tag}>
          <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="transparent" />
          <IconGlyph name={s.name} colour={s.color} x={s.x} y={s.y} width={s.w} height={s.h} />
        </g>
      );
    case 'image':
      return <image {...tag} href={s.src} x={s.x} y={s.y} width={s.w} height={s.h} preserveAspectRatio="none" />;
  }
}

const HANDLE_CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', p1: 'crosshair', p2: 'crosshair' };

/** The selected shapes outlined in blue; one alone also has the handles that reshape it. */
function Selection({ shapes, box: tight, single, zoom }: { shapes: Shape[]; box: Box; single: Shape | null; zoom: number }) {
  const w = 1.5 / zoom;
  const size = 9 / zoom;
  // A text's handles sit just clear of its letters.
  const pad = single?.kind === 'text' && !single.note ? 5 / zoom : 0;
  const box = { x: tight.x - pad, y: tight.y - pad, w: tight.w + 2 * pad, h: tight.h + 2 * pad };
  if (single?.kind === 'line') {
    return (
      <g>
        {(['p1', 'p2'] as const).map((h) => {
          const p = h === 'p1' ? { x: single.x1, y: single.y1 } : { x: single.x2, y: single.y2 };
          return <circle key={h} data-handle={h} cx={p.x} cy={p.y} r={size / 1.6} fill="#fff" stroke={BLUE} strokeWidth={w} style={{ cursor: HANDLE_CURSOR[h] }} />;
        })}
      </g>
    );
  }
  return (
    <g>
      {!single && shapes.map((s, i) => { const b = bounds(s); return <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={BLUE} strokeWidth={w} pointerEvents="none" />; })}
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke={BLUE} strokeWidth={w} strokeDasharray={single ? undefined : `${4 / zoom} ${3 / zoom}`} pointerEvents="none" />
      {single && handlesOf(single).map((h) => {
        const p = handlePoint(box, h);
        return <rect key={h} data-handle={h} x={p.x - size / 2} y={p.y - size / 2} width={size} height={size} rx={2 / zoom} fill="#fff" stroke={BLUE} strokeWidth={w} style={{ cursor: HANDLE_CURSOR[h] }} />;
      })}
    </g>
  );
}

/** Typing a text in place. Enter (Shift+Enter is a new line), Escape or a click elsewhere finishes. */
function TextBox({ shape, view, onChange, onDone }: { shape: TextShape; view: View; onChange: (text: string) => void; onDone: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const l = textLayout({ ...shape, text: shape.text || ' ' });
  const z = view.zoom;
  return (
    <textarea
      ref={ref}
      data-markup-text
      value={shape.text}
      wrap={shape.w ? 'soft' : 'off'}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => { if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); } }}
      className="absolute z-10 resize-none overflow-hidden bg-transparent p-0 outline-none ring-2 ring-blue-500/60"
      style={{
        left: (shape.x + l.pad) * z + view.x, top: (shape.y + l.pad) * z + view.y,
        width: (shape.w ? shape.w - 2 * l.pad : l.w + shape.size) * z, height: (l.h - 2 * l.pad) * z,
        font: fontCss({ ...shape, size: shape.size * z }), lineHeight: `${l.lineHeight * z}px`, color: shape.color,
        textDecoration: shape.underline ? 'underline' : undefined,
      }}
    />
  );
}

// ---- The selected shape's menu ---------------------------------------------------------------

function ShapeMenu({ shape: s, at, palette, fonts, onChange }: {
  shape: Shape; at: Point; palette: Swatch[]; fonts: string[]; onChange: (fn: (s: Shape) => Shape, key: string) => void;
}) {
  if (s.kind === 'image') return null;
  const set = <K extends Shape['kind']>(fn: (x: Extract<Shape, { kind: K }>) => Shape, key: string) => onChange((x) => fn(x as Extract<Shape, { kind: K }>), key);
  return (
    <div data-shape-menu className="absolute z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-xl bg-white p-1 shadow-md ring-1 ring-neutral-200" style={{ left: at.x, top: Math.max(8, at.y - 52) }}>
      {(s.kind === 'rect' || s.kind === 'ellipse') && (
        <PaintButton label="Fill" kind="fill" paint={s.fill} palette={palette} onChange={(fill, key) => set<'rect'>((x) => ({ ...x, fill: { ...x.fill, ...fill } }), `fill-${key}`)} />
      )}
      {(s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'line') && (
        <PaintButton label={s.kind === 'line' ? 'Line' : 'Border'} kind="stroke" paint={s.stroke} palette={palette} onChange={(stroke, key) => set<'rect'>((x) => ({ ...x, stroke: { ...x.stroke, ...stroke } }), `stroke-${key}`)} />
      )}
      {s.kind === 'rect' && <RadiusButton shape={s} onChange={(radius) => set<'rect'>((x) => ({ ...x, radius }), 'radius')} />}
      {s.kind === 'text' && (
        <>
          <Tip label="Font">
            <select data-font value={s.font} onChange={(e) => set<'text'>((x) => ({ ...x, font: e.target.value }), 'font')} className="rounded-lg bg-transparent px-1.5 py-1 text-[13px] outline-none hover:bg-neutral-100" style={{ fontFamily: GENERIC_FONTS.includes(s.font) ? s.font : `"${s.font}"` }}>
              {fonts.map((f) => <option key={f} value={f}>{FONT_NAME[f] ?? f}</option>)}
            </select>
          </Tip>
          <Tip label="Size">
            <select data-size value={s.size} onChange={(e) => set<'text'>((x) => ({ ...x, size: Number(e.target.value) }), 'size')} className="rounded-lg bg-transparent px-1 py-1 text-[13px] tabular-nums outline-none hover:bg-neutral-100">
              {[...new Set([...SIZES, s.size])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Tip>
          <Tip label="Bold"><ToolButton data-bold active={!!s.bold} onClick={() => set<'text'>((x) => ({ ...x, bold: !x.bold }), 'bold')}><Bold className="size-4" /></ToolButton></Tip>
          <Tip label="Italic"><ToolButton data-italic active={!!s.italic} onClick={() => set<'text'>((x) => ({ ...x, italic: !x.italic }), 'italic')}><Italic className="size-4" /></ToolButton></Tip>
          <Tip label="Underline"><ToolButton data-underline active={!!s.underline} onClick={() => set<'text'>((x) => ({ ...x, underline: !x.underline }), 'underline')}><Underline className="size-4" /></ToolButton></Tip>
        </>
      )}
      {(s.kind === 'text' || s.kind === 'icon') && (
        <PaintButton label="Colour" kind="colour" paint={{ color: s.color, opacity: 1 }} palette={palette} onChange={(p, key) => set<'text'>((x) => ({ ...x, color: p.color ?? x.color }), `colour-${key}`)} />
      )}
    </div>
  );
}

/** A colour (and, for fills and borders, its opacity; for borders, thickness and style) in a popover. */
function PaintButton({ label, kind, paint, palette, onChange }: {
  label: string; kind: 'fill' | 'stroke' | 'colour'; paint: Paint | Stroke; palette: Swatch[]; onChange: (p: Partial<Stroke>, key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const stroke = kind === 'stroke' ? paint as Stroke : null;
  return (
    <span className="relative">
      <Tip label={label}>
        <button data-paint={kind} aria-expanded={open} onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()} onClick={() => setOpen((o) => !o)} className="rounded-lg p-1.5 hover:bg-neutral-100">
          <span
            className="block size-4 rounded-full ring-1 ring-neutral-300"
            style={kind === 'stroke' ? { boxShadow: `inset 0 0 0 3px ${paint.color}`, opacity: Math.max(0.25, paint.opacity) } : { background: paint.color, opacity: Math.max(0.25, paint.opacity) }}
          />
        </button>
      </Tip>
      {open && (
        <Popover onClose={() => setOpen(false)} width={232}>
          <div className="grid grid-cols-8 gap-1">
            {palette.map((c) => (
              <button key={c.value} data-swatch={c.value} title={c.name} onClick={() => onChange({ color: c.value }, 'colour')} className={cx('size-6 rounded-full ring-1 ring-neutral-200', paint.color === c.value && 'ring-2 ring-blue-500 ring-offset-1')} style={{ background: c.value }} />
            ))}
            <label title="Another colour" className="relative size-6 cursor-pointer overflow-hidden rounded-full ring-1 ring-neutral-200" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(paint.color) ? paint.color : '#000000'} onChange={(e) => onChange({ color: e.target.value }, 'colour')} className="absolute inset-0 opacity-0" />
            </label>
          </div>
          {kind !== 'colour' && <Slider title="Opacity" value={Math.round(paint.opacity * 100)} max={100} unit="%" onChange={(v) => onChange({ opacity: v / 100 }, 'opacity')} />}
          {stroke && (
            <>
              <Slider title="Thickness" value={stroke.width} max={16} step={0.5} onChange={(v) => onChange({ width: v }, 'width')} />
              <div className="mt-2 flex gap-1">
                {(['solid', 'dashed', 'dotted'] as const).map((st) => (
                  <button key={st} data-stroke-style={st} title={st[0]!.toUpperCase() + st.slice(1)} onClick={() => onChange({ style: st }, 'style')} className={cx('flex h-7 flex-1 items-center justify-center rounded-lg', stroke.style === st ? 'bg-neutral-900' : 'hover:bg-neutral-100')}>
                    <svg width="40" height="4"><line x1="2" y1="2" x2="38" y2="2" stroke={stroke.style === st ? '#fff' : '#525252'} strokeWidth="2" strokeLinecap="round" strokeDasharray={st === 'dashed' ? '6 4' : st === 'dotted' ? '0.01 4' : undefined} /></svg>
                  </button>
                ))}
              </div>
            </>
          )}
        </Popover>
      )}
    </span>
  );
}

function RadiusButton({ shape, onChange }: { shape: Extract<Shape, { kind: 'rect' }>; onChange: (r: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <Tip label="Corners"><ToolButton data-radius aria-expanded={open} onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()} onClick={() => setOpen((o) => !o)}><SquareRoundCorner className="size-4" /></ToolButton></Tip>
      {open && (
        <Popover onClose={() => setOpen(false)} width={200}>
          <Slider title="Corners" value={shape.radius} max={Math.round(Math.min(shape.w, shape.h) / 2)} onChange={onChange} />
        </Popover>
      )}
    </span>
  );
}

function Slider({ title, value, max, step = 1, unit = '', onChange }: { title: string; value: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label title={title} className="mt-2 flex items-center gap-2 text-[12px] tabular-nums text-neutral-500">
      <input data-slider={title.toLowerCase()} type="range" min={0} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-neutral-900" />
      <span className="w-9 text-right">{value}{unit}</span>
    </label>
  );
}

// ---- Toolbar pickers -------------------------------------------------------------------------

function IconTool({ active, disabled, first, onPick }: { active: boolean; disabled: boolean; first: string[]; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const found = open ? searchIcons(query, first).slice(0, 160) : [];
  return (
    <span className="relative">
      <Tip label="Icon"><ToolButton data-tool="icon" aria-expanded={open} active={active} disabled={disabled} onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()} onClick={() => setOpen((o) => !o)}><Smile className="size-4" /></ToolButton></Tip>
      {open && (
        <Popover onClose={() => setOpen(false)} width={296}>
          <input data-icon-search autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search icons" className="mb-2 w-full rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[13px] outline-none" />
          <div className="grid max-h-64 grid-cols-8 gap-0.5 overflow-auto">
            {found.map((name) => (
              <button key={name} data-icon={name} title={name.replace(/([a-z0-9])([A-Z])/g, '$1 $2')} onClick={() => { onPick(name); setOpen(false); }} className="flex size-8 items-center justify-center rounded-lg text-neutral-700 hover:bg-neutral-100">
                <svg width="18" height="18"><IconGlyph name={name} colour="currentColor" width={18} height={18} /></svg>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </span>
  );
}

/** The frame the mockup is drawn on: a blank phone or laptop, or the screenshot when the screen has one. */
function FrameTool({ frame, screenshot, disabled, onPick }: { frame: Frame; screenshot: Screenshot | null; disabled: boolean; onPick: (f: Frame) => void }) {
  const [open, setOpen] = useState(false);
  const pick = (kind: Frame['kind']) => {
    setOpen(false);
    if (kind !== frame.kind) onPick(kind === 'screenshot' ? screenshotFrame(screenshot!.width, screenshot!.height) : { kind, ...FRAMES[kind] });
  };
  return (
    <span className="relative">
      <Tip label="Frame"><ToolButton data-tool="frame" aria-expanded={open} disabled={disabled} onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()} onClick={() => setOpen((o) => !o)}><FrameIcon className="size-4" /></ToolButton></Tip>
      {open && (
        <Popover onClose={() => setOpen(false)} width={168}>
          {FRAME_KINDS.filter((f) => f.kind !== 'screenshot' || screenshot).map((f) => (
            <button key={f.kind} data-frame-option={f.kind} aria-pressed={frame.kind === f.kind} onClick={() => pick(f.kind)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-100">
              <span className="text-neutral-500">{f.icon}</span>
              <span className="flex-1">{f.label}</span>
              {frame.kind === f.kind && <Check className="size-4" />}
            </button>
          ))}
        </Popover>
      )}
    </span>
  );
}

// A screen's mockup: a frame and the shapes drawn on and around it. The editor draws them as
// SVG; `flatten` paints the same thing into the PNG the coding agent reads. Both use these measures.
import type { Markup, Paint, Shape, Stroke } from '@aligner/core/api';
import { iconSvg } from './icons';

export type { Markup, Paint, Shape, Stroke };
export type Frame = Markup['frame'];
export type Box = { x: number; y: number; w: number; h: number };

export const FRAMES = { phone: { width: 390, height: 844 }, laptop: { width: 1440, height: 900 } };
export const FRAME_RADIUS: Record<Frame['kind'], number> = { phone: 32, laptop: 8, screenshot: 0 };

/** A screenshot frame is as wide as a phone (portrait) or a laptop (landscape), whatever its resolution. */
export function screenshotFrame(naturalWidth: number, naturalHeight: number): Frame {
  const width = naturalHeight >= naturalWidth ? FRAMES.phone.width : FRAMES.laptop.width;
  return { kind: 'screenshot', width, height: Math.round((width * naturalHeight) / naturalWidth) };
}

/** Aligner's colours, for a product whose code defines none. */
export const DEFAULT_PALETTE = ['#171717', '#737373', '#d4d4d4', '#ffffff', '#e11d48', '#f59e0b', '#16a34a', '#2563eb', '#7c3aed'];
export const FALLBACK_FONT = 'system-ui';

export const dash = (s: Stroke): number[] => (s.style === 'dashed' ? [s.width * 3, s.width * 2] : s.style === 'dotted' ? [0.001, s.width * 2] : []);

// ---- Text ------------------------------------------------------------------------------

export type TextShape = Extract<Shape, { kind: 'text' }>;

/** Fonts every mockup can use besides the product's: the system's own, a serif and a monospace. */
export const GENERIC_FONTS = ['system-ui', 'serif', 'monospace'];
export const fontCss = (t: Pick<TextShape, 'font' | 'size' | 'bold' | 'italic'>) =>
  `${t.italic ? 'italic ' : ''}${t.bold ? 700 : 400} ${t.size}px ${GENERIC_FONTS.includes(t.font) ? t.font : `"${t.font}"`}, ${FALLBACK_FONT}, sans-serif`;
export const lineHeight = (t: Pick<TextShape, 'size'>) => Math.round(t.size * 1.3);

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(font: string, text: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Breaks text into lines that fit `maxWidth`, keeping the line breaks the PM typed. */
function wrap(text: string, font: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(?<=\s)/)) {
      const next = line + word;
      if (line.trim() && measure(font, next.trimEnd()) > maxWidth) { out.push(line.trimEnd()); line = word.trimStart(); } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** A sticky note: its colour, and the room between its edge and its text. */
export const NOTE = { colour: '#fef08a', pad: 14, width: 160 };

/**
 * A text's lines and size: wrapped at its width, or as wide as its longest line. A sticky note's text
 * sits `pad` in from its edges, on a square that grows taller with the text.
 */
export function textLayout(t: TextShape) {
  const font = fontCss(t);
  const pad = t.note ? NOTE.pad : 0;
  const lines = t.w ? wrap(t.text || ' ', font, t.w - 2 * pad) : (t.text || ' ').split('\n');
  const w = t.w ?? Math.max(t.size, ...lines.map((l) => measure(font, l)));
  const h = lines.length * lineHeight(t);
  return { lines, font, lineHeight: lineHeight(t), w, h: t.note ? Math.max(w, h + 2 * pad) : h, pad };
}

// ---- Geometry --------------------------------------------------------------------------

/** The box a shape covers. */
export function bounds(s: Shape): Box {
  switch (s.kind) {
    case 'line': return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
    case 'text': { const l = textLayout(s); return { x: s.x, y: s.y, w: l.w, h: l.h }; }
    default: return { x: s.x, y: s.y, w: s.w, h: s.h };
  }
}

export function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

export const touches = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

export function moveBy(s: Shape, dx: number, dy: number): Shape {
  if (s.kind === 'line') return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  return { ...s, x: s.x + dx, y: s.y + dy };
}

/** Icons and pictures keep their proportions; other shapes do while Shift is held. */
export const keepsRatio = (s: Shape) => s.kind === 'icon' || s.kind === 'image';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p1' | 'p2';

/** The handles a shape is reshaped by: a line's two ends, a text's sides (its width), a box's corners and sides. */
export function handlesOf(s: Shape): Handle[] {
  if (s.kind === 'line') return ['p1', 'p2'];
  if (s.kind === 'text') return ['w', 'e'];
  if (keepsRatio(s)) return ['nw', 'ne', 'se', 'sw'];
  return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
}

export function handlePoint(b: Box, h: Handle): { x: number; y: number } {
  const x = h.includes('w') ? b.x : h.includes('e') ? b.x + b.w : b.x + b.w / 2;
  const y = h.startsWith('n') ? b.y : h.startsWith('s') ? b.y + b.h : b.y + b.h / 2;
  return { x, y };
}

/** Snaps a line's end to the nearest 45° from its other end. */
export function snap45(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: from.x + Math.round(len * Math.cos(angle)), y: from.y + Math.round(len * Math.sin(angle)) };
}

/** A box from two corners; with `square`, as a square (or the shape's own proportions, `ratio`) from the first. */
export function boxFrom(a: { x: number; y: number }, b: { x: number; y: number }, ratio?: number): Box {
  let w = b.x - a.x;
  let h = b.y - a.y;
  if (ratio) {
    if (Math.abs(w) / ratio > Math.abs(h)) h = Math.sign(h || 1) * Math.abs(w) / ratio;
    else w = Math.sign(w || 1) * Math.abs(h) * ratio;
  }
  return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h) };
}

/** A shape reshaped by dragging one of its handles to `p`. */
export function reshape(s: Shape, handle: Handle, p: { x: number; y: number }, keepRatio: boolean): Shape {
  if (s.kind === 'line') {
    const [fx, fy] = handle === 'p1' ? [s.x2, s.y2] : [s.x1, s.y1];
    const q = keepRatio ? snap45({ x: fx, y: fy }, p) : p;
    return handle === 'p1' ? { ...s, x1: q.x, y1: q.y } : { ...s, x2: q.x, y2: q.y };
  }
  const b = bounds(s);
  if (s.kind === 'text') {
    const right = b.x + b.w;
    const min = s.size + (s.note ? 2 * NOTE.pad : 0);
    return handle === 'e' ? { ...s, w: Math.max(min, p.x - b.x) } : { ...s, x: Math.min(p.x, right - min), w: Math.max(min, right - p.x) };
  }
  // The corner (or side) opposite the handle stays put.
  const ax = handle.includes('w') ? b.x + b.w : b.x;
  const ay = handle.startsWith('n') ? b.y + b.h : b.y;
  let box: Box;
  if (handle === 'n' || handle === 's') {
    const h = Math.abs(p.y - ay);
    const w = keepRatio ? (h * b.w) / Math.max(1, b.h) : b.w;
    box = { x: b.x + (b.w - w) / 2, y: Math.min(ay, p.y), w, h };
  } else if (handle === 'e' || handle === 'w') {
    const w = Math.abs(p.x - ax);
    const h = keepRatio ? (w * b.h) / Math.max(1, b.w) : b.h;
    box = { x: Math.min(ax, p.x), y: b.y + (b.h - h) / 2, w, h };
  } else {
    box = boxFrom({ x: ax, y: ay }, p, keepRatio ? Math.max(1, b.w) / Math.max(1, b.h) : undefined);
  }
  return { ...s, x: Math.round(box.x), y: Math.round(box.y), w: Math.max(4, Math.round(box.w)), h: Math.max(4, Math.round(box.h)) };
}

// ---- The picture the agent reads ---------------------------------------------------------

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Could not draw a picture of the mockup'));
  img.src = src;
});

function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  if (s.width <= 0 || s.opacity <= 0) return;
  ctx.globalAlpha = s.opacity;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.setLineDash(dash(s));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

function paintFill(ctx: CanvasRenderingContext2D, f: Paint) {
  if (f.opacity <= 0) return;
  ctx.globalAlpha = f.opacity;
  ctx.fillStyle = f.color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** The screenshot keeps its proportions at the top of the frame; a frame pulled longer goes on in white below it. */
export const screenshotHeight = (frame: Frame, shot: { width: number; height: number }) => (frame.width * shot.height) / shot.width;

/**
 * Paints what is inside the frame, and returns the PNG as base64. Shapes beside the frame (notes
 * to self, parts not placed yet) are left out: the picture is the screen.
 */
export async function flatten(markup: Markup, screenshot: { url: string; width: number; height: number } | null): Promise<string> {
  const { frame } = markup;
  const scale = Math.min(2, 4096 / Math.max(frame.width, frame.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(frame.width * scale);
  canvas.height = Math.ceil(frame.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.roundRect(0, 0, frame.width, frame.height, FRAME_RADIUS[frame.kind]);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.clip();
  if (frame.kind === 'screenshot' && screenshot) ctx.drawImage(await loadImage(screenshot.url), 0, 0, frame.width, screenshotHeight(frame, screenshot));

  for (const s of markup.shapes) {
    ctx.beginPath();
    if (s.kind === 'rect') {
      ctx.roundRect(s.x, s.y, s.w, s.h, Math.min(s.radius, s.w / 2, s.h / 2));
      paintFill(ctx, s.fill);
      paintStroke(ctx, s.stroke);
    } else if (s.kind === 'ellipse') {
      ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
      paintFill(ctx, s.fill);
      paintStroke(ctx, s.stroke);
    } else if (s.kind === 'line') {
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      paintStroke(ctx, s.stroke);
    } else if (s.kind === 'text') {
      await document.fonts.load(fontCss(s)).catch(() => undefined);
      const l = textLayout(s);
      if (s.note) {
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.roundRect(s.x, s.y, l.w, l.h, 4);
        ctx.fillStyle = NOTE.colour;
        ctx.fill();
        ctx.shadowColor = 'transparent';
      }
      ctx.font = l.font;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = s.color;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1, s.size / 14);
      l.lines.forEach((line, i) => {
        const x = s.x + l.pad;
        const y = s.y + l.pad + i * l.lineHeight + l.lineHeight / 2;
        ctx.fillText(line, x, y);
        if (s.underline && line) {
          ctx.beginPath();
          ctx.moveTo(x, y + s.size * 0.55);
          ctx.lineTo(x + ctx.measureText(line).width, y + s.size * 0.55);
          ctx.stroke();
        }
      });
    } else if (s.kind === 'icon') {
      ctx.drawImage(await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(s.name, s.color))}`), s.x, s.y, s.w, s.h);
    } else {
      ctx.drawImage(await loadImage(s.src), s.x, s.y, s.w, s.h);
    }
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the mockup'))), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

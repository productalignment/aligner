// A step's target: the box around what the user taps on the step's screen, in percent of
// the screen's picture, so it stays in place when the screenshot is replaced at another size.
//   - target: 8, 64, 84, 9      x, y, width, height

export interface Target { x: number; y: number; w: number; h: number }

/** The box a `target` field holds, or null when it isn't four numbers inside the picture. */
export function parseTarget(value: string | undefined): Target | null {
  const parts = (value ?? '').split(',').map((p) => p.trim());
  if (parts.length !== 4 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const [x, y, w, h] = parts.map(Number) as [number, number, number, number];
  if (w <= 0 || h <= 0 || x + w > 100.05 || y + h > 100.05) return null;
  return { x, y, w, h };
}

/** The field's text: one decimal at most. */
export function formatTarget(t: Target): string {
  const n = (v: number) => String(Math.round(v * 10) / 10);
  return [t.x, t.y, t.w, t.h].map(n).join(', ');
}

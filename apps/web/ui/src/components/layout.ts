import ELK from 'elkjs/lib/elk.bundled.js';
import { useEffect, useState } from 'react';
import type { Layout } from '@aligner/core/api';
import { markBusy, markDone } from '../state';

const elk = new ELK();

export interface LayoutNode { id: string; width: number; height: number }
export interface LayoutEdge { id: string; source: string; target: string }
export type Positions = Map<string, { x: number; y: number }>;

/** Layered left-to-right layout, with ELK's `options` on top of these. */
export function useElkLayout(nodes: LayoutNode[], edges: LayoutEdge[], key: string, spacing = { node: 36, layer: 70 }, options: Record<string, string> = {}): Positions | null {
  const [result, setResult] = useState<{ key: string; pos: Positions } | null>(null);
  useEffect(() => {
    let cancelled = false;
    markBusy();
    elk
      .layout({
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.spacing.nodeNode': String(spacing.node),
          'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing.layer),
          'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
          ...options,
        },
        children: nodes.map((n) => ({ ...n })),
        edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      })
      .then((g) => {
        if (cancelled) return;
        setResult({ key, pos: new Map((g.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }])) });
      })
      .finally(markDone);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return result?.key === key ? result.pos : null;
}

/**
 * Positions from a saved layout. An item it doesn't have yet (one the coding agent added) goes `gap`
 * to the right of an item that leads to it (`from`), or `below` everything.
 */
export function placeAll(ids: string[], saved: Layout, from: (id: string) => string[], width: (id: string) => number, gap: number, below: number): Positions {
  const out: Positions = new Map(ids.flatMap((id) => (saved[id] ? [[id, saved[id]!] as const] : [])));
  for (let pass = 0; pass < ids.length && out.size < ids.length; pass++) {
    for (const id of ids) {
      if (out.has(id)) continue;
      const before = from(id).find((f) => out.has(f));
      if (before) {
        const p = out.get(before)!;
        out.set(id, { x: p.x + width(before) + gap, y: p.y });
      } else if (pass === ids.length - 1 || !from(id).some((f) => ids.includes(f))) {
        const all = [...out.values()];
        out.set(id, { x: all.length ? Math.min(...all.map((p) => p.x)) : 0, y: all.length ? Math.max(...all.map((p) => p.y)) + below : 0 });
      }
    }
  }
  return out;
}

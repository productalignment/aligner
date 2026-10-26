// Deterministic checks (product/INSTRUCTIONS.md, "Checks"). No model calls.
import { linkId } from './spec.ts';
import { parseTarget } from './target.ts';
import type { Finding, ItemType, Model } from './types.ts';
import type { Workspace } from './workspace.ts';

const W = (code: string, message: string, items: string[]): Finding => ({ code, severity: 'warning', message, items });
const E = (code: string, message: string, items: string[]): Finding => ({ code, severity: 'error', message, items });

/** Every item's type by ID. */
export function typesById(m: Model): Map<string, ItemType> {
  const out = new Map<string, ItemType>();
  for (const o of m.out_of_scope) out.set(o.id, 'out_of_scope');
  for (const c of m.constraints) out.set(c.id, 'constraint');
  for (const p of m.personas) {
    out.set(p.id, 'persona');
    for (const j of p.jobs) out.set(j.id, 'job');
  }
  for (const f of m.flows) {
    out.set(f.id, 'flow');
    for (const s of f.steps) out.set(s.id, 'step');
  }
  for (const s of m.screens) out.set(s.id, 'screen');
  return out;
}

export function runChecks(m: Model): Finding[] {
  const out: Finding[] = [];
  const types = typesById(m);

  // E-LINK: links must resolve to the right type.
  const link = (from: string, field: string, ids: string[], allowed: ItemType) => {
    for (const id of ids) {
      const t = types.get(id);
      if (!t) out.push(E('E-LINK', `${from} ${field} points to missing ${id}`, [from, id]));
      else if (t !== allowed) out.push(E('E-LINK', `${from} ${field} must point to a ${allowed}, not ${t} ${id}`, [from, id]));
    }
  };
  for (const f of m.flows) {
    link(f.id, 'jobs', f.jobs, 'job');
    for (const s of f.steps) link(s.id, 'screen', s.screen ? [s.screen] : [], 'screen');
  }

  // E-EDGE: connections join steps of their own flow, once.
  for (const f of m.flows) {
    const own = new Set(f.steps.map((s) => s.id));
    const seen = new Set<string>();
    for (const c of f.connections) {
      const cid = `${c.from}>${c.to}`;
      if (!own.has(c.from) || !own.has(c.to)) out.push(E('E-EDGE', `${cid} must connect steps of ${f.id}`, [cid]));
      if (seen.has(cid)) out.push(E('E-EDGE', `${cid} is duplicated`, [cid]));
      seen.add(cid);
    }
  }

  // E-TARGET: a target is a box inside the picture, on a step that has a screen.
  for (const f of m.flows) {
    for (const s of f.steps) {
      if (s.target === undefined) continue;
      if (!parseTarget(s.target)) out.push(E('E-TARGET', `${s.id} target must be "x, y, width, height" in percent of the picture`, [s.id]));
      else if (!s.screen) out.push(E('E-TARGET', `${s.id} has a target but no screen`, [s.id]));
    }
  }

  // E-ZONE: a screen's links lead from a box inside its picture to a screen.
  for (const s of m.screens) {
    for (const l of s.links) {
      const id = linkId(s.id, l.box, l.to);
      const t = types.get(l.to);
      if (!t) out.push(E('E-LINK', `${s.id} links to missing ${l.to}`, [id]));
      else if (t !== 'screen') out.push(E('E-LINK', `${s.id} links to ${t} ${l.to}, which is not a screen`, [id]));
      if (!parseTarget(l.box)) out.push(E('E-ZONE', `${s.id} click zone ${l.box} must be "x, y, width, height" in percent of the picture`, [id]));
    }
    if (s.links.length && !s.picture && !s.mockup) out.push(E('E-ZONE', `${s.id} has click zones but no screenshot or mockup`, [s.id]));
  }

  // Warnings: the gaps the Product view shows as layout.
  const served = new Set(m.flows.flatMap((f) => f.jobs));
  for (const p of m.personas) for (const j of p.jobs) if (!served.has(j.id)) out.push(W('W-JOB-NO-FLOW', `${j.id} has no flow`, [j.id]));
  for (const f of m.flows) if (!f.jobs.length) out.push(W('W-FLOW-NO-JOB', `${f.id} serves no job`, [f.id]));
  for (const f of m.flows) {
    for (const s of f.steps) {
      const outs = f.connections.filter((c) => c.from === s.id).length;
      if ((s.step_type === 'user-decision' || s.step_type === 'system-decision') && outs < 2) out.push(W('W-DECISION-BRANCH', `${s.id} is a decision with fewer than 2 outcomes`, [s.id]));
    }
  }
  return out;
}

/** Every finding for a product context, each at the line of the item it is about. The checks run only once the files parse. */
export function validate(ws: Workspace): Finding[] {
  const findings = [...ws.parseErrors, ...(ws.parseErrors.length ? [] : runChecks(ws.model))];
  return findings.map((f) => {
    const at = f.file || !f.items[0] ? undefined : ws.locate(f.items[0]);
    return at ? { ...f, file: at.doc.path, line: at.doc.segs[at.node.seg]!.line } : f;
  });
}

export function report(dir: string, m: Model, findings: Finding[]): { text: string; errors: number } {
  const count = (n: number, w: string) => `${n} ${n === 1 ? w : w + 's'}`;
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const jobs = m.personas.reduce((n, p) => n + p.jobs.length, 0);
  const lines = [
    `Product context ${dir}`,
    `  ${count(m.personas.length, 'persona')}, ${count(jobs, 'job')}, ${count(m.flows.length, 'flow')} (${count(m.flows.reduce((n, f) => n + f.steps.length, 0), 'step')}), ${count(m.screens.length, 'screen')}`,
    ...[...errors, ...warnings].map((f) => `  ${f.severity === 'error' ? '✖' : '⚠'} ${f.code} ${f.message}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}`),
    `  ${count(errors.length, 'error')}, ${count(warnings.length, 'warning')}`,
  ];
  return { text: lines.join('\n'), errors: errors.length };
}

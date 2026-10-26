// Canonical serialization (product/INSTRUCTIONS.md).
import { FILE_PATHS, FILES, TYPES, VISION_FIELDS, flowPath } from './spec.ts';
import type { ItemType, Model } from './types.ts';

type Fields = Record<string, unknown>;

/** The item's own lines (heading or list entry plus its field lines), each ending in "\n". */
export function renderOwn(type: ItemType, id: string, fields: Fields): string {
  if (type === 'connection') {
    return `- ${fields.from} -> ${fields.to}${fields.label ? `: ${fields.label}` : ''}\n`;
  }
  if (type === 'link') {
    return `- ${fields.box} -> ${fields.to}${fields.label ? `: ${fields.label}` : ''}\n`;
  }
  const td = TYPES[type as keyof typeof TYPES];
  let out = '';
  const fieldLines = (indent: string) => {
    for (const f of td.fields) {
      const v = fields[f.prop];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
      out += `${indent}- ${f.key}: ${Array.isArray(v) ? v.join(', ') : String(v)}\n`;
    }
  };
  if (td.form === 'block') {
    const name = fields.name;
    out += `${'#'.repeat(td.level!)} ${id}${name ? ` ${name}` : ''}\n`;
    fieldLines('');
  } else if (td.form === 'step') {
    out += `- ${id}: [${fields.step_type}]${fields.label ? ` ${fields.label}` : ''}\n`;
    fieldLines('  ');
  } else {
    out += `- ${id}: ${fields.text}\n`;
    fieldLines('  ');
  }
  return out;
}

export function renderVision(vision: Model['vision']): string {
  return VISION_FIELDS.filter((v) => vision[v.prop]).map((v) => `- ${v.key}: ${vision[v.prop]}\n`).join('');
}

export const PRODUCT_COMMENT = '<!-- Product context. Read product/INSTRUCTIONS.md before changing anything. -->\n';

/** Full canonical text of one file. */
export function renderFile(fileKey: string, model: Model, flowId?: string): string {
  const def = FILES[fileKey]!;
  let out = fileKey === 'product' ? PRODUCT_COMMENT + '\n' : '';
  if (typeof def.title === 'string') out += `# ${def.title}\n`;
  const leaves = (type: ItemType, list: { id: string }[]) => list.map((x) => renderOwn(type, x.id, x as Fields)).join('');

  switch (fileKey) {
    case 'product':
      out += `\n## Vision\n${renderVision(model.vision)}`;
      out += `\n## Out of scope\n${leaves('out_of_scope', model.out_of_scope)}`;
      out += `\n## Constraints\n${leaves('constraint', model.constraints)}`;
      break;
    case 'personas':
      for (const p of model.personas) {
        out += '\n' + renderOwn('persona', p.id, p as unknown as Fields);
        out += `\n### Jobs\n${leaves('job', p.jobs)}`;
      }
      break;
    case 'flow': {
      const flow = model.flows.find((f) => f.id === flowId)!;
      out += renderOwn('flow', flow.id, flow as unknown as Fields);
      out += `\n## Steps\n${leaves('step', flow.steps)}`;
      out += `\n## Connections\n${flow.connections.map((c) => renderOwn('connection', '', c as unknown as Fields)).join('')}`;
      break;
    }
    case 'screens':
      for (const s of model.screens) {
        out += '\n' + renderOwn('screen', s.id, s as unknown as Fields);
        if (s.links.length) out += `\n### Links\n${s.links.map((l) => renderOwn('link', '', l as unknown as Fields)).join('')}`;
      }
      break;
  }
  return out;
}

/** Canonical text of every file for a whole model (used for new products and tests). */
export function renderRepo(model: Model): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, path] of Object.entries(FILE_PATHS)) out[path] = renderFile(key, model);
  for (const f of model.flows) out[flowPath(f.id)] = renderFile('flow', model, f.id);
  return out;
}

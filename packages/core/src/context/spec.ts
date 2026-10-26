// Declarative encoding of the item types and files (product/INSTRUCTIONS.md).
// The parser, the renderer and the editor are all driven from these tables.
import { formatTarget, parseTarget } from './target.ts';
import { PERSONA_FIELDS, STEP_TYPES, type ItemType, type VisionKey } from './types.ts';

export type FieldKind = 'text' | 'id' | 'ids';
export interface FieldDef {
  key: string; // markdown key, e.g. "our product"
  prop: string; // model property, e.g. "our_product"
  kind: FieldKind;
  /** ids fields that are always present in the model (empty list when the line is omitted). */
  alwaysList?: boolean;
}

export type ItemForm = 'block' | 'leaf' | 'step' | 'connection' | 'link';
export interface TypeDef {
  type: ItemType;
  prefix: string;
  form: ItemForm;
  /** Block items: heading level. */
  level?: 1 | 2;
  fields: FieldDef[];
}

const text = (key: string): FieldDef => ({ key, prop: key, kind: 'text' });

export const TYPES: Record<Exclude<ItemType, 'vision_field'>, TypeDef> = {
  out_of_scope: { type: 'out_of_scope', prefix: 'OS', form: 'leaf', fields: [] },
  constraint: { type: 'constraint', prefix: 'PC', form: 'leaf', fields: [] },
  persona: { type: 'persona', prefix: 'PE', form: 'block', level: 2, fields: PERSONA_FIELDS.map(text) },
  job: { type: 'job', prefix: 'JB', form: 'leaf', fields: [text('name')] },
  flow: { type: 'flow', prefix: 'FL', form: 'block', level: 1, fields: [{ key: 'jobs', prop: 'jobs', kind: 'ids', alwaysList: true }] },
  step: { type: 'step', prefix: 'FS', form: 'step', fields: [{ key: 'screen', prop: 'screen', kind: 'id' }, text('target')] },
  connection: { type: 'connection', prefix: 'FS', form: 'connection', fields: [] },
  screen: { type: 'screen', prefix: 'SC', form: 'block', level: 2, fields: [text('picture'), text('mockup')] },
  link: { type: 'link', prefix: 'SC', form: 'link', fields: [] },
};

/** Connections and links have no IDs of their own. */
export const PREFIX_TO_TYPE: Record<string, ItemType> = Object.fromEntries(
  Object.values(TYPES).filter((t) => t.form !== 'connection' && t.form !== 'link').map((t) => [t.prefix, t.type]),
);

/**
 * What the files and edits call a link, as connections are called "FS-a>FS-b": its screen, its
 * click zone (written one way, whatever spaces the file has) and the screen it opens.
 */
export function linkId(screen: string, box: string, to: string): string {
  const zone = parseTarget(box);
  return `${screen}@${zone ? formatTarget(zone) : box.trim()}>${to}`;
}

export const VISION_FIELDS: { key: string; prop: VisionKey; id: string }[] = [
  { key: 'for', prop: 'for', id: 'VI-FOR' },
  { key: 'who', prop: 'who', id: 'VI-WHO' },
  { key: 'the', prop: 'the', id: 'VI-THE' },
  { key: 'is a', prop: 'is_a', id: 'VI-ISA' },
  { key: 'that', prop: 'that', id: 'VI-THAT' },
  { key: 'unlike', prop: 'unlike', id: 'VI-UNLIKE' },
  { key: 'our product', prop: 'our_product', id: 'VI-OURS' },
];

// ---- Files ----------------------------------------------------------------

/** A fixed section heading and the item type listed under it. */
export interface SectionDef { heading: string; level: 2 | 3; type: ItemType | 'vision' }

export interface FileDef {
  /** Fixed H1 text, or the block item type whose heading is the H1 (flows). */
  title: string | { type: ItemType };
  /** Block items directly under the title. */
  rootType?: ItemType;
  /** Level-2 sections, in order. */
  sections?: SectionDef[];
  /** Level-3 sections inside each root block item, in order. */
  childSections?: SectionDef[];
}

export const FILES: Record<string, FileDef> = {
  product: {
    title: 'Product',
    sections: [
      { heading: 'Vision', level: 2, type: 'vision' },
      { heading: 'Out of scope', level: 2, type: 'out_of_scope' },
      { heading: 'Constraints', level: 2, type: 'constraint' },
    ],
  },
  personas: { title: 'Personas', rootType: 'persona', childSections: [{ heading: 'Jobs', level: 3, type: 'job' }] },
  flow: {
    title: { type: 'flow' },
    sections: [{ heading: 'Steps', level: 2, type: 'step' }, { heading: 'Connections', level: 2, type: 'connection' }],
  },
  screens: { title: 'Screens', rootType: 'screen', childSections: [{ heading: 'Links', level: 3, type: 'link' }] },
};

/** Every file of the product context lives in this folder. */
export const CONTEXT_DIR = 'product';

/** Repo-relative paths of the fixed (non-flow) files. */
export const FILE_PATHS: Record<string, string> = {
  product: `${CONTEXT_DIR}/product.md`,
  personas: `${CONTEXT_DIR}/personas.md`,
  screens: `${CONTEXT_DIR}/screens.md`,
};
export const FLOW_DIR = `${CONTEXT_DIR}/flows`;
export const flowPath = (id: string) => `${FLOW_DIR}/${id}.md`;

export const ID_RE = /^[A-Z]{2}-\d{3,}$/;
export const STEP_TYPE_SET = new Set<string>(STEP_TYPES);

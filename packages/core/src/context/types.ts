// The parsed product context (product/INSTRUCTIONS.md).

export const PREFIXES = ['OS', 'PC', 'PE', 'JB', 'FL', 'FS', 'SC'] as const;
export type Prefix = (typeof PREFIXES)[number];

export const VISION_KEYS = ['for', 'who', 'the', 'is_a', 'that', 'unlike', 'our_product'] as const;
export type VisionKey = (typeof VISION_KEYS)[number];

export const STEP_TYPES = ['start-end', 'user-action', 'user-decision', 'system-action', 'system-decision'] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const PERSONA_FIELDS = ['who', 'wants', 'pains', 'context'] as const;
export type PersonaField = (typeof PERSONA_FIELDS)[number];

export interface TextItem { id: string; text: string }
/** A job: its sentence, and a short name the PM calls it by. */
export interface Job { id: string; text: string; name?: string }
export interface Persona { id: string; name: string; who?: string; wants?: string; pains?: string; context?: string; jobs: Job[] }
export interface Step {
  id: string; step_type: StepType; label: string; screen?: string;
  /** What the user taps on the screen, in percent of its picture: "x, y, width, height". */
  target?: string;
}
export interface Connection { from: string; to: string; label?: string }
export interface Flow { id: string; name: string; jobs: string[]; steps: Step[]; connections: Connection[] }
/**
 * A click zone on a screen and the screen it opens: the zone in percent of the screen's
 * picture, "x, y, width, height" as a step's target, and when or how it leads there, where that matters.
 */
export interface Link { box: string; to: string; label?: string }
export interface Screen { id: string; name: string; picture?: string; mockup?: string; links: Link[] }

export interface Model {
  vision: Partial<Record<VisionKey, string>>;
  out_of_scope: TextItem[];
  constraints: TextItem[];
  personas: Persona[];
  flows: Flow[];
  screens: Screen[];
}

export type ItemType = 'vision_field' | 'out_of_scope' | 'constraint' | 'persona' | 'job' | 'flow' | 'step' | 'connection' | 'screen' | 'link';

export type Severity = 'error' | 'warning';
export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  items: string[];
  file?: string;
  line?: number;
}

export function emptyModel(): Model {
  return { vision: {}, out_of_scope: [], constraints: [], personas: [], flows: [], screens: [] };
}

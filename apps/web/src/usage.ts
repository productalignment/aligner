// Anonymous usage statistics, so Aligner's makers know how many PMs use it, what for, and whether
// they come back: the days each PM opens Aligner, the parts of the product they change, and how often
// they commit, start a product, branch off, or see their coding agent's push. Counts only: never a
// name, a login, a repository, a branch or anything in one. An Aligner and its PMs are known by
// hashes keyed with its GitHub app's secret, which nobody else can work out or trace back. They go to
// productalignment.org, as docs/usage-statistics.md says, and `ALIGNER_USAGE_STATS=off` stops them.
import { createHmac } from 'node:crypto';
import { PREFIX_TO_TYPE, type EditOp, type ItemType } from '@aligner/core';

export const USAGE_URL = 'https://productalignment.org/api/usage';

/** What a PM did. Opening Aligner and working on a part count once a day; the others each time. */
export type UsageEvent = 'open' | Part | 'mockups' | 'branch' | 'commit' | 'start' | 'push';
type Part = 'product' | 'flows' | 'screens';
const DAILY = new Set<UsageEvent>(['open', 'product', 'flows', 'screens', 'mockups']);

/** Where `ALIGNER_USAGE_STATS` sends them: unset, to productalignment.org; a URL, there; anything else (`off`), nowhere. */
export function usageUrl(setting: string | undefined): string | null {
  const s = setting?.trim();
  if (!s) return USAGE_URL;
  return /^https?:\/\//.test(s) ? s : null;
}

export class Usage {
  private readonly aligner: string;
  private day = '';
  /** The daily events already sent today, by PM. */
  private readonly sent = new Set<string>();

  /** `secret`: the GitHub app's, which the hashes are keyed with. */
  constructor(private readonly url: string, private readonly secret: string, private readonly version: string) {
    this.aligner = this.hash('aligner');
  }

  /** Sends what the PM did, in the background: it never holds up or fails what they do. */
  record(login: string, event: UsageEvent): void {
    const pm = this.hash(`pm ${login.toLowerCase()}`);
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.sent.clear();
    }
    if (DAILY.has(event)) {
      if (this.sent.has(`${pm} ${event}`)) return;
      this.sent.add(`${pm} ${event}`);
    }
    const body = JSON.stringify({ aligner: this.aligner, pm, version: this.version, event });
    fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  }

  private hash(of: string): string {
    return createHmac('sha256', this.secret).update(`aligner usage statistics: ${of}`).digest('hex').slice(0, 16);
  }
}

const PARTS: Record<ItemType, Part> = {
  vision_field: 'product', out_of_scope: 'product', constraint: 'product', persona: 'product', job: 'product',
  flow: 'flows', step: 'flows', connection: 'flows', screen: 'screens', link: 'screens',
};

/** The part of the product an edit changes: the product (vision, personas, jobs), a flow, or the screens. */
export function partOf(op: EditOp): Part {
  if (op.op === 'add') return PARTS[op.type];
  return op.id.startsWith('VI-') ? 'product' : PARTS[PREFIX_TO_TYPE[op.id.slice(0, 2)] ?? 'vision_field'];
}

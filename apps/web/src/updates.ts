// Telling the PM when a new version of Aligner is out, and updating their copy in one click:
// GitHub syncs their fork with the original, and Railway deploys it. A version is a heading of the
// original's CHANGELOG.md, with what it brings in plain words below it.
import type { Update } from '@aligner/core';
import { GitHubError, type GitHub } from './github.ts';

/** Where new versions come from. */
export const ORIGINAL = 'productalignment/aligner';
const CHECK_EVERY = 6 * 60 * 60_000;
const RETRY_AFTER = 15 * 60_000;

/** The versions a changelog lists, newest first, each with what it brings. */
export function releases(changelog: string): { version: string; notes: string[] }[] {
  const out: { version: string; notes: string[] }[] = [];
  for (const line of changelog.split('\n')) {
    const heading = /^## (\d+\.\d+\.\d+)\s*$/.exec(line);
    if (heading) out.push({ version: heading[1]!, notes: [] });
    else if (out.length && /^[-*] /.test(line)) out.at(-1)!.notes.push(line.slice(2).trim());
  }
  return out;
}

/** Whether version `a` comes after version `b`. */
export function newer(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x![i] !== y![i]) return (x![i] ?? 0) > (y![i] ?? 0);
  return false;
}

export class Updates {
  private checked?: { until: number; update?: Update };

  /**
   * `version`: this Aligner's. `copy`: the repository and branch Railway deploys it from (its fork
   * of the original), when Railway says so.
   */
  constructor(readonly version: string, private readonly copy?: { repo: string; branch: string }) {}

  /** What's new since this version, when the original has a newer one; asked of GitHub at most every few hours. */
  async check(gh: GitHub): Promise<Update | undefined> {
    if (this.checked && Date.now() < this.checked.until) return this.checked.update;
    try {
      const file = await gh.get<{ content: string }>(`/repos/${ORIGINAL}/contents/CHANGELOG.md`);
      const ahead = releases(Buffer.from(file.content, 'base64').toString('utf8')).filter((r) => newer(r.version, this.version));
      const update = ahead.length ? { version: ahead[0]!.version, notes: ahead.flatMap((r) => r.notes), ...(this.copy && this.copy.repo !== ORIGINAL ? { copy: this.copy.repo } : {}) } : undefined;
      this.checked = { until: Date.now() + CHECK_EVERY, update };
      return update;
    } catch {
      this.checked = { until: Date.now() + RETRY_AFTER }; // GitHub didn't answer: ask again a little later
      return undefined;
    }
  }

  /** Brings the PM's copy up to date with the original; Railway sees the push and deploys it. */
  async update(gh: GitHub): Promise<void> {
    if (!this.copy || this.copy.repo === ORIGINAL) throw new Error('Aligner doesn\'t know which repository it runs from. Update your copy on GitHub: open it and choose Sync fork.');
    try {
      await gh.request('POST', `/repos/${this.copy.repo}/merge-upstream`, { branch: this.copy.branch });
    } catch (e) {
      const status = e instanceof GitHubError ? e.status : 0;
      if (status === 409) throw new Error(`Your copy of Aligner (${this.copy.repo}) has changes of its own, so GitHub can't bring it up to date by itself. Open it on GitHub, and choose Sync fork.`);
      // Aligner's app may change files but not the repository's GitHub workflows, so GitHub refuses to bring in a new one.
      if (/workflow/i.test((e as Error).message)) throw new Error(`This version also changes the checks GitHub runs on Aligner, which Aligner isn't allowed to change in your copy (${this.copy.repo}). Open it on GitHub, and choose Sync fork.`);
      if (status === 403 || status === 404) throw new Error(`Aligner can't reach your copy of it (${this.copy.repo}). Add it to the repositories Aligner opens, or open it on GitHub and choose Sync fork.`);
      throw e;
    }
  }
}

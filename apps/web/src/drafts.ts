// Where the PM's drafts are kept between edits, sessions and restarts: Aligner's data folder,
// on Railway the volume attached to the service. One folder per PM, repository and branch holds
// the changed files under their git SHA and a small draft.json. A committed or discarded draft
// leaves nothing behind.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SavedDraft {
  /** The commit the draft is on, and its tree. */
  base: { commit: string; tree: string };
  /** What the PM changed, for the commit message. */
  notes: string[];
  /** The files the draft changes: their git blob SHA, and whether they are text; null: removed. */
  files: Record<string, { sha: string; text: boolean } | null>;
}

const MANIFEST = 'draft.json';

/** The SHA git gives a file's content, so Aligner knows a blob's ID before GitHub does. */
export function blobSha(data: Uint8Array): string {
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
}

export class DraftFolder {
  constructor(readonly dir: string) {}

  /** The draft, with the files' contents by SHA; null when there is none. A file whose content is damaged is left out. */
  async load(): Promise<{ draft: SavedDraft; data: Map<string, Uint8Array> } | null> {
    let draft: SavedDraft;
    try {
      draft = JSON.parse(await readFile(join(this.dir, MANIFEST), 'utf8')) as SavedDraft;
    } catch {
      return null;
    }
    const data = new Map<string, Uint8Array>();
    for (const [path, file] of Object.entries(draft.files)) {
      if (!file) continue;
      const content = await readFile(join(this.dir, file.sha)).catch(() => null);
      if (content && blobSha(content) === file.sha) data.set(file.sha, new Uint8Array(content));
      else delete draft.files[path];
    }
    return { draft, data };
  }

  /** Writes the draft: new contents first, then the manifest, each in one go; then lets go of contents it no longer needs. */
  async save(draft: SavedDraft, data: Map<string, Uint8Array>): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const have = new Set(await readdir(this.dir));
    for (const [sha, content] of data) if (!have.has(sha)) await atomically(join(this.dir, sha), content);
    await atomically(join(this.dir, MANIFEST), JSON.stringify(draft));
    const needed = new Set(Object.values(draft.files).flatMap((f) => (f ? [f.sha] : [])));
    for (const name of have) if (name !== MANIFEST && !needed.has(name)) await rm(join(this.dir, name), { force: true });
  }

  async remove(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

async function atomically(path: string, content: string | Uint8Array) {
  await writeFile(`${path}.tmp`, content);
  await rename(`${path}.tmp`, path);
}

/** The folder of one PM's draft of a branch. */
export function draftFolder(root: string, login: string, repo: string, branch: string): DraftFolder {
  return new DraftFolder(join(root, 'drafts', login, ...repo.split('/'), encodeURIComponent(branch).replace(/\./g, '%2E')));
}

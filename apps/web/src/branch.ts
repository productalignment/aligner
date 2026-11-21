// A branch of a product's repository, as the store of its product context. Files come
// from the branch's latest commit: those at the root of the repository and those in product/. The
// PM's edits make a draft, kept on the server between sessions and restarts, which they commit to
// the branch as one commit when it is ready. What someone else pushes meanwhile (the coding agent)
// is picked up, and the draft is moved onto it, item by item.
import { CONTEXT_DIR, fileKeyFor, itemName, mergeDraft, renameIds, serializer, toBytes, toText, type FileChanges, type ProductStore } from '@aligner/core';
import { blobSha, type DraftFolder } from './drafts.ts';
import { GitHubError, branchPath, type GitHub } from './github.ts';

interface Head {
  /** Empty for a repository with no commits yet. */
  commit: string;
  tree: string;
  /** Blob SHA by path, for the files at the root and in product/. */
  files: Map<string, string>;
}
interface Edit { data: Uint8Array; sha: string; text: boolean }
interface TreeEntry { path: string; type: string; sha: string }

const CHECK_EVERY = 2000;

/** Trees and blobs never change, so they are kept by SHA across branches and PMs, within bounds. */
const trees = new Map<string, TreeEntry[]>();
const blobs = new Map<string, Uint8Array>();
let blobBytes = 0;
const MAX_BLOB_BYTES = 128 * 1024 * 1024;

const edit = (data: string | Uint8Array): Edit => ({ data: toBytes(data), sha: blobSha(toBytes(data)), text: typeof data === 'string' });

export class BranchStore implements ProductStore {
  private head?: Head;
  /** The branch's latest commit as GitHub last told it, and the ETag to ask again for free. */
  private remote?: { commit: string; tree: string };
  private etag?: string;
  /** The commits this store's own commits went on top of: GitHub may still answer with one for a moment. */
  private readonly past = new Set<string>();
  private checkedAt = 0;
  private loading?: Promise<void>;
  /** The PM's draft, on top of `head`: the files it changes (null: removed), and what they changed. */
  private draft = new Map<string, Edit | null>();
  private notes: string[] = [];
  /** What the PM should know: what moving their draft onto a push kept or lost. */
  notice?: string;
  usedAt = Date.now();
  /** An edit reads the files and writes them in one go: the branch's new commits are taken in between edits. */
  readonly exclusive = serializer();

  constructor(private readonly gh: GitHub, readonly repo: string, readonly branch: string, private readonly folder: DraftFolder) {}

  /** How many things the draft changes; 0 when everything is committed. */
  get changes() {
    return this.draft.size ? Math.max(1, this.notes.length) : 0;
  }

  /** The commit the files are read from; empty in a repository with no commits yet. */
  async headCommit(): Promise<string> {
    return (await this.current()).commit;
  }

  async read(path: string): Promise<Uint8Array | null> {
    const head = await this.current();
    if (this.draft.has(path)) return this.draft.get(path)?.data ?? null;
    const sha = head.files.get(path);
    return sha ? this.blob(sha) : null;
  }

  async list(dir: string): Promise<string[]> {
    const out = new Set([...(await this.current()).files.keys()].filter((p) => p.startsWith(`${dir}/`)));
    for (const [path, e] of this.draft) if (path.startsWith(`${dir}/`)) e ? out.add(path) : out.delete(path);
    return [...out].sort();
  }

  async write(changes: FileChanges, note: string): Promise<void> {
    const head = await this.current();
    for (const [path, data] of changes) {
      const e = data === null ? null : edit(data);
      if ((e?.sha ?? null) === (head.files.get(path) ?? null)) this.draft.delete(path); // back to what the branch has
      else this.draft.set(path, e);
    }
    if (!this.draft.size) this.notes = [];
    else if (!this.notes.includes(note)) this.notes.push(note);
    await this.save();
  }

  /** A digest of the product context as the PM sees it: the same before and after their draft is committed. */
  async version(): Promise<string> {
    const files = new Map([...(await this.current()).files].filter(([p]) => p.startsWith(`${CONTEXT_DIR}/`)));
    for (const [path, e] of this.draft) if (path.startsWith(`${CONTEXT_DIR}/`)) e ? files.set(path, e.sha) : files.delete(path);
    return blobSha(toBytes([...files.keys()].sort().map((p) => `${p} ${files.get(p)}`).join('\n')));
  }

  /**
   * Takes in the branch's latest commit when someone else pushed to it, asking GitHub at most every
   * couple of seconds (an unchanged answer costs nothing), and moves the draft onto it.
   */
  async refresh(): Promise<void> {
    if (!this.head || Date.now() - this.checkedAt < CHECK_EVERY) return void (await this.current());
    const remote = await this.fetchRemote();
    if (remote.commit === this.head.commit) return;
    const next = await this.load(remote);
    await this.exclusive(async () => { if (this.remote === remote && this.head!.commit !== remote.commit) await this.moveOnto(next); });
  }

  /** Commits the draft to the branch, as one commit on top of its latest one, with the PM's message. */
  commit(message: string): Promise<void> {
    return this.exclusive(async () => {
      await this.current();
      for (let attempt = 0; this.draft.size; attempt++) {
        const remote = await this.fetchRemote();
        if (remote.commit !== this.head!.commit) await this.moveOnto(await this.load(remote));
        if (!this.draft.size) break;
        const made = await this.createCommit(commitMessage(message, this.notes));
        if (await this.updateBranch(made.commit)) {
          const files = new Map(this.head!.files);
          for (const [path, e] of this.draft) e ? files.set(path, e.sha) : files.delete(path);
          this.past.add(this.head!.commit);
          this.head = { ...made, files };
          this.remote = made;
          this.draft.clear();
          this.notes = [];
          await this.save();
          return;
        }
        if (attempt === 3) throw new Error('The branch kept moving on GitHub. Try again.');
      }
    });
  }

  /**
   * Starts a new branch at the commit the files are read from, and moves the draft to it: the PM's
   * edits go with them, and this branch stays as it is.
   */
  branchOff(name: string, folder: DraftFolder): Promise<void> {
    return this.exclusive(async () => {
      const head = await this.current();
      if (!head.commit) throw new Error(`${this.repo} has no commits yet: add the product context first.`);
      try {
        await this.gh.post(`/repos/${this.repo}/git/refs`, { ref: `refs/heads/${name}`, sha: head.commit });
      } catch (e) {
        if (e instanceof GitHubError && e.status === 422) throw new Error(`There is already a branch named "${name}".`);
        throw e;
      }
      if (!this.draft.size) return;
      await this.save(folder);
      this.draft.clear();
      this.notes = [];
      await this.save();
    });
  }

  /** Lets go of the draft: the product context is the branch's again. */
  discard(): Promise<void> {
    return this.exclusive(async () => {
      await this.current();
      this.draft.clear();
      this.notes = [];
      await this.save();
    });
  }

  // ---- internals ------------------------------------------------------------

  private async current(): Promise<Head> {
    this.usedAt = Date.now();
    if (!this.head) await (this.loading ??= this.open().finally(() => (this.loading = undefined)));
    return this.head!;
  }

  /** The branch's latest commit, and the draft the PM left on it, moved onto that commit when the branch moved since. */
  private async open() {
    const remote = await this.fetchRemote();
    const saved = await this.folder.load();
    let head: Head | undefined;
    if (saved && Object.keys(saved.draft.files).length) {
      head = await this.load(saved.draft.base).catch(() => undefined);
      for (const [path, file] of Object.entries(saved.draft.files)) {
        const data = file && saved.data.get(file.sha);
        if (!file) this.draft.set(path, null);
        else if (data) this.draft.set(path, { data, sha: file.sha, text: file.text });
      }
      this.notes = saved.draft.notes;
    }
    this.head = head ?? (await this.load(remote));
    if (this.head.commit !== remote.commit) await this.moveOnto(await this.load(remote));
  }

  private async fetchRemote(): Promise<{ commit: string; tree: string }> {
    this.checkedAt = Date.now();
    try {
      const res = await this.gh.request<{ commit: { sha: string; commit: { tree: { sha: string } } } }>(
        'GET', `/repos/${this.repo}/branches/${branchPath(this.branch)}`, undefined, this.etag ? { 'if-none-match': this.etag } : {},
      );
      if (res.status !== 304 && !this.past.has(res.data.commit.sha)) {
        this.etag = res.etag;
        this.remote = { commit: res.data.commit.sha, tree: res.data.commit.commit.tree.sha };
      }
      return this.remote!;
    } catch (e) {
      // A repository with no commits yet has no branches: its product context starts from nothing.
      if (e instanceof GitHubError && e.status === 404 && !(await this.gh.get<unknown[]>(`/repos/${this.repo}/branches?per_page=1`)).length) {
        return (this.remote = { commit: '', tree: '' });
      }
      if (e instanceof GitHubError && e.status === 404) throw new GitHubError(404, `${this.repo} has no branch "${this.branch}".`);
      throw e;
    }
  }

  private async load(remote: { commit: string; tree: string }): Promise<Head> {
    const files = new Map<string, string>();
    if (remote.tree) {
      const root = await this.tree(remote.tree);
      for (const e of root) if (e.type === 'blob') files.set(e.path, e.sha);
      const dir = root.find((e) => e.path === CONTEXT_DIR && e.type === 'tree');
      if (dir) for (const e of await this.tree(dir.sha, true)) if (e.type === 'blob') files.set(`${CONTEXT_DIR}/${e.path}`, e.sha);
    }
    return { commit: remote.commit, tree: remote.tree, files };
  }

  private async tree(sha: string, recursive = false): Promise<TreeEntry[]> {
    const key = `${sha}${recursive ? ':r' : ''}`;
    let entries = trees.get(key);
    if (!entries) {
      entries = (await this.gh.get<{ tree: TreeEntry[] }>(`/repos/${this.repo}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`)).tree;
      if (trees.size > 1000) trees.delete(trees.keys().next().value!);
      trees.set(key, entries);
    }
    return entries;
  }

  private async blob(sha: string): Promise<Uint8Array> {
    let data = blobs.get(sha);
    if (!data) {
      const res = await this.gh.get<{ content: string }>(`/repos/${this.repo}/git/blobs/${sha}`);
      data = new Uint8Array(Buffer.from(res.content, 'base64'));
      blobs.set(sha, data);
      blobBytes += data.length;
      for (const [old, d] of blobs) {
        if (blobBytes <= MAX_BLOB_BYTES) break;
        blobs.delete(old);
        blobBytes -= d.length;
      }
    }
    return data;
  }

  private async save(folder = this.folder) {
    if (!this.draft.size) return folder.remove();
    const files: Record<string, { sha: string; text: boolean } | null> = {};
    const data = new Map<string, Uint8Array>();
    for (const [path, e] of this.draft) {
      files[path] = e && { sha: e.sha, text: e.text };
      if (e) data.set(e.sha, e.data);
    }
    await folder.save({ base: { commit: this.head!.commit, tree: this.head!.tree }, notes: this.notes, files }, data);
  }

  /** The product context files' texts at a commit, with the draft on top or not. */
  private async texts(head: Head, withDraft: boolean): Promise<Record<string, string>> {
    const paths = new Set([...head.files.keys()].filter((p) => fileKeyFor(p)));
    if (withDraft) for (const [p, e] of this.draft) if (fileKeyFor(p)) e ? paths.add(p) : paths.delete(p);
    const out: Record<string, string> = {};
    for (const p of [...paths].sort()) {
      const e = withDraft ? this.draft.get(p) : undefined;
      out[p] = toText(e ? e.data : await this.blob(head.files.get(p)!));
    }
    return out;
  }

  /**
   * The branch moved: the draft goes on top of its new commit, merged item by item with what was
   * pushed. The draft's other files (pictures, mockups, layouts) keep the draft's version.
   * The PM is told what both changed, and what the push removed from under their draft.
   */
  private async moveOnto(next: Head) {
    if (!this.draft.size) { this.head = next; return; }
    const [base, ours, theirs] = await Promise.all([this.texts(this.head!, false), this.texts(this.head!, true), this.texts(next, false)]);
    const merged = mergeDraft(base, ours, theirs);
    const draft = new Map<string, Edit | null>();
    for (const [path, text] of merged.files) draft.set(path, text === null ? null : edit(text));
    const kept = new Set(merged.kept);
    for (const [path, e] of this.draft) {
      if (fileKeyFor(path)) continue;
      const to = renameIds(path, merged.renames);
      const moved = e && e.text && merged.renames.size ? edit(renameIds(toText(e.data), merged.renames)) : e;
      if ((moved?.sha ?? undefined) === next.files.get(to)) continue;
      if (next.files.get(path) !== this.head!.files.get(path)) kept.add(/[A-Z]{2}-\d{3,}/.exec(to)?.[0] ?? to);
      draft.set(to, moved);
    }
    const name = (id: string) => itemName(merged.model, id);
    const said: string[] = [];
    if (kept.size) said.push(`Your coding agent changed ${[...kept].map(name).join(', ')} too: your draft keeps your version.`);
    if (merged.dropped.length) said.push(`Your coding agent removed ${merged.dropped.map(name).join(', ')}, which your draft changed: that change is gone.`);
    if (said.length) this.notice = said.join(' ');
    this.head = next;
    this.draft = draft;
    this.notes = draft.size ? this.notes.map((n) => renameIds(n, merged.renames)) : [];
    await this.save();
  }

  private async createCommit(message: string): Promise<{ commit: string; tree: string }> {
    if (!this.head!.commit) return this.firstCommit(message);
    const entries = await Promise.all([...this.draft].map(async ([path, e]) => {
      if (!e) return this.head!.files.has(path) ? { path, mode: '100644', type: 'blob', sha: null } : null;
      if (e.text) return { path, mode: '100644', type: 'blob', content: toText(e.data) };
      const blob = await this.gh.post<{ sha: string }>(`/repos/${this.repo}/git/blobs`, { content: Buffer.from(e.data).toString('base64'), encoding: 'base64' });
      return { path, mode: '100644', type: 'blob', sha: blob.sha };
    }));
    const tree = await this.gh.post<{ sha: string }>(`/repos/${this.repo}/git/trees`, { base_tree: this.head!.tree, tree: entries.filter(Boolean) });
    const commit = await this.gh.post<{ sha: string }>(`/repos/${this.repo}/git/commits`, { message, tree: tree.sha, parents: [this.head!.commit] });
    return { commit: commit.sha, tree: tree.sha };
  }

  /**
   * A repository with no commits: GitHub's git API needs one first, so the first file goes in
   * through the contents API, making the branch; the others follow in a second commit.
   */
  private async firstCommit(message: string): Promise<{ commit: string; tree: string }> {
    const [path, e] = [...this.draft].find(([, x]) => x)!;
    const res = await this.gh.request<{ commit: { sha: string; tree: { sha: string } } }>('PUT', `/repos/${this.repo}/contents/${branchPath(path)}`, {
      message, branch: this.branch, content: Buffer.from(e!.data).toString('base64'),
    });
    const made = { commit: res.data.commit.sha, tree: res.data.commit.tree.sha };
    this.head = { ...made, files: new Map([[path, e!.sha]]) };
    this.remote = made;
    this.draft.delete(path);
    return this.draft.size ? this.createCommit(message) : made;
  }

  /** Moves the branch to the commit, only forward; false when someone pushed meanwhile. */
  private async updateBranch(commit: string): Promise<boolean> {
    if (commit === this.remote?.commit) return true; // the first commit of a new repository is already on it
    try {
      await this.gh.request('PATCH', `/repos/${this.repo}/git/refs/heads/${branchPath(this.branch)}`, { sha: commit, force: false });
      return true;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 422 && /fast.forward/i.test(e.message)) return false;
      throw e;
    }
  }
}

/** The PM's message (or a plain one), then what the draft changed: "edit FL-003", "add FS-104 to FL-003". */
export function commitMessage(message: string, notes: string[]): string {
  const subject = message.trim().replace(/\s+/g, ' ') || 'Update the product context';
  const changed = notes.filter((n) => n.toLowerCase() !== subject.toLowerCase());
  return changed.length ? `${subject}\n\nEdited in Aligner:\n${changed.map((n) => `- ${n}`).join('\n')}` : subject;
}

// What the UI asks of a signed-in PM's products: their repositories and branches, and the product
// context on a branch, read and edited through the branch's store, with the PM's draft.
import { ProductSession, type DraftStatus, type EditOp, type Layout, type Lines, type Markup, type ProductTheme, type Repo } from '@aligner/core';
import { BranchStore } from './branch.ts';
import { draftFolder } from './drafts.ts';
import { BLOCK_BEGIN, contextExtras, updateExtras } from './extras.ts';
import type { GitHub } from './github.ts';
import { readTheme, untar } from './theme.ts';

/** The signed-in PM, with GitHub as them. */
export interface Viewer { login: string; gh: GitHub }

interface Ref { repo: unknown; branch: unknown }
interface Open { store: BranchStore; session: ProductSession }

const IDLE = 30 * 60_000;

export class Products {
  private readonly open = new Map<string, Open>();
  private readonly themes = new Map<string, Promise<ProductTheme>>();
  private readonly sweeper: ReturnType<typeof setInterval>;

  /** `drafts`: the folder the PMs' drafts are kept in. */
  constructor(private readonly drafts: string) {
    // A product nobody has looked at for a while is let go; its draft stays in the data folder.
    this.sweeper = setInterval(() => {
      for (const [key, o] of this.open) if (Date.now() - o.store.usedAt > IDLE) this.open.delete(key);
    }, 5 * 60_000);
    this.sweeper.unref();
  }

  /** The repositories the PM gave Aligner and can push to, the latest pushed first. */
  repos = async (v: Viewer): Promise<Repo[]> => {
    type Installation = { id: number };
    type GitHubRepo = { full_name: string; default_branch: string; private: boolean; pushed_at: string | null; permissions?: { push?: boolean } };
    const installations = await v.gh.all<Installation, { installations: Installation[] }>('/user/installations', (p) => p.installations);
    const lists = await Promise.all(installations.map((i) => v.gh.all<GitHubRepo, { repositories: GitHubRepo[] }>(`/user/installations/${i.id}/repositories`, (p) => p.repositories)));
    return lists.flat()
      .filter((r) => r.permissions?.push)
      .map((r) => ({ repo: r.full_name, defaultBranch: r.default_branch, private: r.private, pushedAt: r.pushed_at }))
      .sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
  };

  /** A repository's branches, its default branch first. */
  branches = async (v: Viewer, p: { repo: unknown }): Promise<string[]> => {
    const repo = repoName(p.repo);
    const [info, branches] = await Promise.all([
      v.gh.get<{ default_branch: string }>(`/repos/${repo}`),
      v.gh.all<{ name: string }>(`/repos/${repo}/branches`),
    ]);
    const names = branches.map((b) => b.name).sort((a, b) => a.localeCompare(b));
    return [info.default_branch, ...names.filter((n) => n !== info.default_branch)];
  };

  /** A new branch at the one the PM is on, for speccing before any code; their draft goes with them. */
  createBranch = async (v: Viewer, p: Ref & { name: unknown }) => {
    const repo = repoName(p.repo);
    const name = branchName(p.name);
    await this.product(v, p).store.branchOff(name, draftFolder(this.drafts, v.login, repo, name));
    this.open.delete(`${v.login}\n${repo}\n${name}`);
    return name;
  };

  snapshot = (v: Viewer, p: Ref) => this.product(v, p).session.snapshot();

  /** Starting a product is committed at once, so the coding agent has its instructions. */
  initProduct = async (v: Viewer, p: Ref) => {
    const { session, store } = this.product(v, p);
    const { files, blocks } = contextExtras();
    await session.init(files, { blocks, marker: BLOCK_BEGIN });
    await store.commit('Add the product context');
    return session.snapshot();
  };

  edit = (v: Viewer, p: Ref & { op: EditOp }) => this.product(v, p).session.edit(p.op);
  setPicture = (v: Viewer, p: Ref & { screenId: string; fileName: string; dataBase64: string }) =>
    this.product(v, p).session.setPicture(String(p.screenId), String(p.fileName), Buffer.from(String(p.dataBase64), 'base64'));
  picture = (v: Viewer, p: Ref & { path: string }) => this.product(v, p).session.picture(String(p.path));
  saveLayout = (v: Viewer, p: Ref & { of: string; layout: Layout | null }) => this.product(v, p).session.saveLayout(String(p.of), p.layout ?? null);
  saveLines = (v: Viewer, p: Ref & { of: string; lines: Lines }) => this.product(v, p).session.saveLines(String(p.of), p.lines ?? {});
  markup = (v: Viewer, p: Ref & { screenId: string }) => this.product(v, p).session.markup(String(p.screenId));
  saveMockup = (v: Viewer, p: Ref & { screenId: string; markup: Markup; pngBase64: string }) =>
    this.product(v, p).session.saveMockup(String(p.screenId), p.markup, Buffer.from(String(p.pngBase64 ?? ''), 'base64'));

  /** The product's look, read from the code on its branch; once per commit. */
  theme = async (v: Viewer, p: Ref): Promise<ProductTheme> => {
    const { store } = this.product(v, p);
    const commit = await store.headCommit();
    if (!commit) return { colours: [], fonts: [], fontLinks: [], icons: [] };
    let theme = this.themes.get(commit);
    if (!theme) {
      theme = v.gh.tarball(store.repo, commit).then(untar).then(readTheme);
      theme.catch(() => this.themes.delete(commit));
      if (this.themes.size > 50) this.themes.delete(this.themes.keys().next().value!);
      this.themes.set(commit, theme);
    }
    return theme;
  };

  /** What the UI polls: the version of the files (the coding agent's pushes show up), and the PM's draft. */
  status = async (v: Viewer, p: Ref): Promise<DraftStatus> => {
    const { store } = this.product(v, p);
    await store.refresh();
    const notice = store.notice;
    store.notice = undefined;
    return { version: await store.version(), changes: store.changes, ...(notice ? { notice } : {}) };
  };

  /** The draft, committed with the coding agent's instructions brought up to date. */
  commit = async (v: Viewer, p: Ref & { message?: unknown }) => {
    const { session, store } = this.product(v, p);
    if (store.changes) await updateExtras(store);
    await store.commit(String(p.message ?? ''));
    return session.snapshot();
  };

  discard = async (v: Viewer, p: Ref) => {
    const { session, store } = this.product(v, p);
    await store.discard();
    return session.snapshot();
  };

  close() {
    clearInterval(this.sweeper);
  }

  private product(v: Viewer, p: Ref): Open {
    const repo = repoName(p.repo);
    const branch = String(p.branch ?? '');
    if (!branch || branch.startsWith('/') || branch.split('/').includes('..')) throw new Error(`"${branch}" is not a branch.`);
    const key = `${v.login}\n${repo}\n${branch}`;
    let o = this.open.get(key);
    if (!o) {
      const store = new BranchStore(v.gh, repo, branch, draftFolder(this.drafts, v.login, repo, branch));
      o = { store, session: new ProductSession(store, { repo, branch }) };
      this.open.set(key, o);
    }
    return o;
  }
}

/** UI methods that need a signed-in PM, by name. */
export const PRODUCT_METHODS = ['repos', 'branches', 'createBranch', 'snapshot', 'initProduct', 'edit', 'setPicture', 'picture', 'markup', 'saveLayout', 'saveLines', 'saveMockup', 'theme', 'status', 'commit', 'discard'] as const;
export type ProductMethod = (typeof PRODUCT_METHODS)[number];

function repoName(repo: unknown): string {
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split('/').some((part) => /^\.+$/.test(part))) throw new Error(`"${String(repo)}" is not a repository (owner/name).`);
  return repo;
}

/** A name git takes for a new branch: letters, digits, `-`, `_`, `.` and `/` between parts. */
function branchName(name: unknown): string {
  const n = String(name ?? '').trim();
  if (!/^[\w-]+(?:[./][\w-]+)*$/.test(n) || n.startsWith('-') || n.endsWith('.lock')) {
    throw new Error(`"${n}" can't be a branch name: use letters, digits and dashes, like option-b.`);
  }
  return n;
}

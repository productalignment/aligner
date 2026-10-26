// A stand-in for GitHub, in memory, for the tests, the screenshots and `npm run dev`: creating
// Aligner's app from its manifest, installing it, signing in (with PKCE and expiring tokens) and out, the
// repositories and branches, and the git data API Aligner commits through, with git's own object
// IDs. `push` changes a branch as the coding agent would.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

type Data = string | Uint8Array;
interface Entry { name: string; type: 'blob' | 'tree'; sha: string }
interface Commit { tree: string; parents: string[]; message: string }
interface Repo { defaultBranch: string; branches: Map<string, string>; private: boolean; pushedAt: string; forkOf?: string }
interface App { name: string; slug: string; clientId: string; clientSecret: string; setupUrl?: string }

const gitSha = (kind: string, body: Buffer) => createHash('sha1').update(`${kind} ${body.length}\0`).update(body).digest('hex');
const token = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;

export class FakeGitHub {
  /** The web (github.com) and the API (api.github.com) of this stand-in. */
  web = '';
  api = '';
  readonly user = { login: 'pat', name: 'Pat Doe', avatar_url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3Crect width="1" height="1" fill="%23a3a3a3"/%3E%3C/svg%3E' };
  readonly repos = new Map<string, Repo>();
  app?: App;
  /** Whether the PM has installed the app on their repositories. */
  installed = true;
  /** How long an access token lasts, in seconds. */
  tokenLife = 28800;
  /** Every API call, as "METHOD /path", and how many were answered "not modified". */
  readonly calls: string[] = [];
  notModified = 0;
  private readonly blobs = new Map<string, Buffer>();
  private readonly trees = new Map<string, Entry[]>();
  private readonly commits = new Map<string, Commit>();
  private readonly tokens = new Map<string, number>(); // access token → expiry (ms)
  private readonly refreshTokens = new Set<string>();
  private readonly codes = new Map<string, { challenge?: string; redirect: string }>();
  private readonly manifests = new Map<string, { name: string; redirect_url: string; setup_url?: string }>();
  private clock = 1_700_000_000;
  private server = createServer((req, res) => void this.route(req, res).catch((e: Error) => this.json(res, 500, { message: e.message })));

  static async start(): Promise<FakeGitHub> {
    const gh = new FakeGitHub();
    await new Promise<void>((r) => gh.server.listen(0, '127.0.0.1', r));
    gh.web = `http://127.0.0.1:${(gh.server.address() as AddressInfo).port}`;
    gh.api = `${gh.web}/api`;
    return gh;
  }

  close() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }

  /** The app, as if the PM had created it and given Railway its variables; after installing it, GitHub sends the PM to `setupUrl`. */
  createApp(name = 'Aligner test', setupUrl?: string): App {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return (this.app = { name, slug, clientId: `Iv23${randomBytes(6).toString('hex')}`, clientSecret: randomBytes(20).toString('hex'), setupUrl });
  }

  /** A repository the PM can push to, with `files` in its first commit; with none, it has no commits. */
  addRepo(name: string, files: Record<string, Data> = {}, opts: { defaultBranch?: string; private?: boolean } = {}) {
    const repo: Repo = { defaultBranch: opts.defaultBranch ?? 'main', branches: new Map(), private: opts.private ?? true, pushedAt: this.now() };
    this.repos.set(name, repo);
    if (Object.keys(files).length) repo.branches.set(repo.defaultBranch, this.writeCommit(this.writeTree(this.flatFiles(files)), [], 'Initial commit'));
  }

  /** A fork of a repository, its default branch where the original's is. */
  addFork(original: string, name: string) {
    const o = this.repo(original);
    this.repos.set(name, { defaultBranch: o.defaultBranch, branches: new Map([[o.defaultBranch, this.head(original, o.defaultBranch)]]), private: false, pushedAt: this.now(), forkOf: original });
  }

  /** A new branch, at the head of another. */
  addBranch(repo: string, name: string, from = this.repo(repo).defaultBranch) {
    this.repo(repo).branches.set(name, this.head(repo, from));
  }

  /** A commit pushed to the branch, as the coding agent would push one; null removes a file. */
  push(repo: string, branch: string, changes: Record<string, Data | null>, message = 'Build it') {
    const head = this.head(repo, branch);
    const flat = this.flatten(this.commits.get(head)!.tree);
    for (const [path, data] of Object.entries(changes)) data === null ? flat.delete(path) : flat.set(path, this.writeBlob(data));
    this.repo(repo).branches.set(branch, this.writeCommit(this.writeTree(flat), [head], message));
    this.repo(repo).pushedAt = this.now();
  }

  /** A file on the branch, as text, or undefined. */
  file(repo: string, branch: string, path: string): string | undefined {
    return this.bytes(repo, branch, path)?.toString('utf8');
  }

  bytes(repo: string, branch: string, path: string): Buffer | undefined {
    const sha = this.flatten(this.commits.get(this.head(repo, branch))!.tree).get(path);
    return sha ? this.blobs.get(sha) : undefined;
  }

  /** The messages of the branch's commits, newest first. */
  messages(repo: string, branch: string): string[] {
    const out: string[] = [];
    for (let sha: string | undefined = this.repo(repo).branches.get(branch); sha; sha = this.commits.get(sha)!.parents[0]) out.push(this.commits.get(sha)!.message);
    return out;
  }

  head(repo: string, branch: string): string {
    const sha = this.repo(repo).branches.get(branch);
    if (!sha) throw new Error(`${repo} has no branch ${branch}`);
    return sha;
  }

  // ---- git objects ------------------------------------------------------------

  private repo(name: string): Repo {
    const repo = this.repos.get(name);
    if (!repo) throw new Error(`No repository ${name}`);
    return repo;
  }

  private now() {
    return new Date((this.clock += 60) * 1000).toISOString();
  }

  private writeBlob(data: Data): string {
    const body = Buffer.from(data);
    const sha = gitSha('blob', body);
    this.blobs.set(sha, body);
    return sha;
  }

  private flatFiles(files: Record<string, Data>): Map<string, string> {
    return new Map(Object.entries(files).map(([path, data]) => [path, this.writeBlob(data)]));
  }

  /** A tree for files given by path, with a tree of its own for each folder. */
  private writeTree(flat: Map<string, string>): string {
    const entries: Entry[] = [];
    const dirs = new Map<string, Map<string, string>>();
    for (const [path, sha] of flat) {
      const i = path.indexOf('/');
      if (i < 0) entries.push({ name: path, type: 'blob', sha });
      else {
        const dir = path.slice(0, i);
        if (!dirs.has(dir)) dirs.set(dir, new Map());
        dirs.get(dir)!.set(path.slice(i + 1), sha);
      }
    }
    for (const [dir, sub] of dirs) entries.push({ name: dir, type: 'tree', sha: this.writeTree(sub) });
    const key = (e: Entry) => (e.type === 'tree' ? `${e.name}/` : e.name);
    entries.sort((a, b) => (key(a) < key(b) ? -1 : 1));
    const body = Buffer.concat(entries.map((e) => Buffer.concat([Buffer.from(`${e.type === 'tree' ? '40000' : '100644'} ${e.name}\0`), Buffer.from(e.sha, 'hex')])));
    const sha = gitSha('tree', body);
    this.trees.set(sha, entries);
    return sha;
  }

  /** Every file under a tree, by path. */
  private flatten(tree: string, prefix = '', out = new Map<string, string>()): Map<string, string> {
    for (const e of this.trees.get(tree) ?? []) {
      if (e.type === 'tree') this.flatten(e.sha, `${prefix}${e.name}/`, out);
      else out.set(`${prefix}${e.name}`, e.sha);
    }
    return out;
  }

  private writeCommit(tree: string, parents: string[], message: string): string {
    const body = Buffer.from(`tree ${tree}\n${parents.map((p) => `parent ${p}\n`).join('')}author Pat <pat@example.com> ${this.clock++} +0000\n\n${message}\n`);
    const sha = gitSha('commit', body);
    this.commits.set(sha, { tree, parents, message });
    return sha;
  }

  private descends(commit: string, from: string): boolean {
    for (const queue = [commit]; queue.length;) {
      const sha = queue.shift()!;
      if (sha === from) return true;
      queue.push(...(this.commits.get(sha)?.parents ?? []));
    }
    return false;
  }

  /** The tree as a gzipped tar archive, everything under one folder, as GitHub makes them. */
  private tarball(repo: string, commit: string): Buffer {
    const top = `${repo.replace('/', '-')}-${commit.slice(0, 7)}`;
    const blocks: Buffer[] = [];
    for (const [path, sha] of this.flatten(this.commits.get(commit)!.tree)) {
      const data = this.blobs.get(sha)!;
      const full = `${top}/${path}`;
      const header = Buffer.alloc(512);
      const cut = full.length > 100 ? full.indexOf('/', full.length - 101) : -1; // the name ≤ 100 characters, the rest in the prefix
      header.write(cut > 0 ? full.slice(cut + 1) : full, 0, 100);
      header.write('0000644\0', 100);
      header.write('0000000\0', 108);
      header.write('0000000\0', 116);
      header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
      header.write('00000000000\0', 136);
      header.write('        ', 148);
      header.write('0', 156);
      header.write('ustar\0', 257);
      header.write('00', 263);
      if (cut > 0) header.write(full.slice(0, cut), 345, 155);
      header.write(`${header.reduce((n, b) => n + b, 0).toString(8).padStart(6, '0')}\0 `, 148);
      blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
    return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
  }

  // ---- HTTP -------------------------------------------------------------------------

  private async route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.web);
    const body = await new Promise<string>((r) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => r(d));
    });
    const path = url.pathname;
    const redirect = (to: string) => { res.writeHead(302, { location: to }); res.end(); };

    // github.com: the pages the PM's browser goes through.
    if (req.method === 'POST' && path === '/settings/apps/new') {
      const manifest = JSON.parse(new URLSearchParams(body).get('manifest')!) as { name: string; redirect_url: string; setup_url?: string };
      const code = token('manifest');
      this.manifests.set(code, manifest);
      return redirect(`${manifest.redirect_url}?code=${code}&state=${url.searchParams.get('state')}`);
    }
    if (req.method === 'GET' && /^\/apps\/[^/]+\/installations\/new$/.test(path)) {
      this.installed = true;
      return redirect(`${this.app?.setupUrl ?? '/'}?installation_id=1&setup_action=install`);
    }
    if (req.method === 'GET' && path === '/login/oauth/authorize') {
      if (url.searchParams.get('client_id') !== this.app?.clientId) return this.json(res, 404, { message: 'Not Found' });
      const code = token('code');
      this.codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? undefined, redirect: url.searchParams.get('redirect_uri')! });
      return redirect(`${url.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(url.searchParams.get('state') ?? '')}`);
    }
    if (req.method === 'POST' && path === '/login/oauth/access_token') {
      const p = JSON.parse(body) as Record<string, string>;
      if (p.client_id !== this.app?.clientId || p.client_secret !== this.app?.clientSecret) return this.json(res, 200, { error: 'incorrect_client_credentials' });
      if (p.grant_type === 'refresh_token') {
        if (!this.refreshTokens.delete(p.refresh_token!)) return this.json(res, 200, { error: 'bad_refresh_token' });
      } else {
        const code = this.codes.get(p.code!);
        this.codes.delete(p.code!);
        const verified = code && (!code.challenge || createHash('sha256').update(p.code_verifier ?? '').digest('base64url') === code.challenge);
        if (!verified || p.redirect_uri !== code.redirect) return this.json(res, 200, { error: 'bad_verification_code' });
      }
      const access = token('ghu');
      const refresh = token('ghr');
      this.tokens.set(access, Date.now() + this.tokenLife * 1000);
      this.refreshTokens.add(refresh);
      return this.json(res, 200, { access_token: access, expires_in: this.tokenLife, refresh_token: refresh, refresh_token_expires_in: 15897600, token_type: 'bearer', scope: '' });
    }

    // api.github.com
    if (!path.startsWith('/api/')) return this.json(res, 404, { message: 'Not Found' });
    const api = path.slice(4);
    this.calls.push(`${req.method} ${api}`);
    const conversion = /^\/app-manifests\/([^/]+)\/conversions$/.exec(api);
    if (req.method === 'POST' && conversion) {
      const manifest = this.manifests.get(conversion[1]!);
      if (!manifest) return this.json(res, 404, { message: 'Not Found' });
      this.manifests.delete(conversion[1]!);
      const app = this.createApp(manifest.name, manifest.setup_url);
      this.installed = false;
      return this.json(res, 201, { id: 1, slug: app.slug, name: app.name, client_id: app.clientId, client_secret: app.clientSecret, webhook_secret: null, pem: '-----BEGIN RSA PRIVATE KEY-----' });
    }
    if (req.method === 'DELETE' && api === `/applications/${this.app?.clientId}/grant`) {
      // The PM's sign-in cancelled, by the app with its own keys: every token it gave them stops working.
      const basic = Buffer.from(/^Basic (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '', 'base64').toString();
      if (basic !== `${this.app!.clientId}:${this.app!.clientSecret}`) return this.json(res, 404, { message: 'Not Found' });
      if (!this.tokens.has(String((JSON.parse(body || '{}') as { access_token?: string }).access_token))) return this.json(res, 422, { message: 'Validation Failed' });
      this.tokens.clear();
      this.refreshTokens.clear();
      res.writeHead(204);
      return res.end();
    }
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!auth || !((this.tokens.get(auth) ?? 0) > Date.now())) return this.json(res, 401, { message: 'Bad credentials' });

    if (api === '/user') return this.json(res, 200, this.user);
    if (api === '/user/installations') {
      return this.json(res, 200, { total_count: this.installed ? 1 : 0, installations: this.installed ? [{ id: 1, account: { login: this.user.login }, app_slug: this.app?.slug }] : [] });
    }
    if (api === '/user/installations/1/repositories') {
      const repositories = [...this.repos].map(([name, r]) => ({ full_name: name, default_branch: r.defaultBranch, private: r.private, pushed_at: r.pushedAt, permissions: { admin: true, push: true, pull: true } }));
      return this.json(res, 200, { total_count: repositories.length, repositories: this.page(url, repositories) });
    }
    const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(api);
    if (!m || !this.repos.has(m[1]!)) return this.json(res, 404, { message: 'Not Found' });
    const name = m[1]!;
    const repo = this.repos.get(name)!;
    const rest = m[2] ?? '';
    const input = body ? (JSON.parse(body) as Record<string, unknown>) : {};
    const decode = (s: string) => s.split('/').map(decodeURIComponent).join('/');
    let r: RegExpExecArray | null;

    if (req.method === 'GET' && rest === '') return this.json(res, 200, { full_name: name, default_branch: repo.defaultBranch, private: repo.private });
    if (req.method === 'GET' && rest === '/branches') {
      return this.json(res, 200, this.page(url, [...repo.branches].map(([b, sha]) => ({ name: b, commit: { sha }, protected: false }))));
    }
    if (req.method === 'GET' && (r = /^\/branches\/(.+)$/.exec(rest))) {
      const sha = repo.branches.get(decode(r[1]!));
      if (!sha) return this.json(res, 404, { message: 'Branch not found' });
      const etag = `W/"${sha}"`;
      if (req.headers['if-none-match'] === etag) {
        this.notModified++;
        res.writeHead(304, { etag });
        return res.end();
      }
      return this.json(res, 200, { name: decode(r[1]!), commit: { sha, commit: { tree: { sha: this.commits.get(sha)!.tree } } } }, { etag });
    }
    if (req.method === 'GET' && (r = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest))) {
      const entries = this.trees.get(r[1]!);
      if (!entries) return this.json(res, 404, { message: 'Not Found' });
      const list = url.searchParams.get('recursive')
        ? [...this.flatten(r[1]!)].map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha, size: this.blobs.get(sha)!.length }))
        : entries.map((e) => ({ path: e.name, mode: e.type === 'tree' ? '040000' : '100644', type: e.type, sha: e.sha }));
      return this.json(res, 200, { sha: r[1], tree: list, truncated: false });
    }
    if (req.method === 'GET' && (r = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest))) {
      const data = this.blobs.get(r[1]!);
      return data ? this.json(res, 200, { sha: r[1], size: data.length, content: data.toString('base64'), encoding: 'base64' }) : this.json(res, 404, { message: 'Not Found' });
    }
    if (req.method === 'POST' && rest === '/git/blobs') {
      if (!repo.branches.size) return this.json(res, 409, { message: 'Git Repository is empty.' });
      return this.json(res, 201, { sha: this.writeBlob(Buffer.from(String(input.content), 'base64')) });
    }
    if (req.method === 'POST' && rest === '/git/trees') {
      if (!repo.branches.size) return this.json(res, 409, { message: 'Git Repository is empty.' });
      const flat = input.base_tree ? this.flatten(String(input.base_tree)) : new Map<string, string>();
      for (const e of input.tree as { path: string; sha?: string | null; content?: string }[]) {
        if (e.content !== undefined) flat.set(e.path, this.writeBlob(e.content));
        else if (e.sha === null) flat.delete(e.path);
        else flat.set(e.path, e.sha!);
      }
      return this.json(res, 201, { sha: this.writeTree(flat) });
    }
    if (req.method === 'POST' && rest === '/git/commits') {
      return this.json(res, 201, { sha: this.writeCommit(String(input.tree), input.parents as string[], String(input.message)) });
    }
    if (req.method === 'POST' && rest === '/git/refs') {
      const branch = String(input.ref).replace(/^refs\/heads\//, '');
      if (repo.branches.has(branch)) return this.json(res, 422, { message: 'Reference already exists' });
      if (!this.commits.has(String(input.sha))) return this.json(res, 422, { message: 'Object does not exist' });
      repo.branches.set(branch, String(input.sha));
      repo.pushedAt = this.now();
      return this.json(res, 201, { ref: input.ref, object: { sha: input.sha } });
    }
    if (req.method === 'PATCH' && (r = /^\/git\/refs\/heads\/(.+)$/.exec(rest))) {
      const branch = decode(r[1]!);
      const current = repo.branches.get(branch);
      if (!current) return this.json(res, 422, { message: 'Reference does not exist' });
      if (!input.force && !this.descends(String(input.sha), current)) return this.json(res, 422, { message: 'Update is not a fast forward' });
      repo.branches.set(branch, String(input.sha));
      repo.pushedAt = this.now();
      return this.json(res, 200, { ref: `refs/heads/${branch}`, object: { sha: input.sha } });
    }
    if (req.method === 'GET' && (r = /^\/contents\/(.+)$/.exec(rest))) {
      const data = this.bytes(name, url.searchParams.get('ref') ?? repo.defaultBranch, decode(r[1]!));
      return data ? this.json(res, 200, { content: data.toString('base64'), encoding: 'base64' }) : this.json(res, 404, { message: 'Not Found' });
    }
    if (req.method === 'POST' && rest === '/merge-upstream') {
      // Syncing a fork: its branch moves to the original's, when it has nothing of its own.
      const original = repo.forkOf && this.repos.get(repo.forkOf);
      if (!original) return this.json(res, 422, { message: 'This repository is not a fork.' });
      const branch = String(input.branch);
      const theirs = original.branches.get(original.defaultBranch)!;
      if (!this.descends(theirs, repo.branches.get(branch)!)) return this.json(res, 409, { message: 'There are merge conflicts.' });
      // Aligner's app has no `workflows` permission: GitHub won't let it bring in a changed workflow.
      const ours = this.flatten(this.commits.get(repo.branches.get(branch)!)!.tree);
      const workflow = [...this.flatten(this.commits.get(theirs)!.tree)].find(([p, sha]) => p.startsWith('.github/workflows/') && ours.get(p) !== sha);
      if (workflow) return this.json(res, 422, { message: `refusing to allow a GitHub App to create or update workflow \`${workflow[0]}\` without \`workflows\` permission` });
      repo.branches.set(branch, theirs);
      return this.json(res, 200, { message: `Successfully fetched and fast-forwarded from upstream ${repo.forkOf}:${original.defaultBranch}.`, merge_type: 'fast-forward', base_branch: `${repo.forkOf}:${original.defaultBranch}` });
    }
    if (req.method === 'PUT' && (r = /^\/contents\/(.+)$/.exec(rest))) {
      const branch = String(input.branch ?? repo.defaultBranch);
      const head = repo.branches.get(branch);
      const flat = head ? this.flatten(this.commits.get(head)!.tree) : new Map<string, string>();
      flat.set(decode(r[1]!), this.writeBlob(Buffer.from(String(input.content), 'base64')));
      const tree = this.writeTree(flat);
      const sha = this.writeCommit(tree, head ? [head] : [], String(input.message));
      repo.branches.set(branch, sha);
      return this.json(res, 201, { commit: { sha, tree: { sha: tree } } });
    }
    if (req.method === 'GET' && (r = /^\/tarball\/(.+)$/.exec(rest))) {
      const ref = decode(r[1]!);
      const commit = this.commits.has(ref) ? ref : repo.branches.get(ref);
      if (!commit) return this.json(res, 404, { message: 'Not Found' });
      res.writeHead(200, { 'content-type': 'application/x-gzip' });
      return res.end(this.tarball(name, commit));
    }
    return this.json(res, 404, { message: 'Not Found' });
  }

  private page<T>(url: URL, items: T[]): T[] {
    const per = Number(url.searchParams.get('per_page') ?? 30);
    const page = Number(url.searchParams.get('page') ?? 1);
    return items.slice((page - 1) * per, page * per);
  }

  private json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }
}

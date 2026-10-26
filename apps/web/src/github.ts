// The GitHub REST API, as the signed-in PM: their GitHub App user token, so Aligner reaches
// only the repositories they chose for it and can push to.

export interface GitHubUrls {
  /** Where people sign in and create apps: https://github.com */
  web: string;
  /** The REST API: https://api.github.com */
  api: string;
}

export class GitHubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface Response<T> { status: number; data: T; etag?: string }

export class GitHub {
  constructor(readonly urls: GitHubUrls, private readonly token: () => string) {}

  async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response<T>> {
    const res = await fetch(`${this.urls.api}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token()}`,
        'user-agent': 'Aligner',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 304) return { status: 304, data: undefined as T };
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw new GitHubError(res.status, explain(res.status, data.message, res.headers));
    return { status: res.status, data, etag: res.headers.get('etag') ?? undefined };
  }

  async get<T>(path: string): Promise<T> {
    return (await this.request<T>('GET', path)).data;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return (await this.request<T>('POST', path, body)).data;
  }

  /** Every item of a paginated list, 100 at a time; `pick` takes the items out of a page. */
  async all<T, P = T[]>(path: string, pick: (page: P) => T[] = (p) => p as unknown as T[], max = 10): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= max; page++) {
      const items = pick(await this.get<P>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`));
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  }

  /** The repository archive at a commit, as a gzipped tar stream. */
  async tarball(repo: string, ref: string): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(`${this.urls.api}/repos/${repo}/tarball/${ref}`, { headers: { authorization: `Bearer ${this.token()}`, 'user-agent': 'Aligner' } });
    if (!res.ok || !res.body) throw new GitHubError(res.status, `GitHub didn't give the archive of ${repo} (${res.status})`);
    return res.body;
  }
}

/** A branch name or a file path in a URL path: each part encoded, the slashes kept. */
export const branchPath = (name: string) => name.split('/').map(encodeURIComponent).join('/');

function explain(status: number, message: string | undefined, headers: Headers): string {
  if (status === 401) return 'Your GitHub sign-in has expired. Sign in again.';
  if (status === 403 && headers.get('x-ratelimit-remaining') === '0') return 'GitHub asks Aligner to slow down for a while (its rate limit). Try again in a few minutes.';
  if (status === 404) return "GitHub can't find it, or Aligner wasn't given access to it.";
  return message ? `GitHub: ${message}` : `GitHub answered ${status}.`;
}

// ---- Signing in with the GitHub App (the web application flow) ---------------------

export interface Tokens {
  token: string;
  /** Present when the app's user tokens expire (the default): every 8 hours, renewed with this. */
  refresh?: string;
  /** When `token` expires, in ms since the epoch. */
  expires?: number;
}

/** Exchanges the code GitHub sent back, or a refresh token, for the PM's tokens. */
export async function exchange(urls: GitHubUrls, params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${urls.web}/login/oauth/access_token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'Aligner' },
    body: JSON.stringify(params),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!data.access_token) throw new GitHubError(401, data.error_description ?? data.error ?? `GitHub refused to sign you in (${res.status}).`);
  return {
    token: data.access_token,
    ...(data.refresh_token ? { refresh: data.refresh_token } : {}),
    ...(data.expires_in ? { expires: Date.now() + data.expires_in * 1000 } : {}),
  };
}

/** Cancels the PM's sign-in at GitHub (the app's grant): every token it gave them stops working, on every device. */
export async function revoke(urls: GitHubUrls, app: { clientId: string; clientSecret: string }, token: string): Promise<void> {
  const res = await fetch(`${urls.api}/applications/${encodeURIComponent(app.clientId)}/grant`, {
    method: 'DELETE',
    headers: {
      accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'Aligner',
      authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`,
    },
    body: JSON.stringify({ access_token: token }),
  });
  if (!res.ok) throw new GitHubError(res.status, `GitHub didn't cancel the sign-in (${res.status}).`);
}

/** The app GitHub created from Aligner's manifest: what Aligner needs to sign people in. */
export interface CreatedApp { name: string; slug: string; clientId: string; clientSecret: string }

export async function convertManifest(urls: GitHubUrls, code: string): Promise<CreatedApp> {
  const res = await fetch(`${urls.api}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Aligner' },
  });
  const data = (await res.json().catch(() => ({}))) as { name?: string; slug?: string; client_id?: string; client_secret?: string; message?: string };
  if (!res.ok || !data.slug || !data.client_id || !data.client_secret) throw new GitHubError(res.status, data.message ?? `GitHub didn't create the app (${res.status}).`);
  return { name: data.name ?? data.slug, slug: data.slug, clientId: data.client_id, clientSecret: data.client_secret };
}

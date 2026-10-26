// How the UI reaches its server: Aligner's RPC bridge, as the PM signed in with GitHub (a session
// cookie the page never sees).
import type { AlignerApi, ProductRef } from '@aligner/core/api';

export interface Host {
  api: AlignerApi;
  signOut(): Promise<void>;
}

/** The PM isn't signed in (any more): the page goes back to signing in. */
export class SignedOut extends Error {}

export function connectHost(): Host {
  const call = async <T,>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const res = await fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-aligner': '1' }, body: JSON.stringify({ method, params }) });
    const body = (await res.json().catch(() => ({ error: `Aligner answered ${res.status}` }))) as { result?: T; error?: string };
    if (res.status === 401) throw new SignedOut(body.error);
    if (body.error) throw new Error(body.error);
    return body.result as T;
  };
  const at = (p: ProductRef) => ({ repo: p.repo, branch: p.branch });
  const api: AlignerApi = {
    account: () => call('account'),
    repos: () => call('repos'),
    branches: (repo) => call('branches', { repo }),
    createBranch: (p, name) => call('createBranch', { ...at(p), name }),
    snapshot: (p) => call('snapshot', at(p)),
    initProduct: (p) => call('initProduct', at(p)),
    edit: (p, op) => call('edit', { ...at(p), op }),
    setPicture: (p, screenId, fileName, dataBase64) => call('setPicture', { ...at(p), screenId, fileName, dataBase64 }),
    picture: (p, path) => call('picture', { ...at(p), path }),
    markup: (p, screenId) => call('markup', { ...at(p), screenId }),
    saveLayout: (p, of, layout) => call('saveLayout', { ...at(p), of, layout }),
    saveLines: (p, of, lines) => call('saveLines', { ...at(p), of, lines }),
    saveMockup: (p, screenId, markup, pngBase64) => call('saveMockup', { ...at(p), screenId, markup, pngBase64 }),
    theme: (p) => call('theme', at(p)),
    status: (p) => call('status', at(p)),
    commit: (p, message) => call('commit', { ...at(p), message }),
    discard: (p) => call('discard', at(p)),
    update: () => call('update'),
  };
  return { api, signOut: () => call('signOut') };
}

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Account, EditOp, ProductRef, ProductSnapshot } from '@aligner/core/api';
import type { Flow, Model } from '@aligner/core/context';
import { SignedOut, type Host } from './host';

export type View = 'product' | 'flows' | 'screens';
export interface Nav {
  view: View;
  /** The flow open in Flows. */
  flow?: string;
  /** The step selected in the open flow, or the screen selected on the map. */
  selected?: string;
  /** The screen open in the mockup editor. */
  screen?: string;
  /** Item whose text opens ready to type (set after adding it). */
  editing?: string;
  /** A job to bring into view on the Product page (opened from a flow). */
  job?: string;
}

/** Where the page is: a product (`?repo=owner/name&branch=…`), or the list of repositories. */
export interface Place { repo?: string; branch?: string }

interface Ctx {
  product: ProductSnapshot;
  /** The repository and branch the product is on. */
  at: ProductRef;
  account: Extract<Account, { stage: 'ready' }>;
  /** Shows the snapshot an edit returned; the edit is in the PM's draft. */
  onSnapshot: (p: ProductSnapshot) => void;
  /** Applies a PM edit, which goes into their draft. Resolves to the item's ID, or undefined on error. */
  edit: (op: EditOp) => Promise<string | undefined>;
  /** Uploads a screenshot for a screen. */
  setPicture: (screenId: string, file: File) => Promise<void>;
  /** A screen picture as a data URL (cached per snapshot). */
  picture: (path: string) => Promise<string>;
  host: Host;
  /** How many things the PM's draft changes: 0 when everything is committed. */
  changes: number;
  /** Commits the draft to the branch, with the PM's message; resolves to whether it did. */
  commit: (message: string) => Promise<boolean>;
  /** Lets go of the draft. */
  discard: () => Promise<void>;
  error: string | null;
  fail: (e: unknown) => void;
  clearError: () => void;
  nav: Nav;
  go: (patch: Partial<Nav>) => void;
  /** Opens another branch or repository; with neither, the list of repositories. */
  goTo: (place: Place) => void;
}

const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}

export function AppProvider({ host, account, product, nav, setNav, setProduct, goTo, children }: {
  host: Host; account: Ctx['account']; product: ProductSnapshot; nav: Nav; setNav: (fn: (n: Nav) => Nav) => void;
  setProduct: (p: ProductSnapshot) => void; goTo: (place: Place) => void; children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState(0);
  const pictures = useRef(new Map<string, Promise<string>>());
  const shown = useRef(product.version);
  shown.current = product.version;
  const api = host.api;
  const at = useMemo(() => ({ repo: product.repo, branch: product.branch }), [product.repo, product.branch]);
  // Signed out meanwhile (the session ended): back to signing in.
  const fail = (e: unknown) => (e instanceof SignedOut ? location.reload() : setError(String((e as Error).message ?? e)));

  /** Live refresh: what the coding agent pushes to the branch shows up by itself, and so does the draft's state. */
  const check = () => api.status(at).then(async (st) => {
    setChanges(st.changes);
    if (st.notice) setError(st.notice);
    if (st.version !== shown.current) setProduct(await api.snapshot(at));
  }).catch((e: unknown) => { if (e instanceof SignedOut) location.reload(); });
  useEffect(() => {
    void check();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, at]);
  const onSnapshot = (p: ProductSnapshot) => { shown.current = p.version; setProduct(p); void check(); };

  const value: Ctx = {
    product, at, account, nav, error, onSnapshot, host, fail, changes, goTo,
    clearError: () => setError(null),
    commit: async (message) => {
      try {
        onSnapshot(await api.commit(at, message));
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    discard: async () => {
      try { onSnapshot(await api.discard(at)); } catch (e) { fail(e); }
    },
    edit: async (op) => {
      try {
        const res = await api.edit(at, op);
        onSnapshot(res.snapshot);
        return res.id;
      } catch (e) {
        fail(e);
        return undefined;
      }
    },
    setPicture: async (screenId, file) => {
      try {
        const res = await api.setPicture(at, screenId, file.name, await fileToBase64(file));
        onSnapshot(res.snapshot);
      } catch (e) {
        fail(e);
      }
    },
    picture: (path) => {
      const key = `${product.loadedAt}:${path}`;
      let p = pictures.current.get(key);
      if (!p) { p = api.picture(at, path); pictures.current.set(key, p); }
      return p;
    },
    go: (patch) => setNav((n) => ({ ...n, ...patch })),
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ---- Model helpers ---------------------------------------------------------------

/** Distinct, calm colours for jobs: each job keeps its colour everywhere it shows. */
const JOB_COLOURS = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6', '#84cc16', '#f97316'];

export function jobColours(m: Model): Map<string, string> {
  const ids = m.personas.flatMap((p) => p.jobs.map((j) => j.id));
  return new Map(ids.map((id, i) => [id, JOB_COLOURS[i % JOB_COLOURS.length]!]));
}


/** The picture to show for a screen: its mockup when it has one, else its screenshot. */
export const screenImage = (m: Model, screenId: string | undefined) => {
  const s = m.screens.find((x) => x.id === screenId);
  return s?.mockup ?? s?.picture;
};

/** A flow's thumbnail: the picture of the first step (in order) whose screen has one. */
export function flowThumbnail(m: Model, flow: Flow): string | undefined {
  for (const s of flow.steps) {
    const img = screenImage(m, s.screen);
    if (img) return img;
  }
  return undefined;
}

// ---- Readiness for screenshot mode -------------------------------------------------
let pending = 0;
export function settle() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (pending === 0) document.body.dataset.ready = '1';
  }));
}
export function markBusy() { pending++; document.body.dataset.ready = '0'; }
export function markDone() { pending = Math.max(0, pending - 1); settle(); }

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

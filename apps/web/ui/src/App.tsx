import { Check, ChevronDown, CircleAlert, GitBranch, GitBranchPlus, GitCommitHorizontal, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Account, ProductSnapshot } from '@aligner/core/api';
import { SignedOut, type Host } from './host';
import { AppProvider, settle, useApp, type Nav, type Place, type View } from './state';
import { Button, cx } from './components/ui';
import { Popover } from './components/edit';
import { Product } from './views/Product';
import { Flows } from './views/Flows';
import { Screens } from './views/Screens';
import { AccountMenu, InitProduct, Message, Repos, Setup, SignIn } from './views/Start';

const INITIAL_NAV: Nav = { view: 'product' };
type Ready = Extract<Account, { stage: 'ready' }>;

const placeOf = (): Place => {
  const q = new URL(location.href).searchParams;
  return { repo: q.get('repo') ?? undefined, branch: q.get('branch') ?? undefined };
};

/** An error GitHub's round trip brought back (`?error=`), shown once and taken out of the address. */
function takeError(): string | null {
  const url = new URL(location.href);
  const error = url.searchParams.get('error');
  // GitHub's own, after the PM chose the repositories Aligner opens.
  const gone = ['error', 'installation_id', 'setup_action'].filter((k) => url.searchParams.has(k));
  for (const k of gone) url.searchParams.delete(k);
  if (gone.length) history.replaceState(null, '', url);
  return error;
}

export function App({ host }: { host: Host }) {
  const [account, setAccount] = useState<Account>();
  const [error] = useState(takeError);
  const [failed, setFailed] = useState<string | null>(null);
  const [place, setPlace] = useState<Place>(placeOf);

  const check = useCallback(() => host.api.account().then(setAccount, (e: Error) => setFailed(e.message)), [host]);
  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    const back = () => setPlace(placeOf());
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  const goTo = useCallback((next: Place, replace = false) => {
    const q = new URLSearchParams();
    if (next.repo) q.set('repo', next.repo);
    if (next.branch) q.set('branch', next.branch);
    const url = q.toString() ? `/?${q}` : '/';
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
    setPlace(next);
  }, []);

  if (!account) return failed ? <Message title="Aligner can't start">{failed}</Message> : <Opening />;
  if (account.stage === 'setup') return <Setup account={account} error={error} onCheck={check} />;
  if (account.stage === 'signin') return <SignIn error={error} />;
  if (!place.repo) return <Repos host={host} account={account} error={error} onOpen={(repo, branch) => goTo({ repo, branch })} />;
  return <Workspace key={`${place.repo}@${place.branch ?? ''}`} host={host} account={account} place={place} goTo={goTo} />;
}

const Opening = () => <p className="p-6 text-sm text-neutral-400">Opening Aligner…</p>;

/** A product: a repository's branch. Without a branch, its default branch. */
function Workspace({ host, account, place, goTo }: { host: Host; account: Ready; place: Place; goTo: (p: Place, replace?: boolean) => void }) {
  const [product, setProduct] = useState<ProductSnapshot | null>();
  const [nav, setNav] = useState<Nav>(INITIAL_NAV);
  const [error, setError] = useState<string | null>(null);
  const repo = place.repo!;

  useEffect(() => {
    const fail = (e: Error) => (e instanceof SignedOut ? location.reload() : (setError(e.message), setProduct(null)));
    if (!place.branch) void host.api.branches(repo).then(([branch]) => goTo({ repo, branch }, true), fail);
    else void host.api.snapshot({ repo, branch: place.branch }).then(setProduct, fail);
  }, [host, repo, place.branch, goTo]);

  // Screenshot and test hook: open a view directly.
  useEffect(() => {
    if (!product) return;
    window.__alignerNavigate = (spec) => setNav({ ...INITIAL_NAV, ...(spec as Partial<Nav>) });
    settle();
  }, [product]);

  if (product === undefined) return <Opening />;
  if (product === null) {
    return <Message title={`Aligner can't open ${repo}`} back={() => goTo({})}>{error}</Message>;
  }
  if (!product.hasContext) {
    return (
      <InitProduct
        product={product}
        error={error}
        back={() => goTo({})}
        onInit={async () => { try { setProduct(await host.api.initProduct(place as Required<Place>)); } catch (e) { setError((e as Error).message); } }}
      />
    );
  }
  return (
    <AppProvider host={host} account={account} product={product} nav={nav} setNav={setNav} setProduct={setProduct} goTo={goTo}>
      <Shell />
    </AppProvider>
  );
}

const TABS: { id: View; label: string }[] = [
  { id: 'product', label: 'Product' },
  { id: 'flows', label: 'Flows' },
  { id: 'screens', label: 'Screens' },
];

function Shell() {
  const { product, nav, go, host, account } = useApp();
  const views: Record<View, ReactNode> = { product: <Product />, flows: <Flows />, screens: <Screens /> };
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
        <div className="min-w-0 truncate text-[15px] font-semibold tracking-tight">{product.name}</div>
        <nav className="order-last flex w-full items-center gap-1 rounded-full bg-neutral-200/60 p-1 sm:order-none sm:w-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-tab={t.id}
              aria-current={nav.view === t.id ? 'page' : undefined}
              onClick={() => go({ view: t.id, ...(t.id === 'screens' ? { screen: undefined } : {}) })}
              className={cx('flex-1 rounded-full px-4 py-1 text-[13px] font-medium transition-colors sm:flex-none', nav.view === t.id ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-500 hover:text-neutral-900')}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Draft />
          <BranchMenu />
          <AccountMenu host={host} account={account} />
        </div>
      </header>
      <FileProblems />
      <main className={cx('relative min-h-0 flex-1', nav.view === 'product' ? 'overflow-auto' : 'flex flex-col')}>{views[nav.view]}</main>
      <ErrorToast />
    </div>
  );
}

/**
 * The PM's draft: their edits are kept in Aligner until they commit them to the branch, as one
 * commit, with a message if they like; or let go of them.
 */
function Draft() {
  const { changes, account, at, commit, discard } = useApp();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  if (!changes) {
    return (
      <span data-draft="0" title={`Everything is committed to ${at.branch}`} className="inline-flex items-center gap-1 px-1.5 text-[12px] text-neutral-400">
        <Check className="size-3.5" /><span className="hidden sm:inline">Committed</span>
      </span>
    );
  }
  const close = () => { setOpen(false); setDiscarding(false); };
  return (
    <span className="relative">
      <button data-draft={changes} aria-expanded={open} onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-[13px] font-medium text-amber-900 hover:bg-amber-200">
        <GitCommitHorizontal className="size-3.5" />
        {changes} {changes === 1 ? 'change' : 'changes'}<span className="hidden sm:inline"> · Commit</span>
      </button>
      {open && (
        <Popover onClose={close} width={320}>
          <form
            className="p-1"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              if (await commit(message)) { setMessage(''); close(); }
              setBusy(false);
            }}
          >
            <div className="text-[14px] font-medium text-neutral-900">Commit to {at.branch}</div>
            <p className="mt-1 text-[12px] leading-snug text-neutral-500">Your edits are kept in Aligner until you commit them. Then they are on GitHub, and your coding agent sees them.</p>
            <input data-commit-message autoFocus value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What changed? (optional)" className="mt-3 w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400" />
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button variant="primary" type="submit" data-commit disabled={busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Commit</Button>
              {discarding ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-red-700">
                  Discard {changes === 1 ? 'it' : `all ${changes}`}?
                  <button type="button" data-discard-yes onClick={async () => { await discard(); close(); }} className="rounded px-1.5 py-0.5 font-medium hover:bg-red-50">Discard</button>
                  <button type="button" onClick={() => setDiscarding(false)} className="rounded px-1.5 py-0.5 hover:bg-neutral-100">Keep</button>
                </span>
              ) : (
                <button type="button" data-discard onClick={() => setDiscarding(true)} className="rounded px-1.5 py-0.5 text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800">Discard…</button>
              )}
            </div>
            {!account.durable && <p data-not-durable className="mt-3 text-[11px] leading-snug text-amber-800">Aligner forgets your edits when it restarts until you give it a volume in Railway: commit them before you update it.</p>}
          </form>
        </Popover>
      )}
    </span>
  );
}

/** The repository and branch: another branch, a new one, or another repository. */
function BranchMenu() {
  const { at, host, goTo, fail } = useApp();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>();
  const [naming, setNaming] = useState(false);
  useEffect(() => { if (open) void host.api.branches(at.repo).then(setBranches, fail); else setNaming(false); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="relative">
      <button data-branch-menu aria-expanded={open} onClick={() => setOpen(true)} title={`${at.repo}, on ${at.branch}`} className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] text-neutral-600 hover:bg-white hover:text-neutral-900">
        <GitBranch className="size-3.5 shrink-0" />
        <span className="hidden truncate text-neutral-400 md:inline">{at.repo} ·</span>
        <span className="truncate">{at.branch}</span>
        <ChevronDown className="size-3.5 shrink-0 text-neutral-400" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} width={280}>
          <div className="truncate px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-neutral-400">{at.repo}</div>
          <div className="max-h-72 overflow-auto">
            {branches === undefined && <p className="px-2 py-1.5 text-[13px] text-neutral-400">Loading the branches…</p>}
            {branches?.map((b) => (
              <button key={b} data-branch={b} onClick={() => { setOpen(false); if (b !== at.branch) goTo({ repo: at.repo, branch: b }); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-50">
                <Check className={cx('size-3.5 shrink-0', b === at.branch ? 'text-neutral-900' : 'invisible')} />
                <span className="truncate">{b}</span>
              </button>
            ))}
          </div>
          <div className="mt-1 border-t border-neutral-100 pt-1">
            {naming ? (
              <NewBranch onCreated={(branch) => { setOpen(false); goTo({ repo: at.repo, branch }); }} />
            ) : (
              <button data-new-branch onClick={() => setNaming(true)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-600 hover:bg-neutral-50"><GitBranchPlus className="size-3.5 shrink-0" /> New branch…</button>
            )}
            <button data-other-repos onClick={() => goTo({})} className="w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-600 hover:bg-neutral-50">Other repositories…</button>
          </div>
        </Popover>
      )}
    </span>
  );
}

/**
 * A new branch from the one the PM is on, to spec a feature (or an option) before the coding agent
 * builds it there. Their uncommitted edits go with them.
 */
function NewBranch({ onCreated }: { onCreated: (branch: string) => void }) {
  const { at, host, changes } = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="px-2 py-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try { onCreated(await host.api.createBranch(at, name)); } catch (err) { setError((err as Error).message); setBusy(false); }
      }}
    >
      <input data-new-branch-name autoFocus value={name} onChange={(e) => { setName(e.target.value.replace(/\s+/g, '-')); setError(null); }} placeholder="new-feature" className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400" />
      <p className="mt-1.5 text-[12px] text-neutral-500">Starts from {at.branch}{changes ? ', and your uncommitted edits move to it' : ''}. Then pick it in your coding agent to build what you spec there.</p>
      {error && <p className="mt-1.5 text-[12px] text-red-700">{error}</p>}
      <Button variant="primary" type="submit" data-create-branch disabled={busy || !name} className="mt-2">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <GitBranchPlus className="size-4" />} Create branch</Button>
    </form>
  );
}

/** Errors in the files (a line the agent wrote wrong, a missing picture): rare, so they get one quiet line, not a panel. */
function FileProblems() {
  const { product } = useApp();
  const [open, setOpen] = useState(false);
  const errors = product.findings.filter((f) => f.severity === 'error');
  if (!errors.length) return null;
  return (
    <div data-file-problems className="mx-4 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900 sm:mx-6">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <CircleAlert className="size-4 shrink-0" />
        <span className="flex-1">The product files have {errors.length === 1 ? 'a problem' : `${errors.length} problems`}. Ask your coding agent to fix {errors.length === 1 ? 'it' : 'them'}, with what it says here.</span>
        <span className="text-xs underline">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <ul className="mt-2 space-y-0.5 pl-6 font-mono text-[11px]">{errors.map((f, i) => <li key={i}>{f.file}{f.line ? `:${f.line}` : ''} {f.message}</li>)}</ul>}
    </div>
  );
}

function ErrorToast() {
  const { error, clearError } = useApp();
  if (!error) return null;
  return (
    <div data-error className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 shadow-lg">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <span className="flex-1">{error}</span>
      <button onClick={clearError} className="rounded p-0.5 hover:bg-red-100"><X className="size-3.5" /></button>
    </div>
  );
}

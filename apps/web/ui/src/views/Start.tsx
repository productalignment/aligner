// Getting to a product: connecting Aligner to GitHub the first time it runs, signing in,
// choosing a repository, and starting a product on a branch that has none.
import { ArrowLeft, Check, Copy, Download, FolderPlus, Lock, LogOut, Settings2, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Account, ProductSnapshot, Repo, Update } from '@aligner/core/api';
import { SignedOut, type Host } from '../host';
import { Button, cx } from '../components/ui';
import { Popover } from '../components/edit';
import { GitHubMark } from '../components/icons';

type Setup = Extract<Account, { stage: 'setup' }>;
type Ready = Extract<Account, { stage: 'ready' }>;

/** A card in the middle of the page. */
function Card({ title, children, wide }: { title: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-full items-start justify-center p-4 sm:items-center sm:p-6">
      <div className={cx('w-full rounded-2xl bg-white p-6 shadow-sm sm:p-8', wide ? 'max-w-xl' : 'max-w-md')}>
        <div className="mb-2 text-xl font-semibold tracking-tight">{title}</div>
        {children}
      </div>
    </div>
  );
}

const Problem = ({ error }: { error: string | null | undefined }) => (error ? <p data-start-error className="mt-3 text-sm text-red-700">{error}</p> : null);

export function Message({ title, children, back }: { title: string; children: ReactNode; back?: () => void }) {
  return (
    <Card title={title}>
      <p className="text-sm text-neutral-600">{children}</p>
      {back && <Button className="mt-5" onClick={back}><ArrowLeft className="size-4" /> Your repositories</Button>}
    </Card>
  );
}

/**
 * Aligner's first start: GitHub creates its app from the manifest Aligner wrote, then the PM gives
 * the app's variables to Railway, which restarts Aligner with them.
 */
export function Setup({ account, error, onCheck }: { account: Setup; error: string | null; onCheck: () => void }) {
  const [org, setOrg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Waiting for Railway to restart Aligner with the variables: this page goes on by itself.
  useEffect(() => {
    if (!account.created) return;
    const timer = setInterval(onCheck, 3000);
    return () => clearInterval(timer);
  }, [account.created, onCheck]);

  if (account.created) {
    return (
      <Card title="Last step: give the app to Railway" wide>
        <p className="text-sm text-neutral-600">GitHub created <b>{account.created.name}</b>, the app Aligner signs you in with. Aligner needs its keys, which only Railway can give it:</p>
        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-neutral-700">
          <li>In Railway, open your Aligner service, then <b>Variables</b>, then <b>Raw Editor</b>.</li>
          <li>Paste these lines, and choose <b>Update Variables</b>.</li>
          <li>Choose <b>Deploy</b> to apply them.</li>
        </ol>
        <div className="relative mt-4">
          <pre data-variables className="overflow-x-auto rounded-lg bg-neutral-900 p-3 pr-12 font-mono text-[12px] leading-relaxed text-neutral-100">{account.created.variables}</pre>
          <button
            title="Copy"
            onClick={() => void navigator.clipboard.writeText(account.created!.variables).then(() => setCopied(true))}
            className="absolute right-2 top-2 rounded-md p-1.5 text-neutral-300 hover:bg-white/10 hover:text-white"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
        </div>
        <p className="mt-4 text-[13px] text-neutral-400">Aligner restarts with them in a minute or two, and this page goes on to signing in. Keep these lines to yourself: they are the app's password.</p>
      </Card>
    );
  }
  const owner = org?.trim() ? `organizations/${encodeURIComponent(org.trim())}/` : '';
  return (
    <Card title="Connect Aligner to GitHub" wide>
      <p className="text-sm text-neutral-600">Aligner opens your products&rsquo; repositories through a GitHub app of its own, the way Railway connects to them. GitHub creates the app for you: it may read and change the files of the repositories you choose for it, and nothing else.</p>
      <form method="post" action={`${account.github}/${owner}settings/apps/new?state=${encodeURIComponent(account.state)}`} className="mt-5">
        <input type="hidden" name="manifest" value={account.manifest} />
        {org === null ? (
          <button type="button" onClick={() => setOrg('')} className="mb-4 block text-[13px] text-neutral-500 underline decoration-neutral-300 underline-offset-4 hover:text-neutral-900">Are your repositories in an organization?</button>
        ) : (
          <label className="mb-4 block text-[13px] text-neutral-600">
            The organization they are in (you must be one of its owners)
            <input autoFocus value={org} onChange={(e) => setOrg(e.target.value)} placeholder="my-startup" className="mt-1 block w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400" />
          </label>
        )}
        <Button variant="primary" type="submit" data-create-app><GitHubMark className="size-4" /> Create the app on GitHub</Button>
      </form>
      <Problem error={error} />
    </Card>
  );
}

export function SignIn({ error }: { error: string | null }) {
  const to = `${location.pathname}${location.search}`;
  return (
    <Card title="Aligner">
      <p className="mb-5 text-sm text-neutral-600">Sign in with GitHub to open your products.</p>
      <a href={`/auth/login?to=${encodeURIComponent(to)}`} data-sign-in className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700">
        <GitHubMark className="size-4" /> Sign in with GitHub
      </a>
      <Problem error={error} />
    </Card>
  );
}

/** The repositories the PM gave Aligner: one opens on its default branch. */
export function Repos({ host, account, error, onOpen }: { host: Host; account: Ready; error: string | null; onOpen: (repo: string, branch: string) => void }) {
  const [repos, setRepos] = useState<Repo[]>();
  const [failed, setFailed] = useState(error);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    void host.api.repos().then(setRepos, (e: Error) => (e instanceof SignedOut ? location.reload() : setFailed(e.message)));
  }, [host]);
  const shown = repos?.filter((r) => r.repo.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <Card title={<div className="flex items-center justify-between gap-3">Aligner <AccountMenu host={host} account={account} /></div>}>
      {repos?.length === 0 ? (
        <p className="text-sm text-neutral-600">Aligner can&rsquo;t open any repository yet. Choose the ones it may open, on GitHub: your products&rsquo; repositories.</p>
      ) : (
        <p className="mb-4 text-sm text-neutral-600">Open a product: its repository.</p>
      )}
      {repos && repos.length > 8 && (
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a repository" className="mb-2 w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400" />
      )}
      {repos === undefined && !failed && <p className="text-sm text-neutral-400">Loading your repositories…</p>}
      <div className="-mx-2 max-h-[60vh] overflow-auto">
        {shown?.map((r) => (
          <button key={r.repo} data-repo={r.repo} onClick={() => onOpen(r.repo, r.defaultBranch)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[14px] text-neutral-800 hover:bg-neutral-50">
            <span className="min-w-0 flex-1 truncate">{r.repo}</span>
            {r.private && <Lock className="size-3.5 shrink-0 text-neutral-300" aria-label="Private" />}
          </button>
        ))}
      </div>
      <a href={account.install} data-choose-repos className={cx('mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium', repos?.length === 0 ? 'bg-neutral-900 text-white hover:bg-neutral-700' : 'border border-neutral-200 text-neutral-700 hover:bg-neutral-50')}>
        <GitHubMark className="size-4" /> {repos?.length === 0 ? 'Choose repositories' : 'Choose other repositories'}
      </a>
      <Problem error={failed} />
    </Card>
  );
}

/** Who is signed in: where they choose the repositories Aligner may open, and signing out; and a newer Aligner, when there is one. */
export function AccountMenu({ host, account }: { host: Host; account: Ready }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center gap-1">
      {account.update && <UpdateNotice host={host} account={account} update={account.update} />}
      <button data-account aria-expanded={open} onClick={() => setOpen(true)} title={account.user.login} className="flex rounded-full p-1 hover:bg-white">
        <img src={account.user.avatar} alt="" className="size-6 rounded-full bg-neutral-200" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} width={260}>
          <div className="px-2 pb-2 pt-1 text-[13px]">
            <div className="font-medium text-neutral-900">{account.user.name ?? account.user.login}</div>
            <div className="text-neutral-400">@{account.user.login}</div>
          </div>
          <a href={account.install} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-neutral-700 hover:bg-neutral-50"><Settings2 className="size-3.5" /> Choose the repositories Aligner opens</a>
          <button data-sign-out onClick={() => void host.signOut().finally(() => location.assign('/'))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-50"><LogOut className="size-3.5" /> Sign out</button>
        </Popover>
      )}
    </span>
  );
}

/**
 * A newer version of Aligner is out: what it brings, and one click that brings the PM's copy
 * up to date on GitHub. Railway deploys it, and the page reloads once it runs.
 */
function UpdateNotice({ host, account, update }: { host: Host; account: Ready; update: Update }) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!updating) return;
    const timer = setInterval(() => {
      void host.api.account().then((a) => { if (a.stage === 'ready' && a.version !== account.version) location.reload(); }, () => undefined);
    }, 10_000);
    return () => clearInterval(timer);
  }, [updating, host, account.version]);
  return (
    <span className="relative">
      <button data-update aria-expanded={open} onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-1 text-[12px] font-medium text-accent-700 hover:bg-accent-100">
        <Sparkles className="size-3.5" /> {updating ? 'Updating…' : 'Update'}
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} width={340}>
          <div className="p-1 text-[13px] text-neutral-700">
            <div className="text-[14px] font-medium text-neutral-900">Aligner {update.version} is out</div>
            <div className="text-[12px] text-neutral-400">This one is {account.version}.</div>
            {update.notes.length > 0 && <ul data-update-notes className="mt-2 list-disc space-y-1 pl-4">{update.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            {updating ? (
              <p data-updating className="mt-3 text-neutral-600">Railway is deploying it, which takes a few minutes. This page reloads by itself when it's ready.</p>
            ) : update.copy ? (
              <>
                {!account.durable && <p className="mt-3 text-[12px] text-amber-800">Commit your edits first: Aligner forgets them when it restarts until you give it a volume in Railway.</p>}
                <Button variant="primary" className="mt-3" data-update-now onClick={async () => { try { await host.api.update(); setUpdating(true); } catch (e) { setError((e as Error).message); } }}><Download className="size-4" /> Update now</Button>
              </>
            ) : (
              <p className="mt-3 text-neutral-600">Open your copy of Aligner on GitHub and choose <b>Sync fork</b>: Railway deploys it by itself.</p>
            )}
            {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
          </div>
        </Popover>
      )}
    </span>
  );
}

/** The branch has no product context yet: offer to add it. */
export function InitProduct({ product, onInit, error, back }: { product: ProductSnapshot; onInit: () => Promise<void>; error: string | null; back: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Start a product here?" wide>
      <p className="mb-3 font-mono text-xs text-neutral-500">{product.repo} · {product.branch}</p>
      <p className="mb-5 text-sm text-neutral-600">Aligner will add a <code>product/</code> folder, and instructions for your coding agent in <code>CLAUDE.md</code> and <code>AGENTS.md</code>, in one commit to <b>{product.branch}</b>. Existing files are kept; the instructions are appended. Then you write the vision.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); await onInit(); setBusy(false); }}><FolderPlus className="size-4" /> Add product context</Button>
        <Button onClick={back}><ArrowLeft className="size-4" /> Your repositories</Button>
      </div>
      <Problem error={error} />
    </Card>
  );
}

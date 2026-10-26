// The product on one page, read top to bottom: the vision, its boundaries, and each
// persona with the jobs they hire the product for and the flows that serve each job.
import { ChevronRight, GitBranch, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Flow, Job, Persona, PersonaField, TextItem } from '@aligner/core/context';
import { flowThumbnail, jobColours, useApp } from '../state';
import { AddInline, DeleteButton, EditableText } from '../components/edit';
import { cx, Dot, FitText, Label } from '../components/ui';
import { Picture, fitBox, usePictureRatio } from '../components/Picture';

export function Product() {
  const { product, edit, go } = useApp();
  const m = product.model;
  const unlinked = m.flows.filter((f) => !f.jobs.length);
  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-4 sm:px-6">
      <VisionCard />
      <Boundaries />
      <div className="mt-12 space-y-10">
        {m.personas.map((p) => <PersonaCard key={p.id} persona={p} />)}
      </div>
      <div className="mt-6">
        <AddInline
          label="Persona"
          placeholder="Who is it for? e.g. Working parent"
          className="w-full max-w-80"
          once
          onAdd={async (name) => { const id = await edit({ op: 'add', type: 'persona', fields: { name } }); if (id) go({ editing: id }); }}
        />
      </div>
      {unlinked.length > 0 && (
        <section data-unlinked className="mt-12 rounded-2xl bg-neutral-200/50 p-5">
          <Label className="mb-3">Not linked to a job</Label>
          <div className="flex flex-wrap items-start gap-3">{unlinked.map((f) => <FlowCard key={f.id} flow={f} />)}</div>
        </section>
      )}
    </div>
  );
}

// ---- Vision -------------------------------------------------------------------------

/** What each part of Geoffrey Moore's vision statement holds, shown while it is empty. */
const HINT = {
  for: 'the target customer', who: 'their need or opportunity', the: 'Product name', is_a: 'product category',
  that: 'key benefit, the reason to buy', unlike: 'the current alternative', our_product: 'primary differentiator',
} as const;

function VisionCard() {
  const { product, edit } = useApp();
  const v = product.model.vision;
  const field = (key: keyof typeof HINT, id: string, className?: string) => (
    <EditableText
      value={v[key]}
      placeholder={HINT[key]}
      optional
      multiline
      title={id}
      className={v[key] ? className : 'not-italic text-neutral-300'}
      inputClassName="inline-block"
      onSave={(text) => void edit({ op: 'modify', id, fields: { text } })}
    />
  );
  return (
    <section data-vision className="rounded-3xl bg-white px-6 py-7 shadow-sm sm:px-10 sm:py-9">
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">{field('the', 'VI-THE')}</h1>
      {/* One part of the statement per line, so its structure reads at a glance. */}
      <p className="mt-5 max-w-3xl text-[17px] leading-relaxed sm:text-[19px] text-neutral-600 [&>span]:block">
        <span>For {field('for', 'VI-FOR', 'text-neutral-900')}</span>
        <span>who {field('who', 'VI-WHO', 'text-neutral-900')},</span>
        <span>{v.the || 'the product'} is a {field('is_a', 'VI-ISA', 'text-neutral-900')}</span>
        <span>that {field('that', 'VI-THAT', 'text-neutral-900')}.</span>
        <span>Unlike {field('unlike', 'VI-UNLIKE', 'text-neutral-900')},</span>
        <span>our product {field('our_product', 'VI-OURS', 'text-neutral-900')}.</span>
      </p>
    </section>
  );
}

/** Out of scope and constraints: folded by default, so the page leads with the people and their jobs. */
function Boundaries() {
  const { product } = useApp();
  const [open, setOpen] = useState(false);
  const m = product.model;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <section className="mt-3 px-2">
      <button data-boundaries onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-[13px] text-neutral-500 hover:text-neutral-900">
        <ChevronRight className={cx('size-4 transition-transform', open && 'rotate-90')} />
        Boundaries
        <span className="text-neutral-400">· {count(m.out_of_scope.length, 'thing out of scope', 'things out of scope')} · {count(m.constraints.length, 'constraint', 'constraints')}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-6 sm:grid-cols-2">
          <TextList label="Out of scope" items={m.out_of_scope} type="out_of_scope" placeholder="What the product won't do…" />
          <TextList label="Constraints" items={m.constraints} type="constraint" placeholder="e.g. Works offline" />
        </div>
      )}
    </section>
  );
}

function TextList({ label, items, type, placeholder }: { label: string; items: TextItem[]; type: 'out_of_scope' | 'constraint'; placeholder: string }) {
  const { edit } = useApp();
  return (
    <div className="rounded-2xl bg-white p-4 shadow-xs">
      <Label className="mb-2">{label}</Label>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.id} className="group/item flex items-start gap-2 text-[14px] text-neutral-700">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-neutral-400" />
            <span className="min-w-0 flex-1"><EditableText value={it.text} title={it.id} onSave={(text) => void edit({ op: 'modify', id: it.id, fields: { text } })} /></span>
            <DeleteButton onDelete={() => void edit({ op: 'remove', id: it.id })} />
          </li>
        ))}
      </ul>
      <AddInline label="Add" placeholder={placeholder} onAdd={(text) => edit({ op: 'add', type, fields: { text } })} />
    </div>
  );
}

// ---- Personas and jobs ------------------------------------------------------------------

const PERSONA_LABEL: Record<PersonaField, { label: string; hint: string }> = {
  who: { label: 'Who', hint: 'Who they are, in a sentence' },
  wants: { label: 'Wants', hint: 'What they want' },
  pains: { label: 'Pains', hint: 'What gets in their way today' },
  context: { label: 'Context', hint: 'Where and when they use the product' },
};

function PersonaCard({ persona }: { persona: Persona }) {
  const { edit, nav, go } = useApp();
  return (
    <section data-persona={persona.name} className="group/persona">
      <div className="group/item flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-lg font-semibold text-white" title={persona.id}>{persona.name[0]?.toUpperCase()}</span>
        <h2 className="text-xl font-semibold tracking-tight text-neutral-900">
          <EditableText value={persona.name} startEditing={nav.editing === persona.id} onDone={() => go({ editing: undefined })} onSave={(name) => void edit({ op: 'modify', id: persona.id, fields: { name } })} />
        </h2>
        <DeleteButton label="Delete persona" onDelete={() => void edit({ op: 'remove', id: persona.id })} />
      </div>
      <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2 sm:pl-14">
        {(Object.keys(PERSONA_LABEL) as PersonaField[]).map((k) => (
          <div key={k}>
            <dt className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">{PERSONA_LABEL[k].label}</dt>
            <dd className="mt-0.5 text-[14px] leading-snug text-neutral-700">
              <EditableText value={persona[k]} placeholder={PERSONA_LABEL[k].hint} optional multiline className={cx(!persona[k] && 'not-italic text-neutral-300')} onSave={(v) => void edit({ op: 'modify', id: persona.id, fields: { [k]: v } })} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 space-y-5 sm:pl-14">
        {persona.jobs.map((j) => <JobRow key={j.id} job={j} />)}
        <AddJob onAdd={(fields) => edit({ op: 'add', type: 'job', parent: persona.id, fields })} />
      </div>
    </section>
  );
}

/** What each part of a job statement holds, shown while it is empty. */
const JOB_HINT = { when: 'the situation or trigger', want: 'the motivation', so: 'the expected outcome' } as const;
type JobParts = Record<keyof typeof JOB_HINT, string>;
const NAME_HINT = 'a short name for the job';

/** A job's sentence in its three parts, or null when it doesn't follow "When …, I want to …, so …". */
function jobParts(text: string): JobParts | null {
  const m = /^When (.+?), I want to (.+?), so (.+)$/.exec(text);
  return m ? { when: m[1]!, want: m[2]!, so: m[3]! } : null;
}

const jobText = (p: JobParts) => `When ${p.when}, I want to ${p.want}, so ${p.so}`;

/** The outcome reads "so I can …"; one written otherwise ("so the flat still runs") keeps its own words. */
const outcome = (so: string) => (/^I can /.test(so) ? { label: 'so I can', text: so.slice(6) } : { label: 'so', text: so });

/** A job, one part of the statement per line, like the vision; a sentence that doesn't follow the template is edited whole. */
function JobStatement({ job }: { job: Job }) {
  const { edit } = useApp();
  const save = (text: string) => void edit({ op: 'modify', id: job.id, fields: { text } });
  const parts = jobParts(job.text);
  if (!parts) return <EditableText value={job.text} title={job.id} multiline onSave={save} />;
  const so = outcome(parts.so);
  const line = (label: string, value: string, set: (v: string) => string) => (
    <span className="block text-neutral-500">
      {label} <EditableText value={value} multiline title={job.id} className="text-neutral-900" inputClassName="inline-block" onSave={(v) => save(set(v))} />
    </span>
  );
  return (
    <>
      {line('When', parts.when, (when) => jobText({ ...parts, when }))}
      {line('I want to', parts.want, (want) => jobText({ ...parts, want }))}
      {line(so.label, so.text, (v) => jobText({ ...parts, so: so.label === 'so' ? v : `I can ${v}` }))}
    </>
  );
}

/** "+ Job" opens the template: the job is added once its name and all three parts are written. Enter moves to the next part. */
function AddJob({ onAdd }: { onAdd: (fields: { name: string; text: string }) => Promise<unknown> }) {
  const empty: JobParts & { name: string } = { name: '', when: '', want: '', so: '' };
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState(empty);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const close = () => { setOpen(false); setParts(empty); };
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
        <Plus className="size-3.5" /> Job
      </button>
    );
  }
  const keys = ['name', ...Object.keys(JOB_HINT)] as (keyof typeof empty)[];
  const labels = { name: 'Name', when: 'When', want: 'I want to', so: 'so I can' };
  const hints = { name: NAME_HINT, ...JOB_HINT };
  const clean = (v: string) => v.replace(/\s+/g, ' ').trim();
  return (
    <div
      data-add-job
      className="w-full max-w-[36rem] space-y-1.5 rounded-2xl bg-white p-4 text-[15px] shadow-xs"
      // Leaving the template with nothing written closes it; a half-written job stays until Escape.
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && !keys.some((k) => clean(parts[k]))) close(); }}
    >
      {keys.map((k, i) => (
        <label key={k} className="flex items-baseline gap-2">
          <span className="w-20 shrink-0 text-neutral-500">{labels[k]}</span>
          <input
            ref={(el) => { inputs.current[i] = el; }}
            autoFocus={i === 0}
            value={parts[k]}
            placeholder={hints[k]}
            onChange={(e) => setParts({ ...parts, [k]: e.target.value })}
            onKeyDown={async (e) => {
              if (e.key === 'Escape') close();
              if (e.key !== 'Enter' || !clean(parts[k])) return;
              e.preventDefault();
              const next = keys.findIndex((key) => !clean(parts[key]));
              if (next >= 0) { inputs.current[next]?.focus(); return; }
              close();
              await onAdd({ name: clean(parts.name), text: jobText({ when: clean(parts.when), want: clean(parts.want), so: `I can ${clean(parts.so)}` }) });
            }}
            className="min-w-0 flex-1 rounded-md px-1.5 py-0.5 text-neutral-900 outline-none ring-2 ring-neutral-200 focus:ring-neutral-300"
          />
        </label>
      ))}
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const { product, edit, go, nav } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(false);
  // Opened from a flow: brought into view and lit for a moment.
  useEffect(() => {
    if (nav.job !== job.id) return;
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setLit(true);
    go({ job: undefined });
    const t = setTimeout(() => setLit(false), 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.job]);
  const colour = jobColours(product.model).get(job.id);
  const flows = product.model.flows.filter((f) => f.jobs.includes(job.id));
  const [adding, setAdding] = useState(false);
  const addFlow = async (name: string) => {
    const id = await edit({ op: 'add', type: 'flow', fields: { name, jobs: [job.id] } });
    if (id) go({ view: 'flows', flow: id, selected: undefined });
  };
  return (
    <div ref={ref} data-job={job.text} data-lit={lit || undefined} className={cx('rounded-2xl bg-white p-4 shadow-xs transition-shadow duration-500', lit && 'ring-2 ring-neutral-900')}>
      <div className="group/item flex items-start gap-2.5">
        <Dot colour={colour} className="mt-1.5" />
        <div className="min-w-0 flex-1 text-[15px] leading-snug text-neutral-800">
          {/* The job's name, as its caption. */}
          <div className="mb-1 font-semibold text-neutral-900">
            <EditableText value={job.name} placeholder={NAME_HINT} optional title={job.id} className={cx(!job.name && 'font-normal not-italic text-neutral-300')} onSave={(name) => void edit({ op: 'modify', id: job.id, fields: { name } })} />
          </div>
          <JobStatement job={job} />
        </div>
        <DeleteButton label="Delete job" onDelete={() => void edit({ op: 'remove', id: job.id })} />
      </div>
      <div className="mt-3 flex flex-wrap items-start gap-3 pl-5">
        {flows.map((f) => <FlowCard key={f.id} flow={f} />)}
        {adding ? (
          <div className="flex h-[132px] w-40 items-center rounded-xl border-2 border-dashed border-neutral-200 p-2">
            <AddInline label="Flow" placeholder="Flow name…" once startOpen onClose={() => setAdding(false)} onAdd={addFlow} className="w-full" />
          </div>
        ) : (
          <button
            data-add-flow
            onClick={() => setAdding(true)}
            className={cx('flex h-[132px] w-40 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-[13px] transition-colors', flows.length ? 'border-neutral-100 text-neutral-300 hover:border-neutral-300 hover:text-neutral-600' : 'border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-700')}
          >
            <Plus className="size-5" /> Flow
          </button>
        )}
      </div>
    </div>
  );
}

/** A flow as a picture of its first screen, in that screen's shape, with its name and the dots of the jobs it serves. */
export function FlowCard({ flow }: { flow: Flow }) {
  const { product, go } = useApp();
  const thumb = flowThumbnail(product.model, flow);
  const ratio = usePictureRatio(thumb);
  const colours = jobColours(product.model);
  // Wide screenshots get wide cards, phone screenshots tall ones; at least wide enough for a name on two lines.
  const box = ratio ? fitBox(ratio, 240, 132) : { width: 160, height: 104 };
  const width = Math.max(box.width, 140);
  return (
    <button data-flow-card={flow.name} title={flow.id} onClick={() => go({ view: 'flows', flow: flow.id, selected: undefined })} className="group text-left" style={{ width }}>
      <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-neutral-200 transition group-hover:ring-2 group-hover:ring-neutral-400" style={{ height: box.height }}>
        {thumb ? <Picture path={thumb} alt={flow.name} className="h-full object-contain" style={{ width: box.width }} /> : <GitBranch className="size-6 text-neutral-300" />}
        {/* The jobs it serves, on the picture's corner, so they never take width from the name. */}
        {flow.jobs.length > 1 && (
          <span className="absolute left-1.5 top-1.5 flex gap-1 rounded-full bg-white/90 px-1.5 py-1 shadow-xs">
            {flow.jobs.map((j) => <Dot key={j} colour={colours.get(j)} className="size-2" />)}
          </span>
        )}
      </div>
      <FitText text={flow.name} className="mt-1.5 font-medium text-neutral-800" />
    </button>
  );
}

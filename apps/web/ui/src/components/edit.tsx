// Editing primitives. Every save is one PM edit, which the server writes to the files.
import { Check, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './ui';

/**
 * Text that turns into an input on click. Enter or blur saves, Escape cancels; Shift+Enter is a new
 * line where `multiline`. Only `optional` text can be cleared.
 */
export function EditableText({ value, onSave, placeholder = 'Empty', className, inputClassName, startEditing, onDone, multiline, optional, title }: {
  value: string | undefined; onSave: (v: string) => void; placeholder?: string; className?: string; inputClassName?: string;
  startEditing?: boolean; onDone?: () => void; multiline?: boolean; optional?: boolean; title?: string;
}) {
  const [editing, setEditing] = useState(!!startEditing);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (startEditing) setEditing(true); }, [startEditing]);
  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select();
      autosize(ref.current);
    }
  }, [editing]);

  const finish = (save: boolean) => {
    setEditing(false);
    onDone?.();
    // The files hold one line per item: line breaks become spaces.
    const v = draft.replace(/\s+/g, ' ').trim();
    if (save && v !== (value ?? '') && (v || optional)) onSave(v);
    else setDraft(value ?? '');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        rows={1}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => { setDraft(e.target.value); autosize(e.target); }}
        onKeyDown={onKey}
        onBlur={() => finish(true)}
        onClick={(e) => e.stopPropagation()}
        className={cx('block w-full resize-none overflow-hidden rounded-md bg-white px-1.5 py-0.5 text-inherit outline-none ring-2 ring-neutral-300', inputClassName)}
      />
    );
  }
  return (
    <span
      data-text
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={cx('cursor-text rounded-sm hover:bg-neutral-900/5', !value && 'italic text-neutral-400', className)}
      title={title}
    >
      {value || placeholder}
    </span>
  );
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/** A delete button that asks once more inline. Shown on hover of the nearest `group/item`. */
export function DeleteButton({ onDelete, label = 'Delete', className, always }: { onDelete: () => void; label?: string; className?: string; always?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <span className={cx('inline-flex items-center gap-0.5 rounded-md bg-red-50 px-1 text-[11px] text-red-700', className)} onClick={(e) => e.stopPropagation()}>
        {label}?
        <button className="rounded p-0.5 hover:bg-red-100" onClick={() => { setConfirm(false); onDelete(); }} title={label}><Check className="size-3.5" /></button>
        <button className="rounded p-0.5 hover:bg-red-100" onClick={() => setConfirm(false)} title="Keep"><X className="size-3.5" /></button>
      </span>
    );
  }
  return (
    <button
      title={label}
      onClick={(e) => { e.stopPropagation(); setConfirm(true); }}
      className={cx('rounded p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-600', !always && 'opacity-0 group-hover/item:opacity-100 focus:opacity-100', className)}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

/** "+ Add" that turns into an input; Enter adds and keeps the input open for the next one. */
export function AddInline({ label = 'Add', placeholder, onAdd, className, buttonClassName, once, startOpen, onClose }: {
  label?: ReactNode; placeholder: string; onAdd: (text: string) => void | Promise<unknown>; className?: string; buttonClassName?: string;
  /** Closes after one add. */
  once?: boolean;
  /** Opens as the input, and calls `onClose` when it closes. */
  startOpen?: boolean; onClose?: () => void;
}) {
  const [open, setOpenState] = useState(!!startOpen);
  const [text, setText] = useState('');
  const setOpen = (o: boolean) => { setOpenState(o); if (!o) onClose?.(); };
  if (!open) {
    return (
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700', buttonClassName)}>
        <Plus className="size-3.5" /> {label}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={text}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { setOpen(false); setText(''); }}
      onKeyDown={async (e) => {
        if (e.key === 'Escape') { setOpen(false); setText(''); }
        if (e.key === 'Enter') {
          const v = text.replace(/\s+/g, ' ').trim();
          if (!v) return;
          setText('');
          if (once) setOpen(false);
          await onAdd(v);
        }
      }}
      className={cx('rounded-md bg-white px-2 py-1 text-[13px] outline-none ring-2 ring-neutral-300', className ?? 'w-full')}
    />
  );
}

/** A popover anchored under its parent element, in a portal so scroll areas never clip it. Closes on an outside click or Escape. */
export function Popover({ onClose, children, width = 340 }: { onClose: () => void; children: ReactNode; width?: number }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.current?.parentElement?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: Math.min(r.bottom + 6, window.innerHeight - 380) });
  }, [width]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (panel.current && !panel.current.contains(e.target as Node)) onClose(); };
    // Escape closes the popover only, not what it was opened from.
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true); };
  }, [onClose]);
  return (
    <>
      <span ref={anchor} className="hidden" />
      {pos && createPortal(
        <div ref={panel} style={{ position: 'fixed', left: pos.left, top: pos.top, width }} onClick={(e) => e.stopPropagation()} className="z-50 rounded-xl border border-neutral-200 bg-white p-2 text-left shadow-lg">
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

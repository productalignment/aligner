import clsx from 'clsx';
import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export const cx = clsx;

export function Button({ className, variant = 'default', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'primary' }) {
  return (
    <button
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'default' && 'border border-neutral-200 bg-white text-neutral-800 shadow-xs hover:bg-neutral-50',
        variant === 'ghost' && 'text-neutral-600 hover:bg-neutral-100',
        variant === 'primary' && 'bg-neutral-900 text-white hover:bg-neutral-700',
        className,
      )}
      {...props}
    />
  );
}

/** A job's colour dot. The job's sentence shows on hover. */
export function Dot({ colour, title, className }: { colour?: string; title?: string; className?: string }) {
  return <span title={title} className={cx('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ background: colour ?? '#d4d4d4' }} />;
}

/** A quiet label above a group of things. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-[11px] font-medium uppercase tracking-wider text-neutral-400', className)}>{children}</div>;
}

/**
 * Text that fits a fixed box, like a sticky note: it wraps onto up to `lines` lines, and when it
 * still doesn't fit, its font steps down from `max` to `min` px. Past that it ends in an ellipsis.
 */
export function FitText({ text, lines = 2, max = 13, min = 10, className }: { text: string; lines?: number; max?: number; min?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = max;
    const fits = () => el.scrollHeight <= Math.ceil(lines * size * 1.25) + 1;
    el.style.fontSize = `${size}px`;
    while (!fits() && size > min) {
      size = Math.max(min, size - 0.5);
      el.style.fontSize = `${size}px`;
    }
  }, [text, lines, max, min]);
  return (
    <span ref={ref} title={text} className={cx('block overflow-hidden break-words leading-[1.25]', className)} style={{ fontSize: max, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines }}>
      {text}
    </span>
  );
}

/** A tool's name, shown after a second's hover; hidden while the menu its button opened (`aria-expanded`) is open. */
export function Tip({ label, children, side = 'bottom', align = 'center' }: { label: string; children: ReactNode; side?: 'bottom' | 'top'; align?: 'center' | 'start' }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-sm transition-opacity group-hover/tip:opacity-100 group-hover/tip:delay-1000 group-has-[[aria-expanded=true]]/tip:hidden',
          side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
          align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0',
        )}
      >
        {label}
      </span>
    </span>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$1,217", "$18.99", "-$70" */
export function money(n: number): string {
  const abs = Math.abs(n);
  const text = Math.abs(abs - Math.round(abs)) < 0.005 ? whole.format(abs) : cents.format(abs);
  return `${n < -0.004 ? '-' : ''}$${text}`;
}

export function parseMoney(text: string): number | null {
  const n = parseFloat(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'plain' | 'quiet' | 'danger'; small?: boolean };

export function Button({ kind = 'plain', small, className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg border font-medium disabled:opacity-50',
        small ? 'min-h-11 px-3 text-[13px]' : 'min-h-11 px-3.5 text-sm',
        kind === 'primary' && 'border-accent bg-accent text-white hover:bg-accent-dark',
        kind === 'plain' && 'border-edge bg-card text-ink hover:bg-ground',
        kind === 'quiet' && 'border-transparent bg-transparent text-chip-ink hover:bg-chip',
        kind === 'danger' && 'border-edge bg-card text-short hover:bg-warn',
        className,
      )}
    />
  );
}

const inputBase =
  'min-h-11 rounded-lg border border-edge bg-card px-2.5 text-[15px] text-ink placeholder:text-muted disabled:bg-ground disabled:text-muted';
export const inputClass = `${inputBase} w-full`;

/**
 * Tells browsers and password managers that a field is not a login, address
 * or card field, so they do not offer to fill it.
 */
export const noFill = {
  autoComplete: 'off',
  'data-form-type': 'other',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-bwignore': 'true',
} as const;

/** A money field. It keeps what is typed and reports a number when the field is left or Enter is pressed. */
export function MoneyInput(props: {
  value: number | null;
  onCommit: (n: number | null) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const show = (n: number | null) => (n == null ? '' : String(n));
  const [text, setText] = useState(show(props.value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(props.value));
  }, [props.value]);
  const commit = () => {
    const n = text.trim() === '' ? null : parseMoney(text);
    if (n !== props.value) props.onCommit(n);
    setText(show(n));
  };
  return (
    <input
      id={props.id}
      type="text"
      inputMode="decimal"
      {...noFill}
      aria-label={props['aria-label']}
      disabled={props.disabled}
      placeholder={props.placeholder}
      value={text}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={cx(inputBase, 'num text-right', props.className ?? 'w-28')}
    />
  );
}

export function Field(props: { label: string; hint?: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', props.className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      {props.children(id)}
      {props.hint && <span className="text-xs text-muted">{props.hint}</span>}
    </div>
  );
}

export function Check(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; small?: boolean }) {
  return (
    <label className={cx('flex items-center gap-2', props.small ? 'min-h-7 text-xs text-chip-ink' : 'min-h-11 text-sm')}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
        className={cx('m-0 accent-accent', props.small ? 'size-4' : 'size-5')}
      />
      <span>{props.label}</span>
    </label>
  );
}

export function Badge(props: { tone?: 'info' | 'warn' | 'plain' | 'good'; children: ReactNode }) {
  const tone = props.tone ?? 'plain';
  return (
    <span
      className={cx(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'info' && 'bg-info text-info-ink',
        tone === 'warn' && 'bg-warn text-warn-ink',
        tone === 'plain' && 'bg-chip text-chip-ink',
        tone === 'good' && 'bg-tint text-accent-dark',
      )}
    >
      {props.children}
    </span>
  );
}

export function Card(props: { children: ReactNode; className?: string; dashed?: boolean }) {
  return (
    <section
      className={cx(
        'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5',
        props.dashed ? 'border-dashed border-[#aeb8b0]' : 'border-line',
        props.className,
      )}
    >
      {props.children}
    </section>
  );
}

/** A modal window. Escape and the backdrop both close it. */
export function Dialog(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] rounded-xl border border-line bg-card p-0 text-ink shadow-xl"
    >
      <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3">
          <h2 className="font-display text-lg font-semibold">{props.title}</h2>
          <Button kind="quiet" small onClick={props.onClose}>
            Close
          </Button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">{props.children}</div>
        {props.footer && <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-5 py-3">{props.footer}</div>}
      </div>
    </dialog>
  );
}

export function GripIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="5.5" cy="3.5" r="1.3" />
      <circle cx="10.5" cy="3.5" r="1.3" />
      <circle cx="5.5" cy="8" r="1.3" />
      <circle cx="10.5" cy="8" r="1.3" />
      <circle cx="5.5" cy="12.5" r="1.3" />
      <circle cx="10.5" cy="12.5" r="1.3" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <circle cx="3.5" cy="9" r="1.6" />
      <circle cx="9" cy="9" r="1.6" />
      <circle cx="14.5" cy="9" r="1.6" />
    </svg>
  );
}

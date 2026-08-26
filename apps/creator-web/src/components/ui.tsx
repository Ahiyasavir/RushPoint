import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, className = '', glow = false }: {
  children: ReactNode; className?: string; glow?: boolean;
}) {
  return (
    <div className={`
      glass-card grad-border
      bg-[--surface-0] dark:bg-transparent
      border border-[--rp-border]
      rounded-2xl
      shadow-[0_1px_3px_rgba(10,12,26,0.04),0_8px_24px_-6px_rgba(10,12,26,0.06)]
      dark:shadow-[0_1px_3px_rgba(0,0,0,0.3),0_8px_32px_-8px_rgba(0,0,0,0.5)]
      transition-all duration-200
      hover:-translate-y-[2px]
      hover:shadow-[0_4px_16px_rgba(10,12,26,0.08),0_16px_40px_-8px_rgba(10,12,26,0.10)]
      dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4),0_16px_48px_-8px_rgba(0,0,0,0.6)]
      ${glow ? 'dark:shadow-[0_0_0_1px_rgba(255,87,34,0.2),0_8px_32px_-8px_rgba(255,87,34,0.3)]' : ''}
      ${className}
    `}>
      {children}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
export function Button({
  variant = 'primary', className = '', children, loading = false, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'subtle'; loading?: boolean }) {
  const styles: Record<string, string> = {
    primary: `
      relative overflow-hidden
      bg-gradient-to-r from-rp-fire to-rp-amber
      text-white font-semibold tracking-wide
      shadow-[0_2px_8px_rgba(255,87,34,0.25),0_1px_3px_rgba(255,87,34,0.15)]
      hover:shadow-[0_4px_20px_rgba(255,87,34,0.50),0_2px_8px_rgba(255,87,34,0.30)]
      hover:brightness-105
      active:brightness-95 active:scale-[0.98]
    `,
    ghost: `
      bg-transparent border border-[--rp-border]
      text-[--ink-2]
      hover:bg-[--surface-2] hover:text-[--ink-1] hover:border-[--ink-3]/30
    `,
    danger: `
      bg-rp-alert/90 text-white font-medium
      shadow-[0_2px_8px_rgba(239,68,68,0.25)]
      hover:shadow-[0_4px_16px_rgba(239,68,68,0.45)]
      hover:brightness-105 active:brightness-90
    `,
    subtle: `
      bg-[--surface-2] text-[--ink-2]
      hover:bg-[--rp-border] hover:text-[--ink-1]
    `,
  };
  return (
    <button
      className={`inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-sm transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[--surface-1] ${styles[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        <span className="me-2 w-4 h-4 rounded-full border-2 border-current/30 border-t-current animate-spin shrink-0" aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

// ── Input ─────────────────────────────────────────────────────────────────────
// `dense` trades the roomy default padding for a compact control — used by the
// Task Builder so a form of many small fields fits on screen without scrolling.
// It is a prop (not a className override) because two conflicting Tailwind
// padding utilities in one class list resolve by stylesheet order, not by which
// one is written last.
export function Input({ className = '', dense = false, ...rest }: InputHTMLAttributes<HTMLInputElement> & { dense?: boolean }) {
  return (
    <input
      className={`
        w-full ${dense ? 'px-2.5 py-2 rounded-lg text-[13px]' : 'px-3.5 py-2.5 rounded-xl text-sm'}
        bg-[--surface-0] dark:bg-[--surface-2]/60
        border border-[--rp-border]
        text-[--ink-1] placeholder:text-[--ink-3]
        focus:outline-none focus:ring-2 focus:ring-rp-fire/25 focus:border-rp-fire/40
        transition-all duration-150
        ${className}
      `}
      {...rest}
    />
  );
}

// ── Textarea ──────────────────────────────────────────────────────────────────
export function Textarea({ className = '', dense = false, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { dense?: boolean }) {
  return (
    <textarea
      className={`
        w-full resize-y ${dense ? 'px-2.5 py-2 rounded-lg text-[13px]' : 'px-3.5 py-2.5 rounded-xl text-sm'}
        bg-[--surface-0] dark:bg-[--surface-2]/60
        border border-[--rp-border]
        text-[--ink-1] placeholder:text-[--ink-3]
        focus:outline-none focus:ring-2 focus:ring-rp-fire/25 focus:border-rp-fire/40
        transition-all duration-150
        ${className}
      `}
      {...rest}
    />
  );
}

// ── Select ────────────────────────────────────────────────────────────────────
export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={`
        w-full px-3.5 py-2.5 rounded-xl text-sm
        bg-[--surface-0] dark:bg-[--surface-2]/60
        border border-[--rp-border]
        text-[--ink-1]
        focus:outline-none focus:ring-2 focus:ring-rp-fire/25 focus:border-rp-fire/40
        transition-all duration-150
        ${className}
      `}
      {...rest}
    >
      {children}
    </select>
  );
}

// ── Label ─────────────────────────────────────────────────────────────────────
export function Label({ children, dense = false }: { children: ReactNode; dense?: boolean }) {
  return (
    <label className={`block font-semibold text-[--ink-3] uppercase tracking-wider ${
      dense ? 'text-[10px] mb-0.5' : 'text-xs mb-1.5'}`}>{children}</label>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({
  children, color = 'zinc',
}: { children: ReactNode; color?: 'zinc' | 'green' | 'gold' | 'red' | 'cyan' | 'purple' }) {
  const map: Record<string, string> = {
    // NOTE: color="green" intentionally maps to rp-fire (the orange brand accent),
    // NOT a green. The actual green token is rp-go — don't assume green === green here.
    zinc:   'bg-[--surface-2] text-[--ink-2] border-[--rp-border]',
    green:  'bg-rp-fire/10 text-rp-fire border-rp-fire/20 dark:bg-rp-fire/15',
    gold:   'bg-rp-amber/10 text-rp-amber border-rp-amber/20',
    red:    'bg-rp-alert/10 text-rp-alert border-rp-alert/20',
    cyan:   'bg-rp-plasma/10 text-rp-plasma border-rp-plasma/20',
    purple: 'bg-rp-signal/10 text-rp-signal border-rp-signal/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${map[color]}`}>
      {children}
    </span>
  );
}

// ── TagChips ──────────────────────────────────────────────────────────────────
// Creator-authored tags, one chip per tag (change: game-task-tags). Before this
// existed `tags` was a WRITE-ONLY field: persisted, denormalized into publicGames
// /publicTasks and returned by searchGallery — and rendered by nothing at all,
// which is exactly what "I don't see the tags anywhere" was.
//
// Contract:
//  • Renders NOTHING (not an empty box) for an empty/absent list.
//  • `dir="auto"` on each chip — the text is creator-authored, so a Hebrew tag
//    must lay out RTL while an English one beside it stays LTR.
//  • Overflow is bounded so a 20-tag game cannot blow out a card; the "+N" text
//    comes from the caller's dictionary (`more`), never from string concatenation
//    here, so ui.tsx stays free of user-facing copy.
export function TagChips({ tags, max = 6, more, className = '' }: {
  tags?: string[]; max?: number; more?: (n: number) => string; className?: string;
}) {
  const list = (tags ?? []).filter((t) => typeof t === 'string' && t.trim().length > 0);
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  const hidden = list.length - shown.length;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {shown.map((tag) => (
        <span key={tag} dir="auto"
          className="inline-flex items-center max-w-full truncate px-2 py-0.5 rounded-full text-[11px] font-medium border bg-[--surface-2] text-[--ink-2] border-[--rp-border]">
          {tag}
        </span>
      ))}
      {hidden > 0 && more && (
        <span className="text-[11px] font-medium text-[--ink-3]">{more(hidden)}</span>
      )}
    </div>
  );
}

// ── Advanced (collapsible) ────────────────────────────────────────────────────
// `dense` is the Task Builder variant: tighter chrome so a stack of collapsed
// sections reads as a compact list rather than a wall of boxes. `meta` renders
// beside the chevron — use it for an at-rest summary (a count badge), so folding
// a section never hides the fact that it is configured.
// The chevron rotates by 90deg on open and the trigger carries aria-expanded, so
// screen readers and sighted users get the same state.
export function Advanced({ title, children, open, onToggle, dense = false, meta }: {
  title: string; children: ReactNode; open: boolean; onToggle: () => void;
  dense?: boolean; meta?: ReactNode;
}) {
  return (
    <div className={`border border-[--rp-border] overflow-hidden ${dense ? 'rounded-lg' : 'rounded-xl'}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full flex items-center gap-2 font-semibold text-[--ink-3] uppercase tracking-wider hover:bg-[--surface-2] transition-colors text-start ${
          dense ? 'px-2.5 py-1.5 text-[11px]' : 'px-3.5 py-2.5 text-xs'}`}
      >
        <span className="min-w-0 truncate">{title}</span>
        {meta && <span className="shrink-0 normal-case tracking-normal font-medium text-[--ink-3]">{meta}</span>}
        <span aria-hidden className={`ms-auto shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <div className={`border-t border-[--rp-border] ${dense ? 'p-2.5 space-y-2' : 'p-3.5 space-y-3'}`}>{children}</div>
      )}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-[--ink-3]">
      <div className="w-7 h-7 rounded-full border-2 border-rp-fire/20 border-t-rp-fire animate-spin" />
      {label && <span className="text-xs font-medium">{label}</span>}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
// Content-shaped loading placeholder. Size it via `className` (e.g. "h-4 w-24").
// The shimmer + reduced-motion handling live in index.css (.rp-skeleton).
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`rp-skeleton rounded-xl ${className}`} />;
}

// ── EmptyState ────────────────────────────────────────────────────────────────
// Reusable "nothing here yet" block: icon + title + optional body + optional CTA.
export function EmptyState({ icon, title, body, action }: {
  icon?: ReactNode; title: string; body?: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-16 px-6">
      {icon && <div aria-hidden="true" className="text-4xl">{icon}</div>}
      <h3 className="text-lg font-semibold text-[--ink-1]">{title}</h3>
      {body && <p className="text-sm text-[--ink-3] max-w-sm">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/**
 * A row of single-select option chips (change: guided-new-game-wizard; hoisted
 * here by change: smart-game-composer so the new-game wizard and the smart-build
 * questionnaire share ONE copy rather than drifting apart).
 *
 * Deliberately WRAPS rather than scrolls — a horizontally scrolling option row
 * hides options on a phone, and a hidden option is an unasked question.
 */
export function ChipRow<T extends string | number>({ label, options, value, onChange, render }: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => string;
}) {
  return (
    <div>
      <div className="text-[12px] font-medium text-[--ink-2] mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = o === value;
          return (
            <button key={String(o)} type="button" onClick={() => onChange(o)} aria-pressed={on}
              className={`min-h-[40px] px-3 rounded-lg border text-[13px] transition-colors ${
                on ? 'border-rp-fire bg-rp-fire/10 text-rp-fire font-medium'
                   : 'border-[--rp-border] text-[--ink-2] hover:bg-[--surface-2]'}`}>
              {render(o)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A row of MULTI-select option chips (change: smart-game-composer).
 *
 * A sibling of ChipRow rather than a `multi` flag on it: the two differ in what
 * a tap MEANS (choose vs toggle), which is exactly the thing `aria-pressed` and
 * the visual state have to communicate, and a boolean prop threading through
 * both would make the single-select case — used on every other question — carry
 * a branch it never takes.
 */
/**
 * An ordered 1-to-N RATING (change: smart-build-occasion-and-prep-scale).
 *
 * A third sibling of ChipRow, not a mode of it, because it answers a different
 * shape of question. Chips are a set of alternatives: picking one says nothing
 * about the others. A rating is a LADDER — picking level 4 says levels 1-3 are
 * also true — and that is exactly what the control has to communicate, which is
 * why every step up to the selection is filled rather than just the chosen one.
 *
 * Only the selected level's sentence is shown. Five explanations side by side is
 * a wall on a phone, and the difference between adjacent levels is a sentence,
 * not a word.
 */
export function RatingRow<T extends number>({ label, options, value, onChange, render, hint }: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  /** The full text of a level — the button's accessible name, never just its number. */
  render: (v: T) => string;
  /** The selected level's explanation. */
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[12px] font-medium text-[--ink-2] mb-1.5">{label}</div>
      <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const reached = o <= value;
          const exact = o === value;
          return (
            <button key={o} type="button" role="radio" aria-checked={exact}
              onClick={() => onChange(o)} aria-label={render(o)}
              className={`min-h-[44px] flex-1 rounded-lg border text-[15px] font-medium transition-colors ${
                exact ? 'border-rp-fire bg-rp-fire text-white'
                  : reached ? 'border-rp-fire bg-rp-fire/10 text-rp-fire'
                    : 'border-[--rp-border] text-[--ink-3] hover:bg-[--surface-2]'}`}>
              {o}
            </button>
          );
        })}
      </div>
      <p className="text-[13px] font-medium text-[--ink-1] mt-2">{render(value)}</p>
      {hint && <p className="text-[11px] text-[--ink-3] mt-0.5 leading-relaxed">{hint}</p>}
    </div>
  );
}

export function MultiChipRow<T extends string>({ label, options, values, onToggle, render, hint }: {
  label: string;
  options: readonly T[];
  values: readonly T[];
  onToggle: (v: T) => void;
  render: (v: T) => string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[12px] font-medium text-[--ink-2] mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = values.includes(o);
          return (
            <button key={String(o)} type="button" onClick={() => onToggle(o)} aria-pressed={on}
              className={`min-h-[40px] px-3 rounded-lg border text-[13px] transition-colors ${
                on ? 'border-rp-fire bg-rp-fire/10 text-rp-fire font-medium'
                   : 'border-[--rp-border] text-[--ink-2] hover:bg-[--surface-2]'}`}>
              {render(o)}
            </button>
          );
        })}
      </div>
      {hint && <p className="text-[11px] text-[--ink-3] mt-1.5">{hint}</p>}
    </div>
  );
}

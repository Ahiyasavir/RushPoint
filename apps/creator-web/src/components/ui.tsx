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
      className={`inline-flex items-center justify-center min-h-[40px] px-4 py-2 rounded-xl text-sm transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[--surface-1] ${styles[variant]} ${className}`}
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
export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`
        w-full px-3.5 py-2.5 rounded-xl text-sm
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
export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`
        w-full px-3.5 py-2.5 rounded-xl text-sm resize-y
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
export function Label({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-semibold text-[--ink-3] uppercase tracking-wider mb-1.5">{children}</label>;
}

// ── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({
  children, color = 'zinc',
}: { children: ReactNode; color?: 'zinc' | 'green' | 'gold' | 'red' | 'cyan' | 'purple' }) {
  const map: Record<string, string> = {
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

// ── Advanced (collapsible) ────────────────────────────────────────────────────
export function Advanced({ title, children, open, onToggle }: {
  title: string; children: ReactNode; open: boolean; onToggle: () => void;
}) {
  return (
    <div className="border border-[--rp-border] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-semibold text-[--ink-3] uppercase tracking-wider hover:bg-[--surface-2] transition-colors"
      >
        <span>{title}</span>
        <span className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && <div className="p-3.5 border-t border-[--rp-border] space-y-3">{children}</div>}
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

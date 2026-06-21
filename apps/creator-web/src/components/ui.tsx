// Tiny shared UI kit for the creator console. Clean, data-dense, one accent.
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-app-card border border-glass-border rounded-xl ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'subtle' }) {
  const styles: Record<string, string> = {
    primary: 'bg-neon-green text-black hover:brightness-110 font-semibold',
    ghost:   'bg-transparent border border-glass-border text-zinc-200 hover:bg-glass-hover',
    danger:  'bg-neon-red/90 text-white hover:brightness-110',
    subtle:  'bg-app-raised text-zinc-200 hover:bg-glass-hover',
  };
  return (
    <button
      className={`px-4 py-2 rounded-lg text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full px-3 py-2 rounded-lg bg-app-bg border border-glass-border text-zinc-100 text-sm
                  placeholder:text-zinc-600 focus:outline-none focus:border-neon-green/60 ${className}`}
      {...rest}
    />
  );
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full px-3 py-2 rounded-lg bg-app-bg border border-glass-border text-zinc-100 text-sm
                  placeholder:text-zinc-600 focus:outline-none focus:border-neon-green/60 resize-y ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={`w-full px-3 py-2 rounded-lg bg-app-bg border border-glass-border text-zinc-100 text-sm
                  focus:outline-none focus:border-neon-green/60 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-medium text-zinc-400 mb-1.5">{children}</label>;
}

export function Badge({ children, color = 'zinc' }: { children: ReactNode; color?: 'zinc' | 'green' | 'gold' | 'red' | 'cyan' }) {
  const map: Record<string, string> = {
    zinc:  'bg-app-raised text-zinc-400 border-glass-border',
    green: 'bg-neon-green/10 text-neon-green border-neon-green/30',
    gold:  'bg-neon-gold/10 text-neon-gold border-neon-gold/30',
    red:   'bg-neon-red/10 text-neon-red border-neon-red/30',
    cyan:  'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${map[color]}`}>
      {children}
    </span>
  );
}

// Collapsible "Advanced settings" section — the core of progressive disclosure.
export function Advanced({ title, children, open, onToggle }: {
  title: string; children: ReactNode; open: boolean; onToggle: () => void;
}) {
  return (
    <div className="border border-glass-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-glass-hover"
      >
        <span>{title}</span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && <div className="p-3 border-t border-glass-border space-y-3">{children}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-zinc-500">
      <div className="w-6 h-6 rounded-full border-2 border-neon-green/30 border-t-neon-green animate-spin" />
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}

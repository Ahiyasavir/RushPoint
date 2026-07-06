import React from 'react';
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react';
import { useT } from '../i18nContext';

export function Button({
  variant = 'primary', className = '', children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const map: Record<string, string> = {
    primary: `
      bg-gradient-to-r from-rp-fire to-rp-amber
      text-white font-bold tracking-wide
      shadow-[0_4px_16px_rgba(255,87,34,0.40),0_1px_4px_rgba(255,87,34,0.25)]
      hover:shadow-[0_6px_24px_rgba(255,87,34,0.55),0_2px_8px_rgba(255,87,34,0.30)]
      active:brightness-90 active:scale-[0.98]
    `,
    ghost: `
      bg-white/80 text-zinc-500
      border border-glass-border
      active:bg-glass-hover
      shadow-[0_1px_4px_rgba(26,10,0,0.06)]
    `,
    danger: `
      bg-rp-alert text-white font-semibold
      shadow-[0_4px_14px_rgba(239,68,68,0.35)]
      active:brightness-90 active:scale-[0.98]
    `,
  };
  return (
    <button
      className={`w-full py-3.5 rounded-2xl text-base transition-all duration-150 disabled:opacity-40 ${map[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`
        w-full px-4 py-4 rounded-2xl text-base
        bg-white border border-glass-border
        text-zinc-100 placeholder:text-zinc-600
        shadow-[0_1px_4px_rgba(26,10,0,0.06)]
        focus:outline-none focus:ring-2 focus:ring-rp-fire/30 focus:border-rp-fire/40
        transition-all duration-150
        ${className}
      `}
      {...rest}
    />
  );
}

export function Card({ children, className = '', style }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <div
      className={`bg-white border border-glass-border rounded-2xl shadow-[0_2px_12px_rgba(26,10,0,0.06),0_8px_32px_-8px_rgba(26,10,0,0.08)] ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  const { colorblind, t } = useT();
  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={t.play.progressLabel({ done, total })}
    >
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
            i < done
              ? 'bg-gradient-to-r from-rp-fire to-rp-amber shadow-[0_0_8px_rgba(255,87,34,0.5)]'
              : `bg-app-raised ${colorblind ? 'border border-dashed border-zinc-500' : ''}`
          }`}
        />
      ))}
      {/* Colorblind cue: a numeric readout so progress doesn't rely on color alone. */}
      {colorblind && (
        <span className="ms-1 text-xs font-mono text-zinc-400 tabular-nums shrink-0">{done}/{total}</span>
      )}
    </div>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="min-h-screen flex flex-col px-5 py-6 max-w-md mx-auto w-full">{children}</div>;
}

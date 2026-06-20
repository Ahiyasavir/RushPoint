import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react';

export function Button({
  variant = 'primary', className = '', children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const map: Record<string, string> = {
    primary: 'bg-accent text-black font-bold active:brightness-90',
    ghost:   'bg-app-raised text-zinc-100 border border-glass-border active:bg-glass-hover',
    danger:  'bg-danger text-white font-semibold active:brightness-90',
  };
  return (
    <button
      className={`w-full py-3.5 rounded-xl text-base transition disabled:opacity-40 ${map[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full px-4 py-3.5 rounded-xl bg-app-card border border-glass-border text-zinc-100 text-base
                  placeholder:text-zinc-600 focus:outline-none focus:border-accent/60 ${className}`}
      {...rest}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-app-card border border-glass-border rounded-2xl ${className}`}>{children}</div>;
}

export function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`h-1.5 flex-1 rounded-full ${i < done ? 'bg-accent' : 'bg-app-raised'}`} />
      ))}
    </div>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="min-h-screen flex flex-col px-5 py-6 max-w-md mx-auto w-full">{children}</div>;
}

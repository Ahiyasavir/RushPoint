import React, { forwardRef } from 'react';
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react';
import { useT } from '../i18nContext';

// forwardRef so a caller can move focus to a button — the confirmation dialog
// must put focus on its confirm control when it opens (change: play-touch-rtl-a11y).
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean }
>(function Button({
  variant = 'primary', className = '', children, loading = false, disabled, ...rest
}, ref) {
  const map: Record<string, string> = {
    primary: `
      bg-gradient-to-r from-[#C2410C] to-[#B45309]
      text-white font-bold tracking-wide
      shadow-[0_4px_16px_rgba(255,87,34,0.40),0_1px_4px_rgba(255,87,34,0.25)]
      hover:shadow-[0_6px_24px_rgba(255,87,34,0.55),0_2px_8px_rgba(255,87,34,0.30)]
      active:brightness-90 active:scale-[0.96]
    `,
    ghost: `
      bg-white/80 text-zinc-400 font-semibold
      border border-glass-border
      active:bg-glass-hover active:scale-[0.96]
      shadow-[0_1px_4px_rgba(26,10,0,0.06)]
    `,
    // The fill is the darkened ink-alert, not the brand #EF4444: white on the
    // brand red is 3.76:1, below AA, and this is the CONFIRM control of every
    // destructive dialog (leave the run, SOS) — read outdoors, in sun, while
    // walking. #C21414 takes the same pair to 6.17:1.
    danger: `
      bg-ink-alert text-white font-semibold
      shadow-[0_4px_14px_rgba(239,68,68,0.35)]
      active:brightness-90 active:scale-[0.98]
    `,
  };
  return (
    <button
      ref={ref}
      // Disabled uses a SOLID muted skin, not `opacity-40`. Opacity made the
      // whole button translucent, so the page's dot-grid showed through it, the
      // label fell to ~1.9:1 contrast, and the variant's coloured glow survived
      // at 40% — a glowing, see-through dead button. A flat surface + a readable
      // muted label reads as "not yet", which is what a disabled CTA must say.
      //
      // `disabled:bg-none` MUST come first and is not redundant. The primary
      // variant paints with `bg-gradient-to-r`, which is a background-IMAGE;
      // `disabled:bg-zinc-800` only sets background-COLOR, so without bg-none
      // the gradient still paints on top and the disabled button looks fully
      // enabled — worse than the opacity it replaced, because it then invites a
      // tap that does nothing. Verifying this needs `backgroundImage`, not just
      // `backgroundColor`: reading the colour alone reports a contrast ratio for
      // a layer the user never sees.
      className={`inline-flex items-center justify-center w-full py-3.5 rounded-2xl text-base transition-all duration-100 motion-reduce:transition-none motion-reduce:active:scale-100 disabled:bg-none disabled:bg-zinc-800 disabled:text-zinc-400 disabled:shadow-none disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg ${map[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        <span className="me-2 w-5 h-5 rounded-full border-2 border-current/30 border-t-current animate-spin shrink-0" aria-hidden="true" />
      )}
      {children}
    </button>
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`
          w-full px-4 py-4 rounded-2xl text-base
          bg-white border border-glass-border
          text-zinc-100 placeholder:text-zinc-500
          shadow-[0_1px_4px_rgba(26,10,0,0.06)]
          focus:outline-none focus:ring-2 focus:ring-rp-fire/30 focus:border-rp-fire/40
          transition-all duration-150
          ${className}
        `}
        {...rest}
      />
    );
  },
);

export function Card({ children, className = '', style, ...rest }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-white border border-glass-border rounded-2xl shadow-[0_2px_12px_rgba(26,10,0,0.06),0_8px_32px_-8px_rgba(26,10,0,0.08)] ${className}`}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}

// Above this many steps the segmented bar stops reading as progress: a
// 24-question assessment drew 24 hairlines with 1.5px gaps, which at a glance is
// a texture, not a measure. Past the cap it becomes one continuous filled bar
// (change: test-mode-game-feel).
const MAX_SEGMENTS = 12;

export function Progress({ done, total, label }: { done: number; total: number; label?: string }) {
  const { colorblind, t } = useT();
  // Defensive, because this renders on the participant's only screen from a
  // server-written document: a NaN `total` used to reach Array.from as a length.
  const max = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const at = Number.isFinite(done) ? Math.min(Math.max(0, Math.floor(done)), max) : 0;
  const pct = max > 0 ? (at / max) * 100 : 0;
  const fill = 'bg-gradient-to-r from-rp-fire to-rp-amber shadow-[0_0_8px_rgba(255,87,34,0.5)]';
  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-valuenow={at}
      aria-valuemin={0}
      aria-valuemax={max}
      // `label` lets the caller say what is being counted. The default still says
      // "stages" because the sequence-step bar in TaskRunner really is counting
      // steps of one task, not missions of a run.
      aria-label={label ?? t.play.progressLabel({ done: at, total: max })}
    >
      {max > MAX_SEGMENTS ? (
        <div className="h-1.5 flex-1 rounded-full bg-app-raised overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${fill} ${colorblind ? 'border border-dashed border-zinc-500' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
              i < at
                ? fill
                : `bg-app-raised ${colorblind ? 'border border-dashed border-zinc-500' : ''}`
            }`}
          />
        ))
      )}
      {/* Colorblind cue: a numeric readout so progress doesn't rely on color alone. */}
      {colorblind && (
        <span className="ms-1 text-xs font-mono text-zinc-400 tabular-nums shrink-0">{at}/{max}</span>
      )}
    </div>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="min-h-screen flex flex-col px-5 pt-6 rp-safe-b max-w-md mx-auto w-full">{children}</div>;
}

// Content-shaped loading placeholder. Size via `className` (e.g. "h-4 w-24").
// Shimmer + reduced-motion handling live in index.css (.rp-skeleton).
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`rp-skeleton rounded-xl ${className}`} />;
}

// ── TagChips ──────────────────────────────────────────────────────────────────
// Creator-authored tags on a public game (change: game-task-tags). `PublicGame`
// has always carried `tags` and the promo screen never drew them.
//  • Renders NOTHING (not an empty box) for an empty/absent list.
//  • `dir="auto"` per chip — a Hebrew tag lays out RTL beside an English one.
//  • Bounded, with a "+N" from the caller's dictionary so this file holds no
//    user-facing copy.
// play-web reverses the zinc scale, so `text-zinc-400` here reads dark-on-light.
export function TagChips({ tags, max = 8, more, className = '' }: {
  tags?: string[]; max?: number; more?: (n: number) => string; className?: string;
}) {
  const list = (tags ?? []).filter((t) => typeof t === 'string' && t.trim().length > 0);
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  const hidden = list.length - shown.length;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {shown.map((tag) => (
        <span key={tag} dir="auto"
          className="inline-flex items-center max-w-full truncate rounded-full border border-glass-border bg-app-card px-2.5 py-1 text-[11px] font-medium text-zinc-400">
          {tag}
        </span>
      ))}
      {hidden > 0 && more && <span className="text-[11px] font-medium text-zinc-500">{more(hidden)}</span>}
    </div>
  );
}

// Collapsible section — the one shared shell for every expandable panel in the
// participant app (live-ops leaderboard peek, photo feed, team↔HQ chat, …). It
// unifies what were three hand-rolled headers with slightly different padding,
// tap targets and chevron glyphs into one calm, consistent rhythm:
//   • a comfortable ≥44px touch target (was ~32px — below the a11y minimum)
//   • `aria-expanded` for assistive tech
//   • a single chevron that rotates on open instead of swapping ▲/▼ glyphs
// State stays fully controlled by the caller (open/onToggle), so behaviour and
// any open-time side effects (e.g. marking chat read) are preserved exactly.
export function Collapsible({
  header, open, onToggle, children, className = '', bodyClassName = 'px-3 pb-3',
}: {
  header: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={`rounded-xl bg-app-card border border-glass-border ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-3 min-h-[44px] text-sm font-medium text-zinc-300 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/40 rounded-xl"
      >
        <span className="flex items-center gap-2 min-w-0">{header}</span>
        <span aria-hidden="true" className={`text-zinc-500 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className={bodyClassName}>{children}</div>}
    </div>
  );
}

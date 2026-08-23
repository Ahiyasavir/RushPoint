import { useEffect, useRef, useState, type ReactNode } from 'react';
import { workingMessageIndex } from '../lib/working';

// A branded "we're working, you're advancing" indicator (change:
// play-working-feedback) — a drop-in for a bare spinner during a multi-second
// wait. It rotates through 2-4 pre-translated status lines and shows a bar that
// reads as FORWARD MOTION (an indeterminate start->end sweep, or a determinate
// fill when a progress fraction is known), so the wait talks to the player in
// RushPoint's voice instead of sitting as a chasing ring.
//
// Pure presentational: the caller passes already-translated strings, so this
// imports no dictionary and stays RTL-agnostic. No store, no callable, no new
// dependency (CSS-only animation — bundle:budget stays green).
interface WorkingProps {
  messages: string[];         // 2-4 pre-translated branded lines (caller passes t.* values)
  intervalMs?: number;        // rotation cadence, default 1800
  progress?: number;          // 0..1 real progress; when given, the bar is determinate
  className?: string;
  children?: ReactNode;       // optional slot, e.g. the retry button
}

// Mirror confetti.ts's guarded reduced-motion check (SSR-safe, never throws).
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function Working({ messages, intervalMs = 1800, progress, className, children }: WorkingProps) {
  const reduced = useRef(prefersReducedMotion()).current;
  const [tick, setTick] = useState(0);

  // Rotate on a timer unless reduced-motion is set (then show messages[0] only).
  // A single/empty message set never needs a timer. Cleaned up on unmount.
  useEffect(() => {
    if (reduced || messages.length <= 1) return;
    const id = window.setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [reduced, messages.length, intervalMs]);

  const idx = workingMessageIndex(tick, messages.length);
  const current = messages[idx] ?? '';

  const determinate = typeof progress === 'number';
  const pct = determinate ? Math.max(0, Math.min(1, progress as number)) * 100 : undefined;
  // Reduced-motion or determinate ⇒ a static fill (no sweep). Determinate width
  // reflects real progress; the reduced fallback shows a modest static fill so
  // the bar still reads as "in progress", not empty.
  const staticFill = reduced && !determinate;

  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      <p
        role="status"
        aria-live="polite"
        dir="auto"
        className="text-sm text-zinc-500 transition-opacity duration-300"
      >
        {current}
      </p>
      <div
        aria-hidden="true"
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-200"
      >
        {determinate || staticFill ? (
          <span
            className="absolute start-0 top-0 bottom-0 rounded-full bg-gradient-to-r from-rp-fire to-rp-amber"
            style={{ width: `${pct ?? 35}%` }}
          />
        ) : (
          <span className="rp-working-sweep absolute top-0 bottom-0 rounded-full bg-gradient-to-r from-rp-fire to-rp-amber" />
        )}
      </div>
      {children}
    </div>
  );
}

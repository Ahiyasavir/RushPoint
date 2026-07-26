import { useEffect, useRef, useState } from 'react';
import { workingMessageIndex } from '../lib/working';

// A branded, CSS-only full-area loader (change: engaging-loaders) — a warm
// RushPoint spinner over a short cycling status line, for the multi-second waits
// where a bare chasing ring felt cold and machine-like. Pure presentational: the
// caller passes already-translated strings, so it imports no dictionary and stays
// RTL-agnostic (dir="auto" on the copy). No store, no callable, NO new dependency
// — the animation is pure CSS (Tailwind `animate-spin`/`animate-pulse`), so
// bundle:budget stays green.
//
// Accessibility: the wrapper is a role="status" live region with a STABLE sr-only
// label (the caller's first line), so a screen reader announces the wait once and
// is not spammed as the visible copy rotates every couple of seconds. The ring and
// the rotating copy are aria-hidden decoration. prefers-reduced-motion freezes both
// animations and pins the message to the first line (mirrors Working.tsx).
interface LoadingViewProps {
  messages: string[];   // 1-4 pre-translated lines (caller passes t.* values)
  intervalMs?: number;  // rotation cadence, default 2000
  className?: string;
}

// Mirror confetti.ts / Working.tsx's guarded check (SSR-safe, never throws).
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function LoadingView({ messages, intervalMs = 2000, className }: LoadingViewProps) {
  const reduced = useRef(prefersReducedMotion()).current;
  const [tick, setTick] = useState(0);

  // Rotate on a timer unless reduced-motion is set or there is a single message.
  useEffect(() => {
    if (reduced || messages.length <= 1) return;
    const id = window.setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [reduced, messages.length, intervalMs]);

  const current = messages[workingMessageIndex(tick, messages.length)] ?? '';

  return (
    <div role="status" className={`flex flex-col items-center justify-center gap-4 ${className ?? ''}`}>
      {/* Branded orbiting ring with a warm gradient core. Logical border sides
          only (border-t / border-e), so the a11y direction scan stays green. */}
      <span aria-hidden="true" className="relative inline-flex h-12 w-12 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-rp-fire/15" />
        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-rp-fire border-e-rp-amber animate-spin motion-reduce:animate-none" />
        <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-rp-fire to-rp-amber animate-pulse motion-reduce:animate-none" />
      </span>
      <p aria-hidden="true" dir="auto" className="text-sm font-medium text-zinc-500 transition-opacity duration-300">
        {current}
      </p>
      <span className="sr-only">{messages[0] ?? ''}</span>
    </div>
  );
}

export default LoadingView;

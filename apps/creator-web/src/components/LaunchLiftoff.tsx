import { useEffect, useRef, useState } from 'react';
import { liftoffStepIndex } from '../lib/launchLiftoff';

// A branded "your run is lifting off" overlay for the launchRun wait
// (change: creator-launch-liftoff) — the creator's most anxious wait used to
// have ZERO on-screen feedback. This is the creator (dark-theme) twin of
// play-web's <Working>: it rotates through 2-4 pre-translated reassurance lines
// and shows a bar that reads as FORWARD MOTION.
//
// The steps are REASSURANCE, not telemetry: `launchRun` is a single opaque
// round-trip, so the bar is honest-indeterminate (an infinite start→end sweep,
// never a fake percentage) and the copy never claims a step "finished".
//
// Pure presentational: the caller passes already-translated strings, so this
// imports no dictionary and stays RTL-agnostic (`dir="auto"`). No store, no
// callable, no new dependency (CSS-only animation).
interface LaunchLiftoffProps {
  open: boolean;
  title: string;
  messages: string[];   // 2-4 pre-translated branded lines (caller passes t.launch.* values)
  intervalMs?: number;  // rotation cadence, default 1800 (matches play-web)
}

// Mirror play-web's guarded reduced-motion check (SSR-safe, never throws).
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function LaunchLiftoff({ open, title, messages, intervalMs = 1800 }: LaunchLiftoffProps) {
  const reduced = useRef(prefersReducedMotion()).current;
  const [tick, setTick] = useState(0);

  // Rotate on a timer unless reduced-motion is set (then show messages[0] only).
  // A single/empty message set never needs a timer. Only while open. Cleaned up
  // on unmount / when the launch resolves.
  useEffect(() => {
    if (!open || reduced || messages.length <= 1) return;
    const id = window.setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [open, reduced, messages.length, intervalMs]);

  // Reset the rotation each time the overlay opens so it always starts at step 1.
  useEffect(() => {
    if (open) setTick(0);
  }, [open]);

  if (!open) return null;

  const idx = liftoffStepIndex(tick, messages.length);
  const current = messages[idx] ?? '';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[--surface-1]/80 backdrop-blur-sm p-6"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-2xl border border-[--rp-border] bg-[--surface-1] p-8 text-center shadow-soft space-y-5">
        <div className="text-4xl" aria-hidden="true">🚀</div>
        <h2 dir="auto" className="text-lg font-bold text-[--ink-1]">{title}</h2>
        <p
          dir="auto"
          className="text-sm text-[--ink-3] transition-opacity duration-300 min-h-[1.25rem]"
        >
          {current}
        </p>
        <div
          aria-hidden="true"
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-[--surface-2]"
        >
          {reduced ? (
            // Reduced motion: a modest static fill reads as "in progress" without
            // a chasing animation (mirrors <Working>).
            <span
              className="absolute start-0 top-0 bottom-0 rounded-full bg-gradient-to-r from-rp-fire to-rp-amber"
              style={{ width: '35%' }}
            />
          ) : (
            <span className="rp-liftoff-sweep" />
          )}
        </div>
      </div>
    </div>
  );
}

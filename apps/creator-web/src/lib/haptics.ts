// Lightweight haptic feedback via the Vibration API. Free, native, and a silent
// no-op where unsupported (desktop, iOS Safari) or when the user prefers reduced
// motion. Callers fire a semantic pattern; never loop these.
//
// ⚠️ A DELIBERATE COPY of apps/play-web/src/lib/haptics.ts, behaviourally matched
// — the same call the two apps' `lazyWithRetry` and `mapRtl` modules make. It
// cannot move to `packages/shared`: shared is framework-free *and* environment-
// free, and this is a browser API. Keep the two in step by hand; the file is 20
// lines and has no dependencies, which is why duplication is cheaper here than a
// new shared browser-only entry point would be.
type Pattern = 'tap' | 'success' | 'warn' | 'error';

const MAP: Record<Pattern, number | number[]> = {
  tap:     10,
  success: [12, 40, 18],
  warn:    [20, 60, 20],
  error:   [40, 30, 40, 30, 40],
};

export function haptic(p: Pattern): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate(MAP[p]);
  } catch {
    /* unsupported / blocked — silent no-op */
  }
}

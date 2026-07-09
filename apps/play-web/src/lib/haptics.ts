// Lightweight haptic feedback via the Vibration API. Free, native, and a silent
// no-op where unsupported (desktop, iOS Safari) or when the user prefers reduced
// motion. Callers fire a semantic pattern; never loop these.
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

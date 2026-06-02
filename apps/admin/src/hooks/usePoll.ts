import { useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Run `fn` once on mount and then every `intervalMs`, clearing the timer on
// unmount. Replaces the repeated `useEffect(() => { void fn(); const id =
// setInterval(...); return () => clearInterval(id); }, [fn])` boilerplate.
//
// `fn` must be stable (wrap it in useCallback) — it's part of the dependency
// list, so the timer resets whenever it changes, exactly like the hand-written
// version it replaces. Pass `enabled: false` to pause polling.
// ─────────────────────────────────────────────────────────────────────────────
export function usePoll(
  fn: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    void fn();
    const id = setInterval(() => void fn(), intervalMs);
    return () => clearInterval(id);
  }, [fn, intervalMs, enabled]);
}

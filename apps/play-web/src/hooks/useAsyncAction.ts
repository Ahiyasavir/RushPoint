// Async action guard (change: wave-b/async-action-guard).
//
// Every async handler in the app used to gate itself on a `useState` busy flag:
//
//   async function launch(g) { setBusy(true); try { await launchRun(...) } finally { setBusy(false) } }
//
// `setBusy(true)` is ASYNCHRONOUS. Two clicks dispatched inside the same React
// batch (a double tap, or a jittery tap on a phone) both observe `busy === false`
// and BOTH fire the callable — the `disabled` attribute only lands after the
// re-render. That is a real double-mutation window on launchRun, purchaseCredits,
// adjustTeamScore, joinRun, publishGame, deleteGame, …
//
// A timing debounce does not fix it either: a callable can run for 20s, so a
// second click at t=400ms would still get through. What is needed is an IN FLIGHT
// guard, held for the whole duration of the promise. That is `createAsyncGuard`.
//
// The guard is deliberately pure (no React) so it can be unit tested in the fast
// lane — see scripts/test-async-action-guard.ts, which runs the same contract
// against this file AND its play-web twin so the two can never drift.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncGuard {
  /** true while ANY key is in flight. */
  readonly busy: boolean;
  /** false after dispose() — used to suppress state writes after unmount. */
  readonly alive: boolean;
  isBusy(key?: string): boolean;
  /** Re-arm after a dispose (React StrictMode double-invokes effects). */
  mount(): void;
  /** Component unmounted: stop notifying and drop the in-flight keys. */
  dispose(): void;
  /**
   * Run `fn` unless the same `key` is already in flight, in which case `fn` is
   * NOT invoked at all and the call resolves `undefined`. Rejections propagate
   * unchanged — nothing is swallowed, so every existing try/catch and localized
   * error message keeps working.
   */
  run<T>(fn: () => T | Promise<T>, key?: string): Promise<T | undefined>;
}

export function createAsyncGuard(
  onChange?: (busy: boolean, keys: string[]) => void,
): AsyncGuard {
  const inFlight = new Set<string>();
  let alive = true;
  const notify = () => { if (alive) onChange?.(inFlight.size > 0, [...inFlight]); };

  return {
    get busy() { return inFlight.size > 0; },
    get alive() { return alive; },
    isBusy(key = '') { return inFlight.has(key); },
    mount() { alive = true; },
    dispose() { alive = false; inFlight.clear(); },
    async run<T>(fn: () => T | Promise<T>, key = ''): Promise<T | undefined> {
      if (inFlight.has(key)) return undefined; // re-entrant click — ignore it
      inFlight.add(key);
      notify();
      try {
        return await fn();
      } finally {
        // Always released, on resolve AND on reject, so the button re-arms.
        inFlight.delete(key);
        notify();
      }
    },
  };
}

export interface AsyncAction<A extends unknown[], R> {
  /** Fires `fn` unless it is already in flight for this key. */
  run: (...args: A) => Promise<R | undefined>;
  /** Pass to <Button loading={busy}> / disabled. */
  busy: boolean;
  /** Per-key variant, for lists that keep a per-row spinner. */
  isBusy: (key?: string) => boolean;
  busyKeys: string[];
  /** Last rejection (also re-thrown by `run`). */
  error: unknown;
}

/**
 * `keyOf` makes the action single-flight PER KEY instead of globally, so a list
 * (teams, zones, trackables, credit packages) keeps today's behaviour where a
 * different row can act while another row's call is in flight.
 */
export function useAsyncAction<A extends unknown[], R>(
  fn: (...args: A) => R | Promise<R>,
  keyOf?: (...args: A) => string,
): AsyncAction<A, R> {
  const [state, setState] = useState<{ busy: boolean; keys: string[] }>({ busy: false, keys: [] });
  const [error, setError] = useState<unknown>(null);

  // Refs so `run` is referentially stable while the closures stay fresh.
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;

  const guardRef = useRef<AsyncGuard | null>(null);
  if (!guardRef.current) {
    guardRef.current = createAsyncGuard((busy, keys) => setState({ busy, keys }));
  }
  const guard: AsyncGuard = guardRef.current;

  useEffect(() => {
    guard.mount();
    return () => guard.dispose();
  }, [guard]);

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    try {
      const result = await guard.run(() => fnRef.current(...args), keyRef.current?.(...args));
      if (guard.alive) setError((prev: unknown) => (prev === null ? prev : null));
      return result;
    } catch (e) {
      if (guard.alive) setError(e);
      throw e;
    }
  }, [guard]);

  const isBusy = useCallback((key = '') => state.keys.includes(key), [state.keys]);

  return { run, busy: state.busy, isBusy, busyKeys: state.keys, error };
}

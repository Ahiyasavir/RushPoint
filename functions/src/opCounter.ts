// Firestore operation counting, attributed to the callable that caused it
// (change: spark-tier-location-load).
//
// The ARITHMETIC lives in the pure `firestoreOpBudget` module in @rushpoint/shared. This
// file owns only two things: WHERE the tally is kept, and HOW an operation is attributed
// to a callable.
//
// WHY AsyncLocalStorage AND NOT A MODULE-LEVEL "current callable" VARIABLE: the Firestore
// proxy in docCache.ts is a process global, so the callable name has to reach it somehow.
// A mutable global reads correctly in a single-threaded test and is silently WRONG the
// moment two callables interleave across an await — B's assignment clobbers A's, and every
// operation A performs after its next await is charged to B. Concurrency is the only
// condition under which these numbers are worth having (a live run is ~120 phones calling
// at once), so the one case a global gets wrong is the only case that matters. ALS
// propagates through await boundaries by construction.
//
// WHY IT IS OFF BY DEFAULT: this is instrumentation on the hottest path in the backend.
// Enabled only by RUSHPOINT_FS_OPCOUNT=1, and when disabled it retains no per-operation
// state and does no work beyond one boolean check.
//
// ⚠️ A DEFECT HERE MUST NEVER FAIL A FIRESTORE CALL. A measurement tool that can take down
// a live game is worse than having no measurement at all, so `count()` swallows everything.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createOpTally, type OpCounts, type OpKind, type OpTallies } from '@rushpoint/shared';

/** The env var that turns counting on. Anything other than '1' leaves it off. */
export const OP_COUNT_ENV = 'RUSHPOINT_FS_OPCOUNT';

/** What rides the async context: which callable, and what IT alone has spent so far. */
interface InvocationContext {
  callable: string;
  counts: OpCounts;
}

export interface OpCounter {
  /** Whether this counter records anything at all. */
  readonly enabled: boolean;
  /** Run `fn` with `callable` as the attribution context. */
  run<T>(callable: string, fn: () => Promise<T>): Promise<T>;
  /** Charge `n` ops of `kind` to whatever callable is currently in context. */
  count(kind: OpKind, n?: number): void;
  /** The callable currently in context, if any. */
  current(): string | undefined;
  /**
   * Reads and writes charged so far within the CURRENT invocation, or undefined outside
   * one. This is the figure worth logging — see the note on multi-process runtimes below.
   */
  invocationCounts(): OpCounts | undefined;
  snapshot(): OpTallies;
  reset(): void;
}

/**
 * Build an isolated counter. `enabled` is injected so the pure suite can drive both states
 * without touching process.env; `sink` is injected so the suite can prove a throwing
 * recorder cannot escape.
 */
export function createOpCounter(opts: {
  enabled?: boolean;
  sink?: (callable: string | undefined, kind: OpKind, n: number) => void;
} = {}): OpCounter {
  const enabled = opts.enabled ?? process.env[OP_COUNT_ENV] === '1';
  const tally = createOpTally();
  const store = new AsyncLocalStorage<InvocationContext>();
  const sink = opts.sink ?? ((callable, kind, n) => tally.record(callable, kind, n));

  return {
    enabled,

    run<T>(callable: string, fn: () => Promise<T>): Promise<T> {
      // When disabled, do not even enter a context — the wrapped work must run exactly as
      // it does today, returning the same value and propagating the same error.
      if (!enabled) return fn();
      // A FRESH counts object per invocation. Concurrent invocations each get their own,
      // so their per-invocation figures can never pool.
      return store.run({ callable, counts: { reads: 0, writes: 0 } }, fn);
    },

    count(kind, n = 1) {
      if (!enabled) return;
      try {
        const ctx = store.getStore();
        if (ctx) {
          if (kind === 'read') ctx.counts.reads += n;
          else ctx.counts.writes += n;
        }
        sink(ctx?.callable, kind, n);
      } catch {
        // Deliberately swallowed — see the header. The operation being measured has
        // already happened or is about to; losing a count is the correct trade against
        // failing a live request.
      }
    },

    current() {
      return enabled ? store.getStore()?.callable : undefined;
    },

    invocationCounts() {
      if (!enabled) return undefined;
      const ctx = store.getStore();
      // A copy: a caller holding this must not be able to mutate the live counters.
      return ctx ? { reads: ctx.counts.reads, writes: ctx.counts.writes } : undefined;
    },

    snapshot() {
      return tally.snapshot();
    },

    reset() {
      tally.reset();
    },
  };
}

/** The process-wide counter. One per API process, matching the rate limiter and doc cache. */
export const opCounter = createOpCounter();

/**
 * Charge one Firestore operation to the callable in context. The single entry point used
 * by the interception layer in docCache.ts — kept as a free function so call sites there
 * stay one short, obviously-safe line.
 */
export function countFirestoreOp(kind: OpKind, n = 1): void {
  opCounter.count(kind, n);
}

/** Run `fn` attributed to `callable`. Used by `loggedCallable`, once, for all callables. */
export function withCallableAttribution<T>(callable: string, fn: () => Promise<T>): Promise<T> {
  return opCounter.run(callable, fn);
}

/**
 * The current invocation's own Firestore cost, or undefined when counting is off.
 *
 * WHY PER-INVOCATION AND NOT JUST THE PROCESS TALLY: the Firebase Functions emulator runs
 * callables through a RuntimeWorkerPool — SEVERAL Node processes. Work done by one worker
 * never reaches another worker's tally, and a "give me the totals" callable would answer
 * from whichever worker happened to serve it. Real Cloud Functions is worse still, scaling
 * to many instances. Emitting each invocation's OWN cost into the structured log makes the
 * measurement independent of how many processes exist: aggregation happens offline, from
 * the logs. It also works unchanged on the single-process VPS.
 */
export function invocationFirestoreCost(): OpCounts | undefined {
  return opCounter.invocationCounts();
}

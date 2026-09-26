// Upload resiliency primitives — pure, DOM-free and Firebase-free on purpose so
// the retry/backoff/timeout policy behind uploadTaskPhoto / uploadTaskAudio (and
// now callable() too) is unit-testable without touching real Storage.
// See docs/wave-a/upload-resiliency.md.
//
// Why this exists: the photo upload used a bare `uploadBytes` — one non-resumable
// PUT, no timeout, no retry — while the callable right after it already retried.
// A single blip on mobile data therefore surfaced as "לא הצלחנו לשמור את התמונה".

// ── Transient error classification ──────────────────────────────────────────
// Same shape as RETRYABLE_CALLABLE_CODES in services/firebase.ts: only codes that
// are safe to re-issue. An upload is idempotent (same path ⇒ overwrite), so any
// genuinely transient transport failure may be retried. Codes that mean "the
// server understood you and said no" (unauthorized, quota-exceeded, …) must NOT
// be retried — spinning on them only makes the player wait longer for the same
// failure. 'storage/deadline-exceeded' is OUR synthetic code for a stalled task.
export const RETRYABLE_STORAGE_CODES = new Set([
  'storage/retry-limit-exceeded',
  'storage/unknown',
  'storage/server-file-wrong-size',
  'storage/canceled',
  'storage/internal-error',
  'storage/deadline-exceeded',
]);

export function errorCode(e: unknown): string {
  return typeof e === 'object' && e !== null ? String((e as { code?: unknown }).code ?? '') : '';
}

export function isRetryableStorageError(e: unknown): boolean {
  return RETRYABLE_STORAGE_CODES.has(errorCode(e));
}

// ── Backoff ─────────────────────────────────────────────────────────────────
// The curve the callable wrapper has always used: 150·(attempt+1) + jitter·250.
// Extracted so both lanes share one implementation (and so it is testable with a
// deterministic `rand`).
export function jitteredBackoffMs(attempt: number, rand: number = Math.random()): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const j = Number.isFinite(rand) ? Math.min(1, Math.max(0, rand)) : 0;
  return 150 * (n + 1) + j * 250;
}

// ── Bounded retry ───────────────────────────────────────────────────────────
export interface RetryOptions {
  attempts: number;
  isRetryable: (e: unknown) => boolean;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  /** Called before each retry (attempt index of the FAILED attempt). */
  onRetry?: (attempt: number, err: unknown) => void;
}

export async function runWithRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const attempts = Math.max(1, Math.floor(opts.attempts) || 1);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rand = opts.rand ?? Math.random;
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const isLast = attempt === attempts - 1;
      if (isLast || !opts.isRetryable(e)) throw e;
      opts.onRetry?.(attempt, e);
      await sleep(jitteredBackoffMs(attempt, rand()));
    }
  }
  throw lastErr;
}

// ── Per-attempt budget (change: media-upload-reliability, D2) ───────────────
// The absolute cap on ONE attempt used to be a flat 180 s, which killed a healthy 12 MB clip on a
// 3G link while it was still moving, then re-sent the whole thing (five copies of one clip in
// 50 s in the 2026-09-25 logs). The no-progress stall detector is the real "dead" signal; this cap
// only has to be generous enough that a slow-but-moving upload finishes: size at a ~100 kbps
// floor plus a minute, never under the old 180 s, never over 15 minutes.
const ATTEMPT_BUDGET_FLOOR_MS = 180_000;
const ATTEMPT_BUDGET_SLACK_MS = 60_000;
const FLOOR_BYTES_PER_SECOND = 12_288;
export const ATTEMPT_BUDGET_CAP_MS = 15 * 60_000;

export function attemptBudgetMs(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return ATTEMPT_BUDGET_FLOOR_MS;
  const derived = Math.round((bytes / FLOOR_BYTES_PER_SECOND) * 1000) + ATTEMPT_BUDGET_SLACK_MS;
  return Math.min(ATTEMPT_BUDGET_CAP_MS, Math.max(ATTEMPT_BUDGET_FLOOR_MS, derived));
}

// ── A backoff the player can cut short (change: media-upload-reliability, D6) ─
// iOS suspends network work in a backgrounded tab, so a transfer "stalls" while the player
// checks WhatsApp. When they come back, the retry should go now rather than after the rest of a
// backoff that was sized for a flaky link. `subscribe` registers the wake signal and returns its
// own unsubscribe; the sleep ends on whichever comes first.
export function interruptibleSleep(ms: number, subscribe: (wake: () => void) => () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    let unsubscribe: () => void = () => {};
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { unsubscribe(); } catch { /* best effort */ }
      resolve();
    };
    const timer = setTimeout(finish, ms);
    try { unsubscribe = subscribe(finish); } catch { /* no wake signal: a plain sleep */ }
    if (done) { try { unsubscribe(); } catch { /* best effort */ } }
  });
}

// ── Timeout race ────────────────────────────────────────────────────────────
// Rejects with a coded error (so the caller can classify it as retryable) and
// invokes `onTimeout` exactly once so a resumable upload task can be cancelled
// instead of leaking in the background.
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  code: string,
  onTimeout?: () => void,
): Promise<T> {
  // If the timeout wins, the original promise may still settle (e.g. the cancelled
  // upload task rejects a moment later). Swallow that late rejection here so it
  // never surfaces as an unhandled promise rejection.
  promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* cancel is best-effort */ }
      reject(Object.assign(new Error(`timed out after ${ms}ms`), { code }));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); }) as Promise<T>;
}

// ── Progress ────────────────────────────────────────────────────────────────
export function uploadPercent(transferred: number, total: number): number {
  if (!Number.isFinite(transferred) || !Number.isFinite(total) || total <= 0) return 0;
  const pct = Math.round((transferred / total) * 100);
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

/**
 * A one-slot pub/sub for the in-flight upload's progress. The upload happens in
 * services/firebase.ts while the UI that must show it (PhotoEntry) is several
 * components away from that call, so a tiny store beats threading a callback
 * through TaskRunner. `null` = no upload in flight.
 */
export type UploadProgress = number | null;
type Listener = (v: UploadProgress) => void;

const listeners = new Set<Listener>();
let current: UploadProgress = null;

export function setUploadProgress(v: UploadProgress): void {
  current = v;
  for (const l of Array.from(listeners)) {
    try { l(v); } catch { /* a broken subscriber must not break the upload */ }
  }
}

export function getUploadProgress(): UploadProgress {
  return current;
}

export function subscribeUploadProgress(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Set while an upload is between attempts, so the UI can say "retrying" instead
// of freezing at the percentage the failed attempt reached.
let retrying = false;
const retryListeners = new Set<(v: boolean) => void>();

export function setUploadRetrying(v: boolean): void {
  retrying = v;
  for (const l of Array.from(retryListeners)) {
    try { l(v); } catch { /* ignore */ }
  }
}
export function getUploadRetrying(): boolean { return retrying; }
export function subscribeUploadRetrying(fn: (v: boolean) => void): () => void {
  retryListeners.add(fn);
  return () => { retryListeners.delete(fn); };
}

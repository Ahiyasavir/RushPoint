// One pure mapping from "a callable rejected" to "something a creator can read
// and act on" (change: creator-no-silent-failures).
//
// Before this existed, each handler in the creator console made its own decision
// about what to show, and seven of them decided on nothing: an empty catch, a
// `.catch(() => undefined)`, or a `finally` with no `catch` at all. The worst was
// the Builder's autosave — the ONLY write path for game content — which reported
// a failed save with the SAME amber "unsaved" dot it shows during an ordinary
// debounce. A creator lost an evening and found out at the event.
//
// Two properties are load-bearing, and `__tests__/callFeedback.test.ts` holds
// both:
//
//   TOTAL      — a callable can reject with anything: a FirebaseError, a bare
//                TypeError from a dropped connection, a thrown string, or
//                nothing. Every input yields a key. This function cannot throw.
//   CODE-ONLY  — only `code` is read, never `message`. Server messages are
//                English, server-authored and unstable; rendering one at a
//                Hebrew-first console is how a raw string reaches a creator.
//                The original error goes to `console.error` at the call site.
//
// Copy lives in `t.callFailure[key]` in BOTH dictionaries; the test asserts each
// key resolves to real, language-correct, code-free copy, so a key added later
// without copy goes red instead of rendering `undefined` at a live event.

export const CALL_FAILURE_KEYS = [
  'offline',
  'notAllowed',
  'rateLimited',
  'rejected',
  'generic',
] as const;

export type CallFailureKey = (typeof CALL_FAILURE_KEYS)[number];

export interface CallFailure {
  /** Index into `t.callFailure` — the only thing ever shown to a creator. */
  key: CallFailureKey;
  /** `error` = the creator must act; `warning` = the environment, not them. */
  severity: 'error' | 'warning';
  /**
   * Whether repeating the SAME action could plausibly succeed. False for a
   * refusal (permission, session, precondition): the Builder's Retry button
   * hangs off this, and offering "try again" on a signed-out session only hides
   * the real fix.
   */
  retryable: boolean;
}

const OUTCOME: Record<CallFailureKey, CallFailure> = {
  offline:     { key: 'offline',     severity: 'warning', retryable: true },
  rateLimited: { key: 'rateLimited', severity: 'warning', retryable: true },
  notAllowed:  { key: 'notAllowed',  severity: 'error',   retryable: false },
  rejected:    { key: 'rejected',    severity: 'error',   retryable: false },
  generic:     { key: 'generic',     severity: 'error',   retryable: true },
};

/** Firebase code with the `functions/` namespace stripped; '' when there is none. */
function bareCode(e: unknown): string {
  if (!e || typeof e !== 'object') return '';
  const raw = (e as { code?: unknown }).code;
  if (typeof raw !== 'string') return '';
  return raw.replace(/^functions\//, '');
}

const BY_CODE: Record<string, CallFailureKey> = {
  // Refused on its merits — the creator (or the game state) must change first.
  'permission-denied':   'notAllowed',
  'unauthenticated':     'notAllowed',
  'failed-precondition': 'rejected',
  'invalid-argument':    'rejected',
  'not-found':           'rejected',
  'already-exists':      'rejected',
  'out-of-range':        'rejected',
  // The backend was not reachable, or gave up. The work is still on screen.
  'unavailable':         'offline',
  'deadline-exceeded':   'offline',
  'internal':            'offline',
  'aborted':             'offline',
  'cancelled':           'offline',
  // Slow down and try again.
  'resource-exhausted':  'rateLimited',
};

/**
 * Classify an arbitrary thrown value.
 *
 * `opts.online` is the DEVICE's own connectivity flag (call sites pass
 * `navigator.onLine`). A connection that dies before the callable is reached
 * rejects with a bare `TypeError` carrying no code, and its message is
 * browser- and locale-dependent — so the flag, not the text, is what upgrades
 * that case from `generic` to `offline`. It can only ever upgrade: a recognised
 * code always decides on its own.
 */
export function describeCallFailure(e: unknown, opts?: { online?: boolean }): CallFailure {
  const mapped = BY_CODE[bareCode(e)];
  if (mapped) return OUTCOME[mapped];
  if (opts?.online === false) return OUTCOME.offline;
  return OUTCOME.generic;
}

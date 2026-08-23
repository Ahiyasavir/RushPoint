// The participant join path's two pure decisions (change: join-flow-resilience).
//
// Joining happens in the worst conditions the product has: a whole group at once,
// outdoors, on cellular, at the start of an event, with the host watching. Both
// decisions below used to live inline in JoinScreen.tsx, which is why neither was
// tested and why both leaked implementation detail to the participant. They are
// pure and DOM-free — unit-tested by scripts/test-join-code.ts, no emulator.
//
// NOTHING here decides eligibility. The server stays the only authority on
// whether a code resolves and whether the run behind it can be joined; this file
// only cleans up what we send and translates what we get back.

/**
 * Upper bound on a canonical access code. Generated codes are 6 characters
 * (`generateCode` in functions/src/runs/index.ts); the headroom covers
 * hand-authored seed/demo codes without letting a pasted essay reach a callable.
 *
 * The cap lives HERE and not on the input element: `maxLength` made the browser
 * truncate a pasted join link before onChange could read it, so pasting
 * `https://…/?code=ABC123` produced `HTTPS://` and then "invalid code".
 */
export const MAX_JOIN_CODE_LEN = 12;

/** The code carried by a join link, wherever it sits in the pasted string. */
const CODE_PARAM_RE = /code=([A-Za-z0-9]+)/i;

/**
 * Canonicalize whatever the participant typed, pasted, or arrived with in a deep
 * link. Total: any input, including a non-string, yields a string.
 *
 * Tolerates everything a phone and a group chat do to a code — case, surrounding
 * whitespace, an internal space, a dash (the repo's no-dashes convention means a
 * dash in a code is always noise), punctuation, and the bidi/format characters an
 * RTL paste carries (they fall out with every other non-alphanumeric).
 *
 * It deliberately does NOT substitute look-alike characters. The access-code
 * alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) already excludes I, O, 0 and 1
 * exactly so codes cannot be misread, which means a typed `O` has no valid
 * character to be rewritten into: any substitution table would silently submit a
 * DIFFERENT code than the participant entered. An honest failure beats that.
 */
export function normalizeJoinCodeInput(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.trim();

  // A pasted join link: the code is the `code` parameter, never the URL.
  const param = CODE_PARAM_RE.exec(s);
  if (param) {
    s = param[1];
  } else if (s.includes('://')) {
    // A link with no code parameter must not contribute its scheme and host
    // letters ("HTTPSPLAYEXAMPLE…"); keep only the last path/segment.
    s = s.slice(s.lastIndexOf('/') + 1);
  }

  return s.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, MAX_JOIN_CODE_LEN);
}

/**
 * The message the participant should read, as a key into `t.join.*`. A key, not a
 * sentence, so the copy stays in i18n.ts and this mapping stays testable.
 */
export type JoinErrorKey =
  | 'invalidCode'   // no such code, or one the validator refused
  | 'revoked'       // the code exists but is no longer active
  | 'finished'      // the run is over
  | 'full'          // the run hit its participant / device ceiling
  | 'connection'    // transport, cold start, or anonymous sign-in not settled
  | 'unknown';      // anything else — never a raw server sentence

/** Codes that mean "transient / connectivity", not "your code is wrong". */
const CONNECTION_CODES = new Set([
  'unavailable', 'internal', 'deadline-exceeded', 'unauthenticated', 'aborted', 'cancelled',
]);

/**
 * Map a callable rejection to a message key. Total: an unrecognized code, an
 * Error with no code, a bare string, null and undefined all yield a key.
 *
 * `unauthenticated` is connection on purpose: on the join screen it means
 * anonymous sign-in has not landed yet, which the participant fixes by waiting
 * or retrying, not by re-reading the code.
 */
export function joinErrorKey(e: unknown): JoinErrorKey {
  const raw = e && typeof e === 'object' && 'code' in e
    ? (e as { code?: unknown }).code
    : undefined;
  // The Firebase JS SDK reports `functions/not-found`; the emulator sometimes
  // reports the bare code.
  const code = (typeof raw === 'string' ? raw : '').replace(/^functions\//, '');

  if (code === 'not-found' || code === 'invalid-argument') return 'invalidCode';
  if (code === 'permission-denied') return 'revoked';
  if (code === 'failed-precondition') return 'finished';
  if (code === 'resource-exhausted') return 'full';
  if (CONNECTION_CODES.has(code)) return 'connection';
  return 'unknown';
}

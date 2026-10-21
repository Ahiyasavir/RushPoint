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
import { isStaffIdentityRefusal } from '@rushpoint/shared';

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
// The Israeli keyboard: each Hebrew letter (and the two punctuation keys) is the Latin key it sits on.
// An iPhone cannot be forced onto an English keyboard, and a child whose keyboard is in Hebrew types
// "EH3L25" as "קי3ך25". The field used to drop every Hebrew letter as it was typed (21.10).
const HEBREW_KEYBOARD: Record<string, string> = {
  '/': 'Q', "'": 'W', 'ק': 'E', 'ר': 'R', 'א': 'T', 'ט': 'Y', 'ו': 'U', 'ן': 'I', 'ם': 'O', 'פ': 'P',
  'ש': 'A', 'ד': 'S', 'ג': 'D', 'כ': 'F', 'ע': 'G', 'י': 'H', 'ח': 'J', 'ל': 'K', 'ך': 'L',
  'ז': 'Z', 'ס': 'X', 'ב': 'C', 'ה': 'V', 'נ': 'B', 'מ': 'N', 'צ': 'M',
};

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
  } else if (!/\s/.test(s)) {
    // Something typed as a code (no spaces): read a Hebrew-keyboard letter as its key. A pasted
    // sentence ("הקוד שלכם: EH3L25") has spaces and keeps the old reading, so its words never
    // become letters of the code.
    s = [...s].map((ch) => HEBREW_KEYBOARD[ch] ?? ch).join('');
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
  | 'staffSession'  // this browser is signed in as staff (issue #16): offer to switch to a player
  | 'full'          // the run hit its participant / device ceiling
  | 'connection'    // transport or cold start: the network, not the phone's identity
  | 'signIn'        // the phone lost its sign-in and automatic recovery failed: reload, not "check reception"
  | 'slowDown'      // the server's rate limit: wait a moment (never "the race is full")
  | 'networkBusy'   // Firebase's per-network sign-up limit: switch to mobile data or tell the host
  | 'unknown';      // anything else — never a raw server sentence

/** Codes that mean "transient / connectivity", not "your code is wrong". */
const CONNECTION_CODES = new Set([
  'unavailable', 'internal', 'deadline-exceeded', 'aborted', 'cancelled',
]);

/**
 * Map a callable rejection to a message key. Total: an unrecognized code, an
 * Error with no code, a bare string, null and undefined all yield a key.
 *
 * `unauthenticated` is NOT connection (change: self-healing-entry). It used to be, on the theory that
 * anonymous sign-in "had not landed yet". At המירוץ לציון (14.10) it meant the iPhone had LOST its
 * user: every retry on that page went out with no token, and "check your reception" sent children to
 * tap the same dead page dozens of times. The call wrapper now recovers the sign-in first; reaching
 * this key means recovery failed, and the only action that works is a reload.
 */
export function joinErrorKey(e: unknown): JoinErrorKey {
  const raw = e && typeof e === 'object' && 'code' in e
    ? (e as { code?: unknown }).code
    : undefined;
  // The Firebase JS SDK reports `functions/not-found`; the emulator sometimes
  // reports the bare code.
  const full = typeof raw === 'string' ? raw : '';
  // Anonymous sign-in failing reaches here as a Firebase AUTH code (21.10). The phone never got as
  // far as the server, so "the join did not go through" says nothing the player can act on.
  if (full === 'auth/too-many-requests') return 'networkBusy';
  if (full === 'auth/network-request-failed' || full === 'auth/internal-error' || full === 'auth/timeout') return 'connection';
  const code = full.replace(/^functions\//, '');

  if (code === 'not-found' || code === 'invalid-argument') return 'invalidCode';
  if (code === 'permission-denied') return 'revoked';
  // Before 'finished': the staff-identity refusal is also failed-precondition, and reading it as
  // "this race has already finished" would send a host to look for a newer code that does not exist.
  if (isStaffIdentityRefusal(e)) return 'staffSession';
  if (code === 'failed-precondition') return 'finished';
  // The rate limit shares `resource-exhausted` with the real capacity refusals; the server marks it.
  // Read as "full", ten failed taps in a minute told the organizer to open more spots (21.10).
  if (code === 'resource-exhausted' && isRateLimited(e)) return 'slowDown';
  if (code === 'resource-exhausted') return 'full';
  if (code === 'unauthenticated') return 'signIn';
  if (CONNECTION_CODES.has(code)) return 'connection';
  return 'unknown';
}

/** The server's rate-limit refusal carries `details.reason === 'rateLimited'` (rateLimitStore.ts). */
export function isRateLimited(e: unknown): boolean {
  const d = e && typeof e === 'object' && 'details' in e ? (e as { details?: unknown }).details : undefined;
  return !!d && typeof d === 'object' && (d as { reason?: unknown }).reason === 'rateLimited';
}

// The staff code (change: staff-code-from-join-code).
//
// A staff code is the run's join code with two characters planted at random places inside it:
// `63MZWC` → `6K3MZW7C`. It addresses its own run, so a marshal signs in with a name and this
// code and nothing else (the screen used to ask for an owner id, a game id and a run id).
//
// Why two and not one (Ahiya, 2026-10-05): the join code is not a secret, every player has it.
// One planted character gives about 250 codes per join code, few enough for a player to try
// within an event; two give more than 20,000 (scripts/test-staff-code.ts measures it), which the
// per-run lockout in staffSignIn puts out of reach.
//
// Pure: the random source is injected, so the functions side passes crypto's randomInt.

/** The join-code alphabet: no 0/O, 1/I, so nothing is confusable when read off paper. */
export const STAFF_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** How many characters are planted into the join code. */
export const STAFF_CODE_PLANTED = 2;
/** Length of a join code, and so of what is left after removing the planted characters. */
const JOIN_CODE_LEN = 6;
/** Longest input normalizeStaffCode accepts before folding spaces and dashes. */
const MAX_TYPED_LEN = 24;

/**
 * Plant STAFF_CODE_PLANTED characters into `joinCode` at random positions.
 * `pick(n)` must return an integer in [0, n).
 */
export function makeStaffCode(joinCode: string, pick: (n: number) => number): string {
  let code = joinCode;
  for (let i = 0; i < STAFF_CODE_PLANTED; i++) {
    const at = pick(code.length + 1);
    const ch = STAFF_CODE_ALPHABET[pick(STAFF_CODE_ALPHABET.length)];
    code = code.slice(0, at) + ch + code.slice(at);
  }
  return code;
}

/**
 * Every join code this staff code could have been made from: each distinct way of removing
 * STAFF_CODE_PLANTED characters (at most 28 for an 8-character code). Empty when the length is
 * not a planted join code, which includes every legacy 6-digit code.
 */
export function candidateJoinCodes(staffCode: string): string[] {
  if (staffCode.length !== JOIN_CODE_LEN + STAFF_CODE_PLANTED) return [];
  const out = new Set<string>();
  for (let i = 0; i < staffCode.length; i++) {
    for (let j = i + 1; j < staffCode.length; j++) {
      out.add(staffCode.slice(0, i) + staffCode.slice(i + 1, j) + staffCode.slice(j + 1));
    }
  }
  return [...out];
}

/**
 * What a person typed, as a code: upper case, spaces and dashes removed. Null for anything that
 * is not letters and digits (it would otherwise reach a Firestore path), or absurdly long.
 */
export function normalizeStaffCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_TYPED_LEN) return null;
  const code = raw.replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z0-9]+$/.test(code) ? code : null;
}

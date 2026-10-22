// The taste profile's codec and its one reading (change: composer-v2-taste).
//
// The founder asked for a profile "כמה שיותר מתומצת ובכל זאת יתן הרבה מאוד מידע". So it stores no
// history at all, only ONE signed value per tag, -7 ("keeps swapping these away") to +7 ("keeps
// these"), in a fixed tag order. Each value is a 4-bit nibble, two per byte, base64url, behind a
// version prefix: `t1:` and ~19 characters for the whole profile. A new tag means a new version, and
// an unknown version decodes to an empty profile rather than a misread one.
//
// Split from lib/tasteProfile.ts so the composer can read taste without importing regenerate (which
// imports the composer). Depends on the tag registry only. Pure and total.
import { ACTIVITY_TAG_IDS, MECHANIC_TAG_IDS, type BankTagId } from '../bankTags';

/** The tags taste is kept for: what players DO and how it plays. Order is the encoding. */
export const TASTE_TAG_IDS: readonly BankTagId[] = [...ACTIVITY_TAG_IDS, ...MECHANIC_TAG_IDS];
export const TASTE_VERSION = 't1';
export const TASTE_MAX = 7;
/** One signal moves a tag this far. */
export const TASTE_STEP = 2;
/** Every signal first shrinks the whole profile by this factor (toward zero), so old taste fades. */
export const TASTE_DECAY = 0.9;
/** The composer and regenerate add at most this much for a fully liked mission (and subtract for a disliked one). */
export const TASTE_WEIGHT = 0.08;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function emptyTaste(): number[] {
  return TASTE_TAG_IDS.map(() => 0);
}

function clampValue(v: number): number {
  return Math.max(-TASTE_MAX, Math.min(TASTE_MAX, Math.trunc(v)));
}

export function encodeTaste(values: readonly number[]): string {
  const nibbles = TASTE_TAG_IDS.map((_, i) => clampValue(Number(values?.[i]) || 0) + 8);
  const bytes: number[] = [];
  for (let i = 0; i < nibbles.length; i += 2) bytes.push((nibbles[i] << 4) | (nibbles[i + 1] ?? 8));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 1 >= bytes.length ? 2 : i + 2 >= bytes.length ? 3 : 4;
    for (let c = 0; c < chars; c++) out += B64[(n >> (18 - 6 * c)) & 63];
  }
  return `${TASTE_VERSION}:${out}`;
}

export function decodeTaste(encoded: unknown): number[] {
  const empty = emptyTaste();
  if (typeof encoded !== 'string' || !encoded.startsWith(`${TASTE_VERSION}:`)) return empty;
  const body = encoded.slice(TASTE_VERSION.length + 1);
  if (!/^[A-Za-z0-9_-]*$/.test(body)) return empty;
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i += 4) {
    const chunk = body.slice(i, i + 4);
    let n = 0;
    for (let c = 0; c < 4; c++) n = (n << 6) | (c < chunk.length ? B64.indexOf(chunk[c]) : 0);
    const count = chunk.length - 1;
    for (let b = 0; b < count; b++) bytes.push((n >> (16 - 8 * b)) & 255);
  }
  if (bytes.length * 2 < TASTE_TAG_IDS.length) return empty;
  const values = TASTE_TAG_IDS.map((_, i) => {
    const byte = bytes[i >> 1];
    const nib = i % 2 === 0 ? byte >> 4 : byte & 15;
    return nib === 0 ? 0 : nib - 8;
  });
  return values.every((x) => x >= -TASTE_MAX && x <= TASTE_MAX) ? values : empty;
}

/**
 * One signal: +1 "this kind stayed in a launched game", -1 "this kind was swapped away". The whole
 * profile decays first, then every vocabulary tag the mission carries moves by TASTE_STEP.
 */
export function recordTaste(encoded: unknown, tags: readonly string[], signal: 1 | -1): string {
  const known = new Set((Array.isArray(tags) ? tags : []).filter((t) => TASTE_TAG_IDS.includes(t as BankTagId)));
  if (known.size === 0) return encodeTaste(decodeTaste(encoded));
  const values = decodeTaste(encoded).map((v, i) => {
    const decayed = Math.trunc(v * TASTE_DECAY);
    return known.has(TASTE_TAG_IDS[i]) ? clampValue(decayed + signal * TASTE_STEP) : decayed;
  });
  return encodeTaste(values);
}

/**
 * Many missions at once (a launch keeps the whole game): ONE decay, then each tag carried by any of
 * them moves one step. Recording them one by one would decay the profile once per mission and erase
 * everything learned before the launch.
 */
export function recordTasteMany(encoded: unknown, tagLists: readonly (readonly string[])[], signal: 1 | -1): string {
  const all = (Array.isArray(tagLists) ? tagLists : []).flatMap((t) => (Array.isArray(t) ? t : []));
  if (!all.some((t) => TASTE_TAG_IDS.includes(t as BankTagId))) return encodeTaste(decodeTaste(encoded));
  return recordTaste(encoded, all, signal);
}

/** How much this creator likes missions with these tags, in [-1, 1]. 0 for no signal. */
export function tasteAffinity(taste: unknown, tags: readonly string[]): number {
  const values = Array.isArray(taste) ? taste as number[] : decodeTaste(taste);
  const idx = [...new Set(Array.isArray(tags) ? tags : [])]
    .map((t) => TASTE_TAG_IDS.indexOf(t as BankTagId)).filter((i) => i >= 0);
  if (idx.length === 0) return 0;
  const sum = idx.reduce((a, i) => a + (Number(values[i]) || 0), 0);
  return Math.max(-1, Math.min(1, sum / (idx.length * TASTE_MAX)));
}

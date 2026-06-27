// ═══════════════════════════════════════════════════════════════════════════════
// Pure, dependency-free payload validation for callable entry points.
//
// Every rejection is BILINGUAL by construction (EN + HE) and carries a machine-
// readable `field` + `constraint`, so the server can hand the client a typed error
// that says exactly which field was invalid and what the valid bounds are — never a
// raw stack trace. Pure (no Firebase) → unit-testable with a plain tsx script.
//
// Used to harden the smart-station callables (submitStationCode, getStationTeams,
// stationReleaseTeam, stationCallHelp): strings are bounded, numbers must be finite
// and non-negative, enums must match, and coordinate pairs must be valid GeoPoints
// — all checked BEFORE any Firestore read, transaction, or haversine math.
// ═══════════════════════════════════════════════════════════════════════════════

import { isValidCoord } from './geo';

/** Size caps that defend against oversized-string / payload-bloat submissions. */
export const MAX_ID_LEN = 200;
export const MAX_CODE_LEN = 64;
export const MAX_NOTE_LEN = 500;
export const MAX_MESSAGE_LEN = 500;

/** The typed, bilingual shape of a single validation failure. */
export interface ValidationErrorDetail {
  field: string;
  constraint: string;
  message: string; // English
  messageHe: string; // Hebrew
}

export class ValidationError extends Error {
  readonly field: string;
  readonly constraint: string;
  readonly messageHe: string;

  constructor(detail: ValidationErrorDetail) {
    super(detail.message);
    this.name = 'ValidationError';
    this.field = detail.field;
    this.constraint = detail.constraint;
    this.messageHe = detail.messageHe;
  }

  /** The wrapped `{ success:false, error:{...} }` payload handed to the client. */
  toResult(): {
    success: false;
    error: { field: string; constraint: string; message: string; messageHe: string };
  } {
    return {
      success: false,
      error: {
        field: this.field,
        constraint: this.constraint,
        message: this.message,
        messageHe: this.messageHe,
      },
    };
  }
}

// ── Bilingual message catalogue (keyed, not hardcoded at each call site) ─────────
const MESSAGES = {
  required: (f: string): [string, string] => [
    `${f} is required`,
    `חסר שדה חובה: ${f}`,
  ],
  string: (f: string): [string, string] => [
    `${f} must be text`,
    `השדה ${f} חייב להיות טקסט`,
  ],
  empty: (f: string): [string, string] => [
    `${f} must not be empty`,
    `השדה ${f} לא יכול להיות ריק`,
  ],
  maxLen: (f: string, n: number): [string, string] => [
    `${f} must be at most ${n} characters`,
    `השדה ${f} יכול להכיל עד ${n} תווים`,
  ],
  number: (f: string): [string, string] => [
    `${f} must be a finite number`,
    `השדה ${f} חייב להיות מספר תקין`,
  ],
  integer: (f: string): [string, string] => [
    `${f} must be a whole number`,
    `השדה ${f} חייב להיות מספר שלם`,
  ],
  nonNegative: (f: string): [string, string] => [
    `${f} must be zero or greater`,
    `השדה ${f} חייב להיות אפס או יותר`,
  ],
  boolean: (f: string): [string, string] => [
    `${f} must be true or false`,
    `השדה ${f} חייב להיות אמת או שקר`,
  ],
  enum: (f: string, allowed: readonly string[]): [string, string] => [
    `${f} must be one of: ${allowed.join(', ')}`,
    `השדה ${f} חייב להיות אחד מ: ${allowed.join(', ')}`,
  ],
  coordPair: (): [string, string] => [
    'lat and lng must be provided together',
    'יש לספק קו רוחב וקו אורך יחד',
  ],
  coord: (): [string, string] => [
    'location must be valid coordinates (lat ∈ [-90,90], lng ∈ [-180,180])',
    'המיקום חייב להיות קואורדינטות תקינות (קו רוחב 90± / קו אורך 180±)',
  ],
} as const;

function fail(field: string, constraint: string, [en, he]: [string, string]): never {
  throw new ValidationError({ field, constraint, message: en, messageHe: he });
}

/** Required, non-empty string of bounded length. Returns the trimmed value. */
export function requireString(value: unknown, field: string, max: number = MAX_ID_LEN): string {
  if (value === undefined || value === null) fail(field, 'required', MESSAGES.required(field));
  if (typeof value !== 'string') fail(field, 'type:string', MESSAGES.string(field));
  if ((value as string).length > max) fail(field, `maxLength:${max}`, MESSAGES.maxLen(field, max));
  const trimmed = (value as string).trim();
  if (!trimmed) fail(field, 'nonEmpty', MESSAGES.empty(field));
  return trimmed;
}

/** Optional string of bounded length. Absent/empty → undefined. */
export function optionalString(
  value: unknown,
  field: string,
  max: number = MAX_ID_LEN,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(field, 'type:string', MESSAGES.string(field));
  if ((value as string).length > max) fail(field, `maxLength:${max}`, MESSAGES.maxLen(field, max));
  const trimmed = (value as string).trim();
  return trimmed ? trimmed : undefined;
}

/** Optional finite, non-negative number. Absent → undefined. */
export function optionalNonNegativeNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(field, 'type:number', MESSAGES.number(field));
  if ((value as number) < 0) fail(field, 'nonNegative', MESSAGES.nonNegative(field));
  return value as number;
}

/** Required finite, non-negative integer (e.g. a hint index). */
export function requireNonNegativeInteger(value: unknown, field: string): number {
  if (value === undefined || value === null) fail(field, 'required', MESSAGES.required(field));
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(field, 'type:number', MESSAGES.number(field));
  if (!Number.isInteger(value as number)) fail(field, 'type:integer', MESSAGES.integer(field));
  if ((value as number) < 0) fail(field, 'nonNegative', MESSAGES.nonNegative(field));
  return value as number;
}

/** Optional boolean. Absent → undefined. */
export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') fail(field, 'type:boolean', MESSAGES.boolean(field));
  return value;
}

/** Optional value constrained to a fixed set. Absent → undefined. */
export function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(field, `enum:${allowed.join('|')}`, MESSAGES.enum(field, allowed));
  }
  return value as T;
}

/**
 * Optional coordinate pair. Both must be supplied together and form a valid
 * GeoPoint (finite, in range). Absent → {}. Guards every haversine call site
 * against NaN/Infinity/out-of-range coordinates.
 */
export function optionalCoordinatePair(
  lat: unknown,
  lng: unknown,
): { lat?: number; lng?: number } {
  const latMissing = lat === undefined || lat === null;
  const lngMissing = lng === undefined || lng === null;
  if (latMissing && lngMissing) return {};
  if (latMissing || lngMissing) fail('location', 'pairTogether', MESSAGES.coordPair());
  if (!isValidCoord(lat, lng)) fail('location', 'validCoord', MESSAGES.coord());
  return { lat: lat as number, lng: lng as number };
}

// ─── Photo-URL origin guard (change: prelaunch-critical-fixes, M3) ────────────
// submitStationPhoto must only accept photos hosted in our own Firebase Storage
// bucket — never an arbitrary external URL a malicious client could inject. Pure
// (no admin imports) so it stays importable by both the server and the unit lane.
export const FIREBASE_STORAGE_ORIGIN =
  'https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/';

export function isFirebaseStorageUrl(url: unknown): boolean {
  return typeof url === 'string' && url.startsWith(FIREBASE_STORAGE_ORIGIN);
}

// ─── Caller-scoped photo URL (change: auth-anticheat-hardening, row 41) ───────
// Tighter than isFirebaseStorageUrl: the submitted photo must live under the
// CALLER'S OWN run/team folder (runs/{runId}/teams/{uid}/…) — so one team can't
// attach another team's (or a foreign) image. Accepts our Firebase https download
// URL or a gs:// URL; rejects javascript:, foreign origins/paths, and oversized
// strings. Throws a typed ValidationError (the functions adapter maps it to
// invalid-argument).
const MAX_URL_LEN = 2048;

export function requireStorageUrl(url: unknown, runId: string, uid: string): string {
  if (typeof url !== 'string') fail('photoUrl', 'type:string', MESSAGES.string('photoUrl'));
  const s = url as string;
  if (s.length === 0) fail('photoUrl', 'nonEmpty', MESSAGES.empty('photoUrl'));
  if (s.length > MAX_URL_LEN) fail('photoUrl', `maxLength:${MAX_URL_LEN}`, MESSAGES.maxLen('photoUrl', MAX_URL_LEN));

  let objectPath: string | null = null;
  if (s.startsWith(FIREBASE_STORAGE_ORIGIN)) {
    const m = s.match(/\/o\/([^?]+)/);
    if (m) { try { objectPath = decodeURIComponent(m[1]); } catch { objectPath = null; } }
  } else if (s.startsWith('gs://')) {
    const rest = s.slice('gs://'.length);
    const slash = rest.indexOf('/');
    if (slash >= 0) objectPath = rest.slice(slash + 1);
  }

  const expected = `runs/${runId}/teams/${uid}/`;
  if (!objectPath || !objectPath.startsWith(expected)) {
    fail('photoUrl', 'storagePath', [
      'Photo must be uploaded to your own team folder.',
      'יש להעלות את התמונה לתיקיית הקבוצה שלכם.',
    ]);
  }
  return s;
}

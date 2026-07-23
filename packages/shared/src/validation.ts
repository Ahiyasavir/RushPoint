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
import { taskCompletabilityError } from './taskCompletability';
import type { Stage } from './types';

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

// Characters that never belong in a human-visible string but can spoof the
// creator/staff console (display-spoofing hardening — wave-h H3; there is no DOM
// XSS since React escapes). Stripped:
//   • C0/C1 control chars — U+0000–U+001F, U+007F–U+009F (incl. DEL)
//   • bidi OVERRIDE + ISOLATE formatters — U+202A–U+202E, U+2066–U+2069
//     (RLO/LRO reorder glyphs to impersonate another name; isolates hide text)
//   • zero-width chars — U+200B–U+200D, U+FEFF (invisible padding / BOM)
// Deliberately KEPT: Hebrew letters (U+0590–U+05FF) and the plain directional
// marks LRM/RLM (U+200E/U+200F) that legitimate RTL content relies on — the strip
// stops at U+200D so LRM/RLM pass through untouched.
const UNSAFE_DISPLAY_CHARS = new RegExp(
  "[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]",
  "g",
);

/** Remove control / bidi-override / zero-width spoofing chars; keep ordinary text
 *  (Hebrew + LRM/RLM preserved). Pure — unit-tested directly. */
export function stripUnsafeDisplayChars(value: string): string {
  return value.replace(UNSAFE_DISPLAY_CHARS, '');
}

// ─── Structural winnability guard (wave-j J2/J3/J4) ───────────────────────────
// The single SOURCE of the "a broken game can't be saved or published" rule,
// mirroring launchRun's launch-time defense (functions/src/runs/index.ts) so a
// broken shape is rejected at every authoring surface, not only at launch:
//   • an empty-task stage becomes active but never completes → the run strands;
//   • a task with no usable answer key (quiz/numeric/smart_station/sequence) can
//     never be completed by any participant (taskCompletabilityError);
//   • a NEGATIVE pointValue subtracts from the team total, and a negative
//     difficulty / estimatedMinutes skews smart_weighted routing & scoring.
// Pure (no Firebase) → shared by updateGame (save) + publishGame (gallery) and
// unit-tested directly. An empty `stages` array is fine (a game still being built).
export function gameStructureProblems(stages: Stage[] | undefined): string[] {
  const problems: string[] = [];
  for (const stage of stages ?? []) {
    if ((stage.tasks?.length ?? 0) === 0) {
      problems.push(`Stage "${stage.title || stage.id}" needs at least one task`);
    }
    for (const task of stage.tasks ?? []) {
      const completabilityError = taskCompletabilityError(task);
      if (completabilityError) problems.push(completabilityError);
      const label = `Task "${task.title || task.id}"`;
      if (typeof task.pointValue === 'number' && !(task.pointValue >= 0)) {
        problems.push(`${label}: point value cannot be negative`);
      }
      if (typeof task.difficulty === 'number' && !(task.difficulty >= 0)) {
        problems.push(`${label}: difficulty cannot be negative`);
      }
      if (typeof task.estimatedMinutes === 'number' && !(task.estimatedMinutes >= 0)) {
        problems.push(`${label}: estimated minutes cannot be negative`);
      }
      // Expected duration (change: task-duration-defaults). Optional, so only a
      // PRESENT value is checked — absent means "derive the per-interaction default
      // in the Builder", which is not an error. NaN/Infinity are refused too: a
      // non-finite value reaching scoreFixedPointsSpeed's expected route total makes
      // the whole speed bonus NaN for every team in the run.
      if (task.expectedDurationMinutes !== undefined
        && (typeof task.expectedDurationMinutes !== 'number'
          || !Number.isFinite(task.expectedDurationMinutes)
          || task.expectedDurationMinutes < 0)) {
        problems.push(`${label}: expected duration must be a non-negative number`);
      }
    }
  }
  return problems;
}

/** Required, non-empty string of bounded length. Returns the trimmed value with
 *  control / bidi-override / zero-width spoofing chars stripped (wave-h H3). */
export function requireString(value: unknown, field: string, max: number = MAX_ID_LEN): string {
  if (value === undefined || value === null) fail(field, 'required', MESSAGES.required(field));
  if (typeof value !== 'string') fail(field, 'type:string', MESSAGES.string(field));
  if ((value as string).length > max) fail(field, `maxLength:${max}`, MESSAGES.maxLen(field, max));
  const trimmed = stripUnsafeDisplayChars(value as string).trim();
  if (!trimmed) fail(field, 'nonEmpty', MESSAGES.empty(field));
  return trimmed;
}

// ─── Access code normalization (Wave 1, Fix 1) ───────────────────────────────
// Join/board/recap/device codes come straight from client payloads and are
// interpolated into a Firestore doc path (accessCodes/{CODE}). A non-string code
// makes `.trim()` a TypeError; a code containing `/` builds an odd-segment path
// that db.doc() rejects — both re-thrown as opaque INTERNAL/500. Normalize (and
// reject) BEFORE any doc path is built so every bad code is a typed, bilingual
// invalid-argument. Codes are alphanumeric only (server-generated codes always are).
export const ACCESS_CODE_RE = /^[A-Za-z0-9]+$/;

const ACCESS_CODE_MESSAGES = {
  invalid: (): [string, string] => [
    'code must be letters and digits only',
    'הקוד חייב להכיל אותיות וספרות בלבד',
  ],
} as const;

/** Validate + canonicalize a client-supplied access code. Rejects non-strings,
 *  empty/whitespace-only, over-length, and any non-alphanumeric char (incl. `/`,
 *  spaces, non-ASCII). Returns the trimmed, upper-cased code. */
export function normalizeAccessCode(code: unknown): string {
  if (code === undefined || code === null) fail('code', 'required', MESSAGES.required('code'));
  if (typeof code !== 'string') fail('code', 'type:string', MESSAGES.string('code'));
  const t = (code as string).trim();
  if (!t) fail('code', 'nonEmpty', MESSAGES.empty('code'));
  if (t.length > MAX_CODE_LEN) fail('code', `maxLength:${MAX_CODE_LEN}`, MESSAGES.maxLen('code', MAX_CODE_LEN));
  if (!ACCESS_CODE_RE.test(t)) fail('code', 'alphanumeric', ACCESS_CODE_MESSAGES.invalid());
  return t.toUpperCase();
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
// Our project's Storage bucket is addressable under BOTH the legacy `appspot.com`
// name and Firebase's newer `firebasestorage.app` default — the client SDK builds
// download URLs with whichever VITE_FIREBASE_STORAGE_BUCKET is set (currently
// firebasestorage.app), so the server guard must accept both or every real upload
// is rejected. Still restricted to our project on the Firebase download host.
const FIREBASE_STORAGE_HTTPS_PREFIX = 'https://firebasestorage.googleapis.com/v0/b/';
export const FIREBASE_STORAGE_BUCKETS = [
  'rushpoint-pwa-7daaa.firebasestorage.app',
  'rushpoint-pwa-7daaa.appspot.com',
];
export const FIREBASE_STORAGE_ORIGINS = FIREBASE_STORAGE_BUCKETS.map(
  (b) => `${FIREBASE_STORAGE_HTTPS_PREFIX}${b}/`,
);
// Back-compat single-origin constant (legacy appspot form).
export const FIREBASE_STORAGE_ORIGIN = `${FIREBASE_STORAGE_HTTPS_PREFIX}rushpoint-pwa-7daaa.appspot.com/`;

/**
 * Opt-in relaxation for local/playtest environments. See `extractStorageObjectPath`.
 * ALWAYS decided by the CALLER (this module is pure — it never reads process.env),
 * defaults to `false`, so every existing call site keeps production behaviour.
 */
export interface StorageOriginOptions {
  /** Also accept an emulator-hosted / tunnel-proxied Storage URL. */
  allowLocalEmulator?: boolean;
}

// The Firebase Storage download REST shape, host-agnostic: <origin>/v0/b/<bucket>/o/<encodedPath>.
// Used ONLY when the caller opted into `allowLocalEmulator` — the Storage emulator serves
// http://127.0.0.1:9199/v0/b/…, and behind the playtest tunnel (scripts/proxy.mjs) the same
// path arrives on the single https tunnel origin. Both are rejected in production mode.
const EMULATOR_STORAGE_URL_RE = /^https?:\/\/[^/?#]+\/v0\/b\/[^/?#]+\/o\/([^?#]+)/;

/**
 * The Storage object path a URL points at, or null if the URL is not one we trust.
 * Production accept-set: our project's Firebase download origins, or `gs://`.
 * With `allowLocalEmulator`, additionally any origin serving the `/v0/b/<bucket>/o/<path>`
 * download shape (emulator or tunnel proxy). Never accepts an arbitrary URL in any mode.
 */
function extractStorageObjectPath(s: string, opts?: StorageOriginOptions): string | null {
  const decode = (raw: string): string | null => {
    try { return decodeURIComponent(raw); } catch { return null; }
  };
  if (FIREBASE_STORAGE_ORIGINS.some((o) => s.startsWith(o))) {
    const m = s.match(/\/o\/([^?]+)/);
    return m ? decode(m[1]) : null;
  }
  if (s.startsWith('gs://')) {
    const rest = s.slice('gs://'.length);
    const slash = rest.indexOf('/');
    return slash >= 0 ? rest.slice(slash + 1) : null;
  }
  if (opts?.allowLocalEmulator) {
    const m = s.match(EMULATOR_STORAGE_URL_RE);
    return m ? decode(m[1]) : null;
  }
  return null;
}

export function isFirebaseStorageUrl(url: unknown, opts?: StorageOriginOptions): boolean {
  if (typeof url !== 'string') return false;
  if (FIREBASE_STORAGE_ORIGINS.some((o) => url.startsWith(o))) return true;
  return opts?.allowLocalEmulator === true && EMULATOR_STORAGE_URL_RE.test(url);
}

// ─── Task media: YouTube parsing + upload-URL validation (change: task-media-attachments) ─
// Creator-authored task media has two sources: uploaded image/video files (which
// MUST live in our Firebase Storage bucket) and YouTube links (embedded, never
// uploaded). These pure helpers are the trust boundary shared by the Builder (instant
// feedback) and the server (createGame/updateGame enforcement). No Firebase imports.

/** A single creator-authored media attachment on a task. Mirrors the `TaskMedia`
 *  interface in types/index.ts (kept structurally identical; typed loosely here so
 *  validation stays dependency-free of the type barrel). */
export type TaskMediaKind = 'image' | 'video' | 'youtube';
export interface TaskMediaLike {
  id?: string;
  kind: TaskMediaKind;
  url: string;
  caption?: string;
}

/**
 * Extract the 11-char YouTube video id from the common URL forms, else null.
 * Supported: watch?v=, youtu.be/, shorts/, embed/. Returns null for non-string
 * input or any URL that doesn't yield a valid `[A-Za-z0-9_-]{11}` id.
 */
export function parseYouTubeId(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const s = url.trim();
  if (!s) return null;
  const idRe = /^[A-Za-z0-9_-]{11}$/;
  const isId = (v: string | undefined | null): v is string => !!v && idRe.test(v);

  // youtu.be/<id>[?…]  and  youtube.com/{embed,shorts}/<id>[?…|/…]
  const pathMatch = s.match(/(?:youtu\.be\/|youtube\.com\/(?:embed|shorts|v)\/)([^?/&#]+)/i);
  if (pathMatch && isId(pathMatch[1])) return pathMatch[1];

  // youtube.com/watch?v=<id>&…  (query param, any order)
  const vMatch = s.match(/[?&]v=([^?&#]+)/i);
  if (vMatch && isId(vMatch[1])) return vMatch[1];

  return null;
}

/** Canonical embed URL for a parsed YouTube id. */
export function youTubeEmbedUrl(id: string): string {
  return `https://www.youtube.com/embed/${id}`;
}

/** True if a single media entry is well-formed and its URL passes its kind's origin
 *  rule (image/video → Firebase Storage URL; youtube → parseable to a valid id). */
export function isTaskMediaValid(m: unknown, opts?: StorageOriginOptions): boolean {
  if (!m || typeof m !== 'object') return false;
  const { kind, url } = m as { kind?: unknown; url?: unknown };
  if (typeof url !== 'string') return false;
  if (kind === 'image' || kind === 'video') return isFirebaseStorageUrl(url, opts);
  if (kind === 'youtube') return parseYouTubeId(url) !== null;
  return false;
}

/**
 * Take an arbitrary client-supplied value and return a clean, validated
 * `TaskMediaLike[]`: non-array → []; invalid entries dropped; YouTube URLs rewritten
 * to the canonical `.../embed/<id>` form; captions trimmed (empty dropped); every
 * entry given a stable non-empty id (preserved if present, else derived from index).
 * This is the server-side enforcement boundary in createGame/updateGame.
 */
export function normalizeTaskMedia(input: unknown, opts?: StorageOriginOptions): TaskMediaLike[] {
  if (!Array.isArray(input)) return [];
  const out: TaskMediaLike[] = [];
  input.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const { id, kind, url, caption } = raw as {
      id?: unknown; kind?: unknown; url?: unknown; caption?: unknown;
    };
    if (typeof url !== 'string') return;
    let finalUrl = url;
    if (kind === 'youtube') {
      const ytId = parseYouTubeId(url);
      if (!ytId) return;
      finalUrl = youTubeEmbedUrl(ytId);
    } else if (kind === 'image' || kind === 'video') {
      if (!isFirebaseStorageUrl(url, opts)) return;
    } else {
      return; // unknown kind
    }
    const trimmedCaption = typeof caption === 'string' ? caption.trim() : '';
    out.push({
      id: typeof id === 'string' && id.trim() ? id.trim() : `m${i}-${finalUrl.length}`,
      kind: kind as TaskMediaKind,
      url: finalUrl,
      ...(trimmedCaption ? { caption: trimmedCaption } : {}),
    });
  });
  return out;
}

// ─── Caller-scoped photo URL (change: auth-anticheat-hardening, row 41) ───────
// Tighter than isFirebaseStorageUrl: the submitted photo must live under the
// CALLER'S OWN run/team folder (runs/{runId}/teams/{uid}/…) — so one team can't
// attach another team's (or a foreign) image. Accepts our Firebase https download
// URL or a gs:// URL; rejects javascript:, foreign origins/paths, and oversized
// strings. Throws a typed ValidationError (the functions adapter maps it to
// invalid-argument).
const MAX_URL_LEN = 2048;

export function requireStorageUrl(
  url: unknown,
  runId: string,
  uid: string,
  // wave-c: the CALLER decides whether emulator/tunnel-proxied Storage origins are
  // acceptable (submitStationPhoto passes process.env.FUNCTIONS_EMULATOR === 'true').
  // Default false ⇒ production accept-set unchanged. The run/team prefix check below
  // — the actual IDOR guard — applies in EVERY mode.
  opts?: StorageOriginOptions,
): string {
  if (typeof url !== 'string') fail('photoUrl', 'type:string', MESSAGES.string('photoUrl'));
  const s = url as string;
  if (s.length === 0) fail('photoUrl', 'nonEmpty', MESSAGES.empty('photoUrl'));
  if (s.length > MAX_URL_LEN) fail('photoUrl', `maxLength:${MAX_URL_LEN}`, MESSAGES.maxLen('photoUrl', MAX_URL_LEN));

  const objectPath = extractStorageObjectPath(s, opts);

  const expected = `runs/${runId}/teams/${uid}/`;
  if (!objectPath || !objectPath.startsWith(expected)) {
    fail('photoUrl', 'storagePath', [
      'That photo could not be saved. Please retake the photo.',
      'לא הצלחנו לשמור את התמונה. צלמו שוב.',
    ]);
  }
  return s;
}

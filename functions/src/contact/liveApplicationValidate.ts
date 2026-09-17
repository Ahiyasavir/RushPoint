/**
 * What a RushPoint Live team application may contain (change: rushpoint-live-signup).
 *
 * PURE. No Firestore, no functions runtime, no network — so the rules below can be
 * driven exhaustively by scripts/test-live-application.ts without an emulator, and
 * so the ONE definition of "is this a valid application" is readable in one file
 * rather than spread through a callable body.
 *
 * The caller is a complete stranger: this form is open to people who have no
 * account and never will, exactly like the contact form. Everything authentication
 * would normally carry is carried here instead — field bounds, an enum allowlist, a
 * byte cap on the photo — plus a connection-keyed rate limit at the call site.
 *
 * Every refusal names the field. An applicant who cannot tell WHICH of nine answers
 * the server disliked cannot comply, and this is the only channel they have.
 */

/** Thrown for a payload a person could fix. The callable maps it to invalid-argument. */
export class ApplicationRejected extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationRejected';
  }
}

/**
 * Field bounds. Generous for a person writing about their friends, useless for a
 * script: the motivation pitch is the field an applicant will actually fill, so it
 * gets room, and nothing here is tight enough to truncate an honest answer.
 */
export const LIVE_APPLICATION_LIMITS = {
  teamName: 80,
  location: 200,
  howTheyMet: 1_500,
  ageRange: 120,
  motivation: 2_000,
  phone: 40,
} as const;

/** The event's own rule, stated once. A team outside it cannot compete as a team. */
export const TEAM_SIZE_MIN = 5;
export const TEAM_SIZE_MAX = 8;

/** The on-camera comfort scale, 1 = would rather not, 5 = give me the camera. */
export const CAMERA_COMFORT_MIN = 1;
export const CAMERA_COMFORT_MAX = 5;

/**
 * The sectors a team may describe itself as. An allowlist rather than free text
 * because this is the one answer that gets COUNTED — "ten teams from every sector"
 * is a promise about the mix, and a free-text field cannot be tallied.
 *
 * Multi-select on purpose: a mixed team is the interesting case, not the edge case.
 */
export const TEAM_SECTORS = ['religious', 'secular', 'mixed', 'other'] as const;
export type TeamSector = (typeof TEAM_SECTORS)[number];

/**
 * The photo's byte ceiling, measured on the base64 TEXT rather than the decoded
 * image, because the base64 is what has to fit through the transport.
 *
 * Load-bearing and NOT arbitrary: functions/server.js mounts `express.json({ limit:
 * '1mb' })` app-wide, so a body over that is refused by the PARSER before any code
 * here runs — which reaches the applicant as an unexplained failure naming no field,
 * the one outcome this module exists to prevent. 520 KB of base64 leaves comfortable
 * room for the other answers inside that megabyte.
 *
 * The browser downscales before it ever sends (see the form page), so a modern phone
 * photo arrives around 100-250 KB. This cap is the backstop for a caller that skipped
 * the downscale, not the working limit.
 */
export const PHOTO_MAX_BASE64_CHARS = 520_000;

/** What a group photo may be. Read from the data URL's prefix, never from a filename. */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface LiveApplicationFields {
  readonly teamName: string;
  readonly teamSize: number;
  readonly sectors: readonly TeamSector[];
  readonly location: string;
  readonly howTheyMet: string;
  readonly ageRange: string;
  readonly motivation: string;
  readonly cameraComfort: number;
  readonly phone: string;
  /** Digits only, `972…` form — for dialling and for spotting a duplicate application. */
  readonly phoneNormalized: string;
  readonly language: 'he' | 'en' | null;
}

export interface LiveApplicationPhoto {
  readonly contentType: (typeof PHOTO_CONTENT_TYPES)[number];
  readonly base64: string;
}

/**
 * A required string.
 *
 * `null` and `undefined` are treated identically, because the callable transport
 * encodes BOTH as null on the wire (see the CLAUDE.md note on clearing an optional
 * field). A guard that distinguishes them rejects a caller for omitting a field with
 * no way to comply.
 */
function requiredText(value: unknown, field: string, max: number): string {
  if (value === null || value === undefined) throw new ApplicationRejected(field, `${field} is required`);
  if (typeof value !== 'string') throw new ApplicationRejected(field, `${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ApplicationRejected(field, `${field} is required`);
  if (trimmed.length > max) {
    throw new ApplicationRejected(field, `${field} must be at most ${max} characters`);
  }
  return trimmed;
}

/** A whole number inside an inclusive range. Accepts the numeric string a form sends. */
function requiredInteger(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ApplicationRejected(field, `${field} must be a whole number`);
  }
  if (n < min || n > max) {
    throw new ApplicationRejected(field, `${field} must be between ${min} and ${max}`);
  }
  return n;
}

/**
 * Israeli mobile numbers, normalized to `972…` so two spellings of one number are one
 * number. Deliberately permissive about SPACING and punctuation — people write their
 * own phone number a dozen ways and none of them is wrong — and strict only about the
 * thing that decides whether it can be dialled: the digits.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  // 0501234567 -> 972501234567
  if (/^05\d{8}$/.test(digits)) return `972${digits.slice(1)}`;
  // 972501234567, however the caller spelled the country code (+, 00, or bare).
  if (/^9725\d{8}$/.test(digits)) return digits;
  if (/^009725\d{8}$/.test(digits)) return digits.slice(2);
  throw new ApplicationRejected('phone', 'phone must be an Israeli mobile number');
}

/** At least one sector, each from the allowlist, each counted once. */
function requiredSectors(value: unknown): TeamSector[] {
  const list = Array.isArray(value) ? value : [value];
  const seen: TeamSector[] = [];
  for (const entry of list) {
    if (entry === null || entry === undefined || entry === '') continue;
    if (typeof entry !== 'string' || !(TEAM_SECTORS as readonly string[]).includes(entry)) {
      throw new ApplicationRejected('sectors', 'sectors contains an unknown value');
    }
    const sector = entry as TeamSector;
    if (!seen.includes(sector)) seen.push(sector);
  }
  if (seen.length === 0) throw new ApplicationRejected('sectors', 'sectors is required');
  return seen;
}

/** Absent and explicitly null mean the same thing, for the transport reason above. */
function optionalLanguage(value: unknown): 'he' | 'en' | null {
  if (value === null || value === undefined || value === '') return null;
  if (value !== 'he' && value !== 'en') throw new ApplicationRejected('language', 'language must be he or en');
  return value;
}

/**
 * The group photo, read out of a `data:` URL.
 *
 * The content type is taken from the URL's own prefix and checked against the
 * allowlist; a filename is never consulted, because a filename is a claim the sender
 * makes about bytes we already hold. The base64 body is checked for shape too, so a
 * decode failure surfaces HERE, naming the field, rather than months later for
 * whoever opens the application.
 */
export function parsePhotoDataUrl(value: unknown): LiveApplicationPhoto {
  if (value === null || value === undefined || value === '') {
    throw new ApplicationRejected('photo', 'photo is required');
  }
  if (typeof value !== 'string') throw new ApplicationRejected('photo', 'photo must be a data URL');

  const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!match) throw new ApplicationRejected('photo', 'photo must be a base64 data URL');

  const contentType = match[1].toLowerCase();
  if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw new ApplicationRejected('photo', 'photo must be a JPEG, PNG or WebP image');
  }

  const base64 = match[2];
  if (base64.length > PHOTO_MAX_BASE64_CHARS) {
    throw new ApplicationRejected('photo', 'photo is too large');
  }
  // base64 encodes three bytes as four characters, so a length that is not a multiple
  // of four cannot decode. Catching it here keeps a corrupt upload from being stored
  // and only discovered when somebody tries to look at it.
  if (base64.length % 4 !== 0) throw new ApplicationRejected('photo', 'photo is not valid base64');

  return { contentType: contentType as LiveApplicationPhoto['contentType'], base64 };
}

/**
 * The whole payload, or the first thing wrong with it.
 *
 * Order matters: the cheap text checks run before the photo, so a caller sending half
 * a megabyte with a blank team name is told about the team name rather than having
 * the image parsed first.
 */
export function validateLiveApplication(payload: Record<string, unknown>): {
  fields: LiveApplicationFields;
  photo: LiveApplicationPhoto;
} {
  const teamName = requiredText(payload.teamName, 'teamName', LIVE_APPLICATION_LIMITS.teamName);
  const teamSize = requiredInteger(payload.teamSize, 'teamSize', TEAM_SIZE_MIN, TEAM_SIZE_MAX);
  const sectors = requiredSectors(payload.sectors);
  const location = requiredText(payload.location, 'location', LIVE_APPLICATION_LIMITS.location);
  const howTheyMet = requiredText(payload.howTheyMet, 'howTheyMet', LIVE_APPLICATION_LIMITS.howTheyMet);
  const ageRange = requiredText(payload.ageRange, 'ageRange', LIVE_APPLICATION_LIMITS.ageRange);
  const motivation = requiredText(payload.motivation, 'motivation', LIVE_APPLICATION_LIMITS.motivation);
  const cameraComfort = requiredInteger(
    payload.cameraComfort,
    'cameraComfort',
    CAMERA_COMFORT_MIN,
    CAMERA_COMFORT_MAX,
  );
  const phone = requiredText(payload.phone, 'phone', LIVE_APPLICATION_LIMITS.phone);
  const phoneNormalized = normalizePhone(phone);
  const language = optionalLanguage(payload.language);

  const photo = parsePhotoDataUrl(payload.photo);

  return {
    fields: {
      teamName,
      teamSize,
      sectors,
      location,
      howTheyMet,
      ageRange,
      motivation,
      cameraComfort,
      phone,
      phoneNormalized,
      language,
    },
    photo,
  };
}

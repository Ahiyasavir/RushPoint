/**
 * The RushPoint Live application validator (change: rushpoint-live-signup).
 *
 * This is the whole defence on an endpoint a complete stranger can reach, so the
 * rules are driven here rather than trusted: field bounds, the sector allowlist, the
 * team-size window, the camera scale, phone normalization and the photo's data URL.
 *
 * Pure lane — no emulator, no network. Run by `npm test` through the aggregator.
 */
import {
  ApplicationRejected,
  CAMERA_COMFORT_MAX,
  CAMERA_COMFORT_MIN,
  LIVE_APPLICATION_LIMITS,
  PHOTO_MAX_BASE64_CHARS,
  TEAM_SECTORS,
  TEAM_SIZE_MAX,
  TEAM_SIZE_MIN,
  normalizePhone,
  parsePhotoDataUrl,
  validateLiveApplication,
} from '../functions/src/contact/liveApplicationValidate.ts';

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
}

/** Assert the payload is refused, and refused for the FIELD the applicant must fix. */
function refuses(name: string, payload: Record<string, unknown>, field: string): void {
  try {
    validateLiveApplication(payload);
    check(name, false, 'accepted a payload that should have been refused');
  } catch (e) {
    if (e instanceof ApplicationRejected) {
      check(name, e.field === field, `named "${e.field}", expected "${field}"`);
    } else {
      check(name, false, `threw ${String(e)} instead of ApplicationRejected`);
    }
  }
}

/** A valid photo of a given base64 length. Length must be a multiple of four. */
function photoOf(chars: number, contentType = 'image/jpeg'): string {
  return `data:${contentType};base64,${'A'.repeat(chars)}`;
}

/** A payload that passes, so each case below can change exactly one thing. */
function base(): Record<string, unknown> {
  return {
    teamName: 'הנשרים',
    teamSize: 6,
    sectors: ['religious', 'secular'],
    location: 'ירושלים',
    howTheyMet: 'מהתנועה',
    ageRange: '16-18',
    motivation: 'כי ננצח',
    cameraComfort: 4,
    phone: '054-123-4567',
    photo: photoOf(64),
    language: 'he',
  };
}

// ── A. The happy path ────────────────────────────────────────────────────────

{
  const { fields, photo } = validateLiveApplication(base());
  check('A1 team name survives', fields.teamName === 'הנשרים');
  check('A2 sectors survive in order', fields.sectors.join(',') === 'religious,secular');
  check('A3 phone is normalized to 972', fields.phoneNormalized === '972541234567');
  check('A4 the phone as WRITTEN is kept too', fields.phone === '054-123-4567');
  check('A5 photo content type is read from the data URL', photo.contentType === 'image/jpeg');
  check('A6 language survives', fields.language === 'he');
}

// Whitespace is the applicant's, not the record's.
{
  const { fields } = validateLiveApplication({ ...base(), teamName: '  הנשרים  ' });
  check('A7 text fields are trimmed', fields.teamName === 'הנשרים');
}

// A form sends numbers as strings. Refusing that would refuse every real submission.
{
  const { fields } = validateLiveApplication({ ...base(), teamSize: '7', cameraComfort: '2' });
  check('A8 numeric strings are accepted', fields.teamSize === 7 && fields.cameraComfort === 2);
}

// An omitted optional is absent OR null on the wire; both mean the same thing.
for (const value of [undefined, null, '']) {
  const { fields } = validateLiveApplication({ ...base(), language: value });
  check(`A9 language ${JSON.stringify(value)} reads as "not stated"`, fields.language === null);
}

// A single sector may arrive unwrapped.
{
  const { fields } = validateLiveApplication({ ...base(), sectors: 'other' });
  check('A10 a bare sector string is accepted', fields.sectors.join(',') === 'other');
}

// Duplicates are a UI accident, not a different answer.
{
  const { fields } = validateLiveApplication({ ...base(), sectors: ['mixed', 'mixed'] });
  check('A11 duplicate sectors collapse', fields.sectors.length === 1);
}

// ── B. Team size is the event's own rule ─────────────────────────────────────

for (const size of [TEAM_SIZE_MIN, 6, 7, TEAM_SIZE_MAX]) {
  const { fields } = validateLiveApplication({ ...base(), teamSize: size });
  check(`B1 a team of ${size} is accepted`, fields.teamSize === size);
}
refuses('B2 a team of 4 is refused', { ...base(), teamSize: TEAM_SIZE_MIN - 1 }, 'teamSize');
refuses('B3 a team of 9 is refused', { ...base(), teamSize: TEAM_SIZE_MAX + 1 }, 'teamSize');
refuses('B4 a fractional team is refused', { ...base(), teamSize: 6.5 }, 'teamSize');
// NaN reaches the server as null through the callable transport, per CLAUDE.md.
refuses('B5 a missing team size is refused', { ...base(), teamSize: null }, 'teamSize');
refuses('B6 a non-numeric team size is refused', { ...base(), teamSize: 'שבעה' }, 'teamSize');

// ── C. Sectors are an allowlist, because they get counted ────────────────────

for (const sector of TEAM_SECTORS) {
  const { fields } = validateLiveApplication({ ...base(), sectors: [sector] });
  check(`C1 "${sector}" is a known sector`, fields.sectors[0] === sector);
}
refuses('C2 an unknown sector is refused', { ...base(), sectors: ['pirates'] }, 'sectors');
refuses('C3 no sector at all is refused', { ...base(), sectors: [] }, 'sectors');
refuses('C4 a list of blanks is refused', { ...base(), sectors: ['', null] }, 'sectors');

// ── D. The camera scale ──────────────────────────────────────────────────────

for (let n = CAMERA_COMFORT_MIN; n <= CAMERA_COMFORT_MAX; n += 1) {
  const { fields } = validateLiveApplication({ ...base(), cameraComfort: n });
  check(`D1 comfort ${n} is on the scale`, fields.cameraComfort === n);
}
refuses('D2 comfort 0 is off the scale', { ...base(), cameraComfort: 0 }, 'cameraComfort');
refuses('D3 comfort 6 is off the scale', { ...base(), cameraComfort: 6 }, 'cameraComfort');

// ── E. Phone numbers ─────────────────────────────────────────────────────────
//
// Every spelling of ONE number must normalize to ONE value, or a duplicate
// application is invisible.

const SAME_NUMBER = [
  '0541234567',
  '054-123-4567',
  '054 123 4567',
  '+972541234567',
  '+972 54 123 4567',
  '00972541234567',
  '972-54-123-4567',
];
for (const spelling of SAME_NUMBER) {
  check(`E1 "${spelling}" normalizes to 972541234567`, normalizePhone(spelling) === '972541234567');
}

for (const bad of ['', '123', '02-1234567', '0541234', '05412345678', 'not a phone', '+1 555 0100']) {
  let threw = false;
  try {
    normalizePhone(bad);
  } catch (e) {
    threw = e instanceof ApplicationRejected;
  }
  check(`E2 "${bad}" is refused as a phone`, threw);
}
refuses('E3 a bad phone names the phone field', { ...base(), phone: '02-1234567' }, 'phone');

// ── F. The photo ─────────────────────────────────────────────────────────────

for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
  check(`F1 ${type} is accepted`, parsePhotoDataUrl(photoOf(16, type)).contentType === type);
}
check('F2 the content type is matched case-insensitively', parsePhotoDataUrl(photoOf(16, 'IMAGE/JPEG')).contentType === 'image/jpeg');
refuses('F3 a missing photo is refused', { ...base(), photo: null }, 'photo');
refuses('F4 a blank photo is refused', { ...base(), photo: '' }, 'photo');
refuses('F5 a plain URL is not a photo', { ...base(), photo: 'https://example.com/a.jpg' }, 'photo');
refuses('F6 a PDF disguised as a data URL is refused', { ...base(), photo: photoOf(16, 'application/pdf') }, 'photo');
refuses('F7 an SVG is refused', { ...base(), photo: photoOf(16, 'image/svg+xml') }, 'photo');
refuses('F8 base64 of a broken length is refused', { ...base(), photo: `data:image/jpeg;base64,${'A'.repeat(17)}` }, 'photo');

// The cap exists because express.json refuses a body over 1mb BEFORE any of this
// runs, which would reach the applicant as a failure naming no field at all.
{
  const atCap = photoOf(PHOTO_MAX_BASE64_CHARS);
  check('F9 a photo exactly at the cap is accepted', parsePhotoDataUrl(atCap).base64.length === PHOTO_MAX_BASE64_CHARS);
  refuses('F10 a photo over the cap is refused', { ...base(), photo: photoOf(PHOTO_MAX_BASE64_CHARS + 4) }, 'photo');
  check(
    'F11 the cap leaves room for the rest of the payload inside express.json 1mb',
    PHOTO_MAX_BASE64_CHARS + 64_000 < 1_000_000,
    `${PHOTO_MAX_BASE64_CHARS} + prose must stay under 1mb`,
  );
}

// ── G. Every required text field is required, and bounded ────────────────────

const TEXT_FIELDS = ['teamName', 'location', 'howTheyMet', 'ageRange', 'motivation'] as const;
for (const field of TEXT_FIELDS) {
  refuses(`G1 ${field} is required`, { ...base(), [field]: null }, field);
  refuses(`G2 ${field} may not be whitespace`, { ...base(), [field]: '   ' }, field);
  refuses(`G3 ${field} may not be a number`, { ...base(), [field]: 7 }, field);
  const max = LIVE_APPLICATION_LIMITS[field];
  const { fields } = validateLiveApplication({ ...base(), [field]: 'א'.repeat(max) });
  check(`G4 ${field} accepts exactly ${max} characters`, fields[field].length === max);
  refuses(`G5 ${field} refuses ${max + 1} characters`, { ...base(), [field]: 'א'.repeat(max + 1) }, field);
}

// ── H. Cheap checks run before the expensive one ─────────────────────────────
//
// A caller who left the team name blank AND sent an oversized photo must be told
// about the team name: it is the fix that is actually available to them, and
// parsing half a megabyte to say so is work nobody needed.

refuses(
  'H1 a blank text field is reported before an oversized photo',
  { ...base(), teamName: '', photo: photoOf(PHOTO_MAX_BASE64_CHARS + 4) },
  'teamName',
);

// ── I. An empty payload names a field rather than crashing ───────────────────

refuses('I1 an empty payload is refused, naming a field', {}, 'teamName');

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} :: ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);

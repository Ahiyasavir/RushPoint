// Pure-logic tests for the gallery GAME detail view model
// (change: gallery-game-card-preview).
//
// The motivating gap: the gallery's GAME cards rendered a title, a two-line clamp
// of the description and a meta row, and nothing else, so a creator judging a
// public game had no way to read it before copying it into their account. Pressing
// a game card now opens a read-only detail, and THIS is that view's value.
//
// The risk the detail introduces is the opposite one: `PublicGame.approxLocation`
// is `GeoPoint & { label? }` — it CARRIES lat/lng alongside the human label, and a
// detail view is by construction "show me everything". creator-web has no
// component test runner, so the ONLY way to prove the view never surfaces a game's
// exact coordinates is to make the view a VALUE and assert on it.
//
// Properties asserted:
//   1. SURFACES     — a complete game yields every documented field.
//   2. NEVER LEAKS  — an approxLocation carrying coords + a label yields the LABEL
//      and never the coordinates; an unknown future field never rides along.
//   3. NEVER THROWS — it runs on a callable response inside a modal; a throw blanks
//      the Gallery behind the ErrorBoundary. null/42/'x'/[]/{} are inputs.
//   4. NEVER MALFORMED — no count is ever NaN or negative; mode/requirement are
//      always a known key or the empty/null fallback.
//
//   npx tsx scripts/test-gallery-game-detail.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildGalleryGameDetail,
  SECRET_GAME_FIELD_NAMES,
  type GalleryGameDetail,
} from '../apps/creator-web/src/lib/galleryGameDetail';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, '..', ...p), 'utf8');

// A complete, well-formed public game — the baseline every test mutates.
const FULL = {
  id: 'g-1',
  ownerUid: 'owner-1',
  ownerDisplayName: 'Dana',
  title: 'Old City Treasure Hunt',
  description: 'A long description that the card could only ever clamp to two lines.',
  mode: 'team',
  scoringPreset: 'smart_weighted',
  tags: ['history', 'walking'],
  playCount: 42,
  stageCount: 5,
  taskCount: 18,
  estimatedTotalMinutes: 90,
  requirement: 'gps',
  // Carries lat/lng ALONGSIDE the human label — the whole point of the sweep.
  approxLocation: { lat: 31.7767123, lng: 35.2345678, label: 'Jerusalem, Old City' },
};

// ─── 1. Surfaces every documented field ───────────────────────────────────────
{
  const d = buildGalleryGameDetail(FULL);
  check('title is surfaced', d.title === 'Old City Treasure Hunt', d.title);
  check('description is surfaced', d.description === FULL.description);
  check('mode is surfaced', d.mode === 'team', d.mode);
  check('stageCount is surfaced', d.stageCount === 5, String(d.stageCount));
  check('taskCount is surfaced', d.taskCount === 18, String(d.taskCount));
  check('estimatedTotalMinutes is surfaced', d.estimatedTotalMinutes === 90, String(d.estimatedTotalMinutes));
  check('playCount is surfaced', d.playCount === 42, String(d.playCount));
  check('requirement is surfaced', d.requirement === 'gps', String(d.requirement));
  check('location LABEL is surfaced', d.locationLabel === 'Jerusalem, Old City', String(d.locationLabel));
  check('tags are surfaced', JSON.stringify(d.tags) === JSON.stringify(['history', 'walking']), JSON.stringify(d.tags));
}

// ─── 2. Secrecy: the label rides along, the coordinates never do ──────────────
{
  const d = buildGalleryGameDetail(FULL);
  const json = JSON.stringify(d);
  check('the coarse location label reaches the detail', json.includes('Jerusalem, Old City'));
  check('the exact authored latitude never reaches the detail', !json.includes('31.7767123'));
  check('the exact authored longitude never reaches the detail', !json.includes('35.2345678'));
  for (const name of SECRET_GAME_FIELD_NAMES) {
    check(`no coordinate KEY "${name}" reaches the detail`, !json.includes(`"${name}"`));
  }
  // The declared secret list must not have rotted into an empty formality.
  check('SECRET_GAME_FIELD_NAMES actually names the coordinate fields',
    ['coordinates', 'lat', 'lng'].every((n) => (SECRET_GAME_FIELD_NAMES as readonly string[]).includes(n)),
    SECRET_GAME_FIELD_NAMES.join(','));
}

// An approxLocation with coords but NO label yields no label and still no coords.
{
  const d = buildGalleryGameDetail({ ...FULL, approxLocation: { lat: 31.7767123, lng: 35.2345678 } });
  check('a labelless approxLocation yields no location label', d.locationLabel === null, String(d.locationLabel));
  check('and its coordinates still never leak', !JSON.stringify(d).includes('31.7767123'));
}

// A field the view model does not name must not ride along (copy-out, not spread).
{
  const d = buildGalleryGameDetail({ ...FULL, coverImage: 'https://x/y.png', futureField: 'FUTURE-SENTINEL' });
  const json = JSON.stringify(d);
  check('an unknown future field does not leak by default', !json.includes('FUTURE-SENTINEL'));
  check('the cover image url does not leak into the detail', !json.includes('https://x/y.png'));
}

// A planted top-level lat/lng (malformed input) still never reaches the detail.
{
  const d = buildGalleryGameDetail({ ...FULL, lat: 12.3456789, lng: 98.7654321, coordinates: { lat: 1, lng: 2 } });
  const json = JSON.stringify(d);
  check('a stray top-level latitude never reaches the detail', !json.includes('12.3456789'));
  check('a stray top-level longitude never reaches the detail', !json.includes('98.7654321'));
  check('a stray coordinates object never reaches the detail', !/"coordinates"/.test(json));
}

// ─── 3. Normalization: counts, mode, requirement ──────────────────────────────
for (const [input, expected] of [[-5, 0], [0, 0], [7.4, 7], [90, 90]] as const) {
  const d = buildGalleryGameDetail({ ...FULL, playCount: input });
  check(`playCount ${input} normalizes to ${expected}`, d.playCount === expected, String(d.playCount));
}
for (const bad of [NaN, Infinity, -1, 'lots', undefined, null]) {
  const d = buildGalleryGameDetail({ ...FULL, stageCount: bad, taskCount: bad, estimatedTotalMinutes: bad, playCount: bad });
  const counts = [d.stageCount, d.taskCount, d.estimatedTotalMinutes, d.playCount];
  check(`counts stay non-negative integers for ${String(bad)}`,
    counts.every((n) => Number.isInteger(n) && n >= 0), JSON.stringify(counts));
}
for (const [input, expected] of [['team', 'team'], ['individual', 'individual'], ['squad', ''], [undefined, ''], [42, '']] as const) {
  const d = buildGalleryGameDetail({ ...FULL, mode: input });
  check(`mode ${JSON.stringify(input)} normalizes to ${JSON.stringify(expected)}`, d.mode === expected, d.mode);
}
for (const [input, expected] of [['gps', 'gps'], ['anywhere', 'anywhere'], ['nowhere', null], [undefined, null], [7, null]] as const) {
  const d = buildGalleryGameDetail({ ...FULL, requirement: input });
  check(`requirement ${JSON.stringify(input)} normalizes to ${JSON.stringify(expected)}`, d.requirement === expected, String(d.requirement));
}

// ─── 4. Title / description / tags edge cases ─────────────────────────────────
for (const [description, expected] of [
  ['A real description.', 'A real description.'],
  ['   ', null],
  ['', null],
  [undefined, null],
  [42, null],
] as const) {
  const d = buildGalleryGameDetail({ ...FULL, description });
  check(`description ${JSON.stringify(description)} reports ${JSON.stringify(expected)}`,
    d.description === expected, JSON.stringify(d.description));
}
{
  const d = buildGalleryGameDetail({ ...FULL, title: undefined });
  check('an absent title yields an empty string, never undefined', d.title === '');
  const d2 = buildGalleryGameDetail({ ...FULL, title: '  Trimmed  ' });
  check('a title is trimmed', d2.title === 'Trimmed', JSON.stringify(d2.title));
}
for (const [tags, expected] of [
  [['a', 'b'], ['a', 'b']],
  [[], []],
  [undefined, []],
  ['history', []],
  [['a', '', '   ', 'b', 7, null], ['a', 'b']],
] as const) {
  const d = buildGalleryGameDetail({ ...FULL, tags });
  check(`tags ${JSON.stringify(tags)} normalize to ${JSON.stringify(expected)}`,
    JSON.stringify(d.tags) === JSON.stringify(expected), JSON.stringify(d.tags));
}

// ─── 5. Totality: it runs on a callable response, it must never throw ─────────
for (const junk of [null, undefined, 42, 'x', [], {}, true, NaN, () => 0]) {
  let d: GalleryGameDetail | null = null;
  let threw = false;
  try { d = buildGalleryGameDetail(junk); } catch { threw = true; }
  check(`buildGalleryGameDetail(${JSON.stringify(junk) ?? String(junk)}) does not throw`, !threw);
  check('  ...and yields a well-formed detail',
    !!d && typeof d.title === 'string' && typeof d.mode === 'string' &&
    typeof d.stageCount === 'number' && Number.isInteger(d.stageCount) &&
    Array.isArray(d.tags));
}

// ─── 6. Wiring guards (source scans) ──────────────────────────────────────────
const modal = read('apps', 'creator-web', 'src', 'components', 'GalleryGameDetailModal.tsx');
// The game detail carries only a coarse LABEL, so it must NOT drag in the map.
check('the game detail modal does not import the map', !/GalleryMap/.test(modal));
check('the game detail modal renders the view model', modal.includes('buildGalleryGameDetail'));
check('the game detail modal never reads an exact coordinate', !/\.(lat|lng|coordinates)\b/.test(modal));
check('the game detail modal closes on Escape', modal.includes('Escape'));
check('the game detail modal is announced as a dialog',
  modal.includes('role="dialog"') && modal.includes('aria-modal'));

const galleryPage = read('apps', 'creator-web', 'src', 'pages', 'GalleryPage.tsx');
check('the gallery opens the game detail modal', galleryPage.includes('GalleryGameDetailModal'));
check('the game card is press-to-open', /aria-label=\{pg\.title\}/.test(galleryPage) && galleryPage.includes('setDetailGame'));
check('the Copy button stops propagation so it does not also open the detail',
  /stopPropagation\(\);\s*void copyAction\.run\(pg\)/.test(galleryPage));
// The mission detail files must NOT have been altered by this change.
check('the game detail is a SEPARATE component from the mission detail',
  galleryPage.includes('GalleryTaskDetailModal') && galleryPage.includes('GalleryGameDetailModal'));

const i18n = read('apps', 'creator-web', 'src', 'i18n.ts');
const NEW_KEYS = ['gameDetailTitle', 'detailMode', 'detailLength', 'detailRequirement', 'detailLocation', 'reqGps', 'reqAnywhere'];
for (const key of NEW_KEYS) {
  const hits = i18n.split(`${key}:`).length - 1;
  check(`creator-web i18n defines ${key} in BOTH languages`, hits >= 2, `${hits} occurrence(s)`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

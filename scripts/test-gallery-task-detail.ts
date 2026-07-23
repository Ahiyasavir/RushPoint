// Pure-logic tests for the gallery mission detail view model
// (change: gallery-mission-detail).
//
// The motivating gap: the mission library rendered a CARD and nothing else, so a
// creator judging a mission saw a two-line clamp of the description, never the
// estimated minutes, never the author, never the publish date, and had no way to
// read a mission before inserting it into a stage.
//
// The risk the detail view introduces is the opposite one: `publicTasks` docs are
// world-readable and a detail view is, by construction, "show me everything".
// creator-web has no component test runner, so the ONLY way to prove the view
// never shows an answer key is to make the view a VALUE and assert on it.
//
// Four properties are asserted throughout:
//   1. NEVER LEAKS  — a document polluted with every server-secret field yields a
//      detail containing none of those values and none of those key names.
//   2. NEVER EXACT  — the deprecated exact `coordinates` is never promoted to the
//      shown area, even when no `approxLocation` exists. The area agrees with
//      `isPlottablePublicTask`, the same predicate the library map filters on.
//   3. NEVER THROWS — it runs on a callable response inside a modal; a throw
//      blanks the Gallery behind the ErrorBoundary. null/42/'x'/[]/{} are inputs.
//   4. NEVER MALFORMED — no row value ever reaches the DOM as NaN, as a negative
//      count, or as an out-of-range difficulty.
//
//   npx tsx scripts/test-gallery-task-detail.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isPlottablePublicTask } from '../packages/shared/src/publicTaskLocation';
import {
  buildGalleryTaskDetail,
  galleryTaskTypeKey,
  SECRET_TASK_FIELD_NAMES,
  GALLERY_DETAIL_ROW_ORDER,
  type GalleryTaskDetail,
} from '../apps/creator-web/src/lib/galleryTaskDetail';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, '..', ...p), 'utf8');

const rowKeys = (d: GalleryTaskDetail) => d.rows.map((r) => r.key);
const rowValue = (d: GalleryTaskDetail, key: string) => d.rows.find((r) => r.key === key)?.value;

// A complete, well-formed public mission — the baseline every suppression test
// mutates one field of.
const FULL = {
  id: 'pt-1',
  sourceGameId: 'g-1',
  sourceGameTitle: 'Old City Treasure Hunt',
  ownerUid: 'owner-1',
  ownerDisplayName: 'Dana',
  title: 'Find the brass lion',
  description: 'A long description that the card could only ever clamp to two lines.',
  type: 'quiz',
  approxLocation: { lat: 31.775, lng: 35.235 },
  difficulty: 6,
  estimatedMinutes: 12,
  pointValue: 150,
  tags: ['history', 'walking'],
  copyCount: 23,
  likeCount: 9,
  popularity: 4321,
  createdAt: '2026-03-04T10:20:30.000Z',
};

// ─── 1. Secrecy: the mandated leak sweep ──────────────────────────────────────
// Every server-secret field a Task can carry, stuffed onto a public mission doc
// with SENTINEL values, so a leak is unmistakable in the serialized detail.
const POLLUTED = {
  ...FULL,
  answers: ['CORRECT-ANSWER-SENTINEL'],
  numericAnswer: 424242,
  numericTolerance: 5,
  hint: 'SECRET-HINT-SENTINEL',
  hintPenalty: 25,
  steps: [{ label: 'step one', answer: 'STEP-ANSWER-SENTINEL' }],
  smart: { secretCode: 'SECRET-CODE-SENTINEL', enabled: true, imageUrl: 'https://x/y.png' },
  secretCode: 'SECRET-CODE-SENTINEL',
  choices: ['CHOICE-SENTINEL-A', 'CHOICE-SENTINEL-B'],
  surveyChoices: ['SURVEY-SENTINEL'],
  // The deprecated EXACT authored point. `searchTaskLibrary` strips it on the
  // wire, but a legacy cached response could still carry one.
  coordinates: { lat: 31.7767123, lng: 35.2345678 },
};

{
  const detail = buildGalleryTaskDetail(POLLUTED);
  const json = JSON.stringify(detail);

  const secretValues = [
    'CORRECT-ANSWER-SENTINEL', 'SECRET-HINT-SENTINEL', 'STEP-ANSWER-SENTINEL',
    'SECRET-CODE-SENTINEL', 'CHOICE-SENTINEL-A', 'CHOICE-SENTINEL-B', 'SURVEY-SENTINEL',
  ];
  for (const v of secretValues) {
    check(`no secret VALUE "${v}" reaches the detail`, !json.includes(v));
  }
  check('no secret numeric answer reaches the detail', !json.includes('424242'));
  check('no hint penalty reaches the detail', !/"hintPenalty"/.test(json));

  for (const name of SECRET_TASK_FIELD_NAMES) {
    check(`no secret KEY "${name}" reaches the detail`, !json.includes(`"${name}"`));
  }

  check('the exact authored latitude never reaches the detail', !json.includes('31.7767123'));
  check('the exact authored longitude never reaches the detail', !json.includes('35.2345678'));
  check('the smart-station media url never reaches the detail', !json.includes('https://x/y.png'));

  // The declared secret list must not have rotted into an empty formality.
  check('SECRET_TASK_FIELD_NAMES actually names the six secrets',
    ['answers', 'numericAnswer', 'steps', 'hint', 'secretCode', 'coordinates']
      .every((n) => (SECRET_TASK_FIELD_NAMES as readonly string[]).includes(n)),
    SECRET_TASK_FIELD_NAMES.join(','));
}

// A field the allow-list does not name must not ride along (copy-out, not strip-out).
{
  const detail = buildGalleryTaskDetail({ ...FULL, futureField: 'FUTURE-SENTINEL' });
  check('an unknown future field does not leak by default',
    !JSON.stringify(detail).includes('FUTURE-SENTINEL'));
}

// ─── 2. Location: coarse area only, and it agrees with the map ────────────────
{
  const noArea = buildGalleryTaskDetail({
    ...FULL, approxLocation: undefined, coordinates: { lat: 31.7767123, lng: 35.2345678 },
  });
  check('an exact coordinate is never promoted to the shown area', noArea.area === null);
  check('a mission with no published area reports no-area', noArea.areaState === 'no-area');
  check('the exact point is absent from that detail too',
    !JSON.stringify(noArea).includes('31.7767123'));
}
{
  const withArea = buildGalleryTaskDetail(FULL);
  check('a published area is passed through as-is',
    withArea.area?.lat === 31.775 && withArea.area?.lng === 35.235,
    JSON.stringify(withArea.area));
  check('a mission with a published area reports area', withArea.areaState === 'area');
}

// The detail and the library map must never disagree about what is locatable.
const AREA_MATRIX: Array<{ label: string; approxLocation: unknown }> = [
  { label: 'absent', approxLocation: undefined },
  { label: 'null', approxLocation: null },
  { label: 'empty object', approxLocation: {} },
  { label: 'NaN lat', approxLocation: { lat: NaN, lng: 35 } },
  { label: 'string coords', approxLocation: { lat: '31.7', lng: '35.2' } },
  { label: 'out of range lat', approxLocation: { lat: 931, lng: 35 } },
  { label: 'out of range lng', approxLocation: { lat: 31, lng: 935 } },
  { label: 'valid', approxLocation: { lat: 31.7, lng: 35.2 } },
  { label: 'null island', approxLocation: { lat: 0, lng: 0 } },
];
for (const { label, approxLocation } of AREA_MATRIX) {
  const doc = { ...FULL, approxLocation } as Record<string, unknown>;
  const detail = buildGalleryTaskDetail(doc);
  const plottable = isPlottablePublicTask(doc as { approxLocation?: { lat?: unknown; lng?: unknown } });
  check(`area agrees with isPlottablePublicTask for "${label}"`,
    (detail.area !== null) === plottable,
    `detail=${detail.area !== null} map=${plottable}`);
  check(`areaState matches area for "${label}"`,
    detail.areaState === (detail.area !== null ? 'area' : 'no-area'));
}

// ─── 3. Rows: order and suppression ───────────────────────────────────────────
{
  const detail = buildGalleryTaskDetail(FULL);
  const keys = rowKeys(detail);
  check('a complete mission yields every documented row',
    JSON.stringify(keys) === JSON.stringify([...GALLERY_DETAIL_ROW_ORDER]),
    keys.join(','));
  check('the type row always leads', keys[0] === 'type');
  check('rows never repeat a key', new Set(keys).size === keys.length);
}

const SUPPRESSION: Array<{ label: string; patch: Record<string, unknown>; gone: string }> = [
  { label: 'non-finite difficulty', patch: { difficulty: NaN }, gone: 'difficulty' },
  { label: 'string difficulty', patch: { difficulty: 'hard' }, gone: 'difficulty' },
  { label: 'zero estimated minutes', patch: { estimatedMinutes: 0 }, gone: 'estimatedMinutes' },
  { label: 'negative estimated minutes', patch: { estimatedMinutes: -3 }, gone: 'estimatedMinutes' },
  { label: 'NaN estimated minutes', patch: { estimatedMinutes: NaN }, gone: 'estimatedMinutes' },
  { label: 'absent estimated minutes', patch: { estimatedMinutes: undefined }, gone: 'estimatedMinutes' },
  { label: 'non-finite points', patch: { pointValue: Infinity }, gone: 'points' },
  { label: 'absent points', patch: { pointValue: undefined }, gone: 'points' },
  { label: 'zero likes', patch: { likeCount: 0 }, gone: 'likes' },
  { label: 'absent likes', patch: { likeCount: undefined }, gone: 'likes' },
  { label: 'negative likes', patch: { likeCount: -4 }, gone: 'likes' },
  { label: 'blank source game', patch: { sourceGameTitle: '   ' }, gone: 'source' },
  { label: 'absent source game', patch: { sourceGameTitle: undefined }, gone: 'source' },
  { label: 'blank author', patch: { ownerDisplayName: '' }, gone: 'author' },
  { label: 'absent author', patch: { ownerDisplayName: undefined }, gone: 'author' },
  { label: 'unparseable createdAt', patch: { createdAt: 'not a date' }, gone: 'published' },
  { label: 'absent createdAt', patch: { createdAt: undefined }, gone: 'published' },
  { label: 'numeric createdAt', patch: { createdAt: 12345 }, gone: 'published' },
];
for (const { label, patch, gone } of SUPPRESSION) {
  const detail = buildGalleryTaskDetail({ ...FULL, ...patch });
  check(`${label} suppresses the ${gone} row`, !rowKeys(detail).includes(gone as never),
    rowKeys(detail).join(','));
  check(`${label} still yields the type row`, rowKeys(detail).includes('type' as never));
}

// The copies row is never suppressed: "0 copies" is a real signal about a mission.
for (const copyCount of [undefined, 0, -7, NaN, 'lots']) {
  const detail = buildGalleryTaskDetail({ ...FULL, copyCount });
  check(`copies row survives copyCount=${String(copyCount)}`, rowKeys(detail).includes('copies' as never));
  const v = rowValue(detail, 'copies');
  check(`copies value is a non-negative integer for copyCount=${String(copyCount)}`,
    typeof v === 'number' && Number.isInteger(v) && v >= 0, String(v));
}

// ─── 4. Normalization: nothing malformed can reach the DOM ────────────────────
for (const [input, expected] of [[0, 1], [1, 1], [6, 6], [10, 10], [99, 10], [-4, 1], [6.4, 6], [6.6, 7]] as const) {
  const detail = buildGalleryTaskDetail({ ...FULL, difficulty: input });
  check(`difficulty ${input} clamps to ${expected}`, rowValue(detail, 'difficulty') === expected,
    String(rowValue(detail, 'difficulty')));
}
for (const [input, expected] of [[-5, 0], [0, 0], [150, 150], [12.7, 13]] as const) {
  const detail = buildGalleryTaskDetail({ ...FULL, pointValue: input });
  check(`pointValue ${input} normalizes to ${expected}`, rowValue(detail, 'points') === expected,
    String(rowValue(detail, 'points')));
}
{
  const detail = buildGalleryTaskDetail(FULL);
  check('createdAt normalizes to a calendar date', rowValue(detail, 'published') === '2026-03-04',
    String(rowValue(detail, 'published')));
}
{
  const detail = buildGalleryTaskDetail({ ...FULL, estimatedMinutes: 7.4 });
  const v = rowValue(detail, 'estimatedMinutes');
  check('estimated minutes stay a finite positive number', typeof v === 'number' && Number.isFinite(v) && v > 0,
    String(v));
}

// Sweep: NO row value is ever NaN, and no numeric row value is ever negative.
const MUTANTS: Record<string, unknown>[] = [
  {}, { difficulty: NaN }, { pointValue: NaN }, { estimatedMinutes: NaN }, { copyCount: NaN },
  { likeCount: NaN }, { difficulty: -1, pointValue: -1, copyCount: -1, likeCount: -1 },
  { difficulty: 'x', pointValue: 'y', copyCount: 'z', likeCount: 'w' },
  { title: undefined, description: undefined, type: undefined },
];
for (const patch of MUTANTS) {
  const detail = buildGalleryTaskDetail({ ...FULL, ...patch });
  const bad = detail.rows.filter(
    (r) => (typeof r.value === 'number' && (!Number.isFinite(r.value) || r.value < 0)) ||
      (typeof r.value === 'string' && (r.value === 'NaN' || r.value.trim() === '')),
  );
  check(`no malformed row value for patch ${JSON.stringify(patch)}`, bad.length === 0,
    JSON.stringify(bad));
}

// ─── 5. Title / description ───────────────────────────────────────────────────
for (const [description, expected] of [
  ['A real description.', 'A real description.'],
  ['   ', null],
  ['', null],
  [undefined, null],
  [42, null],
] as const) {
  const detail = buildGalleryTaskDetail({ ...FULL, description });
  check(`description ${JSON.stringify(description)} reports ${JSON.stringify(expected)}`,
    detail.description === expected, JSON.stringify(detail.description));
}
{
  const detail = buildGalleryTaskDetail({ ...FULL, title: undefined });
  check('an absent title yields an empty string, never undefined', detail.title === '');
  const d2 = buildGalleryTaskDetail({ ...FULL, title: '  Trimmed  ' });
  check('a title is trimmed', d2.title === 'Trimmed', JSON.stringify(d2.title));
}

// ─── 6. Type key ──────────────────────────────────────────────────────────────
const TYPES = ['field', 'self_report', 'smart_station', 'photo', 'quiz', 'numeric',
  'geofence', 'sequence', 'survey'];
for (const type of TYPES) {
  check(`type "${type}" round-trips`, galleryTaskTypeKey(type) === type);
  check(`type "${type}" reaches the type row`, rowValue(buildGalleryTaskDetail({ ...FULL, type }), 'type') === type);
}
for (const bad of [undefined, null, '', '   ', 'teleport', 42, {}, [], 'QUIZ']) {
  check(`type ${JSON.stringify(bad)} falls back to "unknown"`, galleryTaskTypeKey(bad) === 'unknown',
    String(galleryTaskTypeKey(bad)));
}

// ─── 7. Tags ──────────────────────────────────────────────────────────────────
for (const [tags, expected] of [
  [['a', 'b'], ['a', 'b']],
  [[], []],
  [undefined, []],
  ['history', []],
  [['a', '', '   ', 'b', 7, null], ['a', 'b']],
] as const) {
  const detail = buildGalleryTaskDetail({ ...FULL, tags });
  check(`tags ${JSON.stringify(tags)} normalize to ${JSON.stringify(expected)}`,
    JSON.stringify(detail.tags) === JSON.stringify(expected), JSON.stringify(detail.tags));
}

// ─── 8. Totality: it runs on a callable response, it must never throw ─────────
for (const junk of [null, undefined, 42, 'x', [], {}, true, NaN, () => 0]) {
  let detail: GalleryTaskDetail | null = null;
  let threw = false;
  try { detail = buildGalleryTaskDetail(junk); } catch { threw = true; }
  check(`buildGalleryTaskDetail(${JSON.stringify(junk) ?? String(junk)}) does not throw`, !threw);
  check(`  ...and yields a well-formed detail`,
    !!detail && typeof detail.title === 'string' && typeof detail.typeKey === 'string' &&
    Array.isArray(detail.rows) && Array.isArray(detail.tags) &&
    (detail.areaState === 'area' || detail.areaState === 'no-area'));
}

// ─── 9. Wiring guards (source scans) ──────────────────────────────────────────
const modal = read('apps', 'creator-web', 'src', 'components', 'GalleryTaskDetailModal.tsx');
for (const name of ['answers', 'numericAnswer', 'secretCode', 'hintPenalty']) {
  check(`the detail modal never mentions "${name}"`, !modal.includes(name));
}
check('the detail modal never reads an exact coordinate', !/\.coordinates\b/.test(modal));
check('the detail modal renders rows from the view model', modal.includes('detail.rows'));
// Either `lazy(() => import(...))` or the retrying wrapper
// `lazyWithRetry('<key>', () => import(...))` (change: creator-web chunk guard) —
// what matters is that MapLibre is behind a dynamic import, not which helper does it.
check('the detail modal loads the map lazily',
  /lazy(?:WithRetry)?\(\s*(?:'[^']*'\s*,\s*)?\(\s*\)\s*=>\s*import\(/.test(modal));
check('the detail modal closes on Escape', modal.includes('Escape'));
check('the detail modal is announced as a dialog',
  modal.includes('role="dialog"') && modal.includes('aria-modal'));

const galleryPage = read('apps', 'creator-web', 'src', 'pages', 'GalleryPage.tsx');
check('the gallery opens the detail modal', galleryPage.includes('GalleryTaskDetailModal'));
const taskLibrary = read('apps', 'creator-web', 'src', 'components', 'TaskLibrary.tsx');
check('the builder mission library opens the detail modal', taskLibrary.includes('GalleryTaskDetailModal'));
check('the builder library passes the use action', /onUse=/.test(taskLibrary));

const i18n = read('apps', 'creator-web', 'src', 'i18n.ts');
const NEW_KEYS = [
  'detailTitle', 'detailClose', 'detailOpen', 'detailUse', 'detailUseHint', 'detailNoDescription',
  'detailAreaTitle', 'detailNoArea', 'detailSecretNote', 'detailAboutTitle',
  'rowType', 'rowDifficulty', 'rowMinutes', 'rowPoints', 'rowCopies', 'rowLikes',
  'rowSource', 'rowAuthor', 'rowPublished', 'valDiff', 'valMinutes',
  'typeAboutField', 'typeAboutSelfReport', 'typeAboutStation', 'typeAboutPhoto', 'typeAboutQuiz',
  'typeAboutNumeric', 'typeAboutGeofence', 'typeAboutSequence', 'typeAboutSurvey', 'typeAboutUnknown',
];
for (const key of NEW_KEYS) {
  const hits = i18n.split(`${key}:`).length - 1;
  check(`creator-web i18n defines ${key} in BOTH languages`, hits >= 2, `${hits} occurrence(s)`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

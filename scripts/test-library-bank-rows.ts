// Pure-logic tests for the mission bank's library projection
// (change: mission-bank-in-library).
//
// The motivating gap: the task library lists `publicTasks`, which exist ONLY
// after some creator publishes a game. The ~89 hand-authored bank missions — the
// best-written content on the platform, and the only content a brand-new project
// has at all — were reachable from "compose one for me" and from nowhere else. A
// creator building a game by hand saw an empty library.
//
// The risk the fix introduces is the mirror image of the one
// `test-gallery-task-detail.ts` was written for. A `publicTasks` document is a
// SANITIZED projection written by `publishGame`; a `TaskBankEntry.build()` is the
// FULL authored mission — secret codes, quiz answer keys, numeric answers, hint
// text, sequence step answers, real coordinates. Putting the bank on a screen that
// has only ever rendered sanitized documents means the projection is now the ONLY
// thing standing between an answer key and the DOM. So the same discipline
// applies: COPY OUT by name, never spread, and prove it by sweeping.
//
// Five properties are asserted throughout:
//   1. NEVER LEAKS  — a bank entry whose build() carries every server-secret field
//      yields a row containing none of those key NAMES and none of those VALUES,
//      at any depth. Swept against the real TASK_BANK too, not just a fixture.
//   2. NEVER THROWS — the library is a modal over a Firestore-backed list; a throw
//      blanks the Builder behind the ErrorBoundary. A build() that throws, and a
//      malformed entry, both yield null.
//   3. DE-DUPLICATES — a bank mission already published as a publicTask is shown
//      once, as the published row.
//   4. RANKS AS ONE LIST — relevance first, popularity as the tiebreak, using the
//      SAME adapter `searchTaskLibrary` uses server-side (so a published row that
//      matched only on its source game title is not dropped by the client re-rank).
//   5. IS WIRED — both library mounts really read the live bank, and the badge
//      copy exists in both languages.
//
//   npx tsx scripts/test-library-bank-rows.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Task } from '../packages/shared/src/types';
import { SECRET_TASK_FIELD_NAMES } from '../apps/creator-web/src/lib/galleryTaskDetail';
import { TASK_BANK, type TaskBankEntry } from '../apps/creator-web/src/taskBank';
import {
  bankEntryToLibraryRow,
  bankRowsFor,
  normalizeLibraryTitle,
  mergeLibraryRows,
  filterBankRowsByFacets,
  BANK_ROW_ID_PREFIX,
  type LibraryRow,
} from '../apps/creator-web/src/lib/libraryBankRows';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, '..', ...p), 'utf8');

/**
 * Source with comments removed.
 *
 * A "does this file contain X" check that reads raw source answers a different
 * question than it claims: this module's own header DOCUMENTS the forbidden
 * `...built` spread in order to forbid it, and a naive grep read that as the
 * defect. A check that fires on its own documentation trains people to delete the
 * documentation. Strings are left alone — none of the patterns swept for here can
 * appear in one without being the real thing.
 */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Distinctive sentinels, so a VALUE sweep can find a leak wherever it landed. */
const SECRET_CODE = 'SENTINEL-SECRET-CODE-9137';
const QUIZ_ANSWER = 'SENTINEL-QUIZ-ANSWER-9137';
const HINT_TEXT = 'SENTINEL-HINT-TEXT-9137';
const STEP_ANSWER = 'SENTINEL-STEP-ANSWER-9137';
const NUMERIC_ANSWER = 424242;
const EXACT_LAT = 31.776731;
const EXACT_LNG = 35.233873;

/** A bank entry carrying EVERY kind of secret a real mission can hold. */
const LOADED: TaskBankEntry = {
  key: 'sentinel-loaded',
  sourceTemplateKey: 'test',
  tags: ['thinking', 'outdoor'],
  difficulty: 7,
  build: (): Task => ({
    id: 'built-id-should-not-survive',
    title: 'Brass lion hunt',
    description: 'Find the brass lion and read what is under it.',
    type: 'smart_station',
    coordinates: { lat: EXACT_LAT, lng: EXACT_LNG },
    difficulty: 7,
    estimatedMinutes: 12,
    pointValue: 150,
    maxConcurrentTeams: 1,
    hint: HINT_TEXT,
    hintPenalty: 25,
    answers: [QUIZ_ANSWER],
    numericAnswer: NUMERIC_ANSWER,
    numericTolerance: 3,
    steps: [{ id: 's1', prompt: 'first', answer: STEP_ANSWER }],
    smart: { enabled: true, verificationType: 'code_verification', secretCode: SECRET_CODE },
  } as unknown as Task),
};

const SIMPLE: TaskBankEntry = {
  key: 'sentinel-simple',
  sourceTemplateKey: 'test',
  tags: ['teamwork'],
  difficulty: 3,
  build: (): Task => ({
    id: 'x', title: 'Team photo', description: 'Everyone in one frame.',
    type: 'photo', coordinates: { lat: 0, lng: 0 }, difficulty: 3,
    estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 100, locationless: true,
  } as unknown as Task),
};

const EXPLODING: TaskBankEntry = {
  key: 'sentinel-exploding',
  sourceTemplateKey: 'test',
  tags: ['teamwork'],
  difficulty: 4,
  build: (): Task => { throw new Error('build blew up'); },
};

/** Every string/number reachable anywhere in `value`. */
function deepValues(value: unknown, out: unknown[] = []): unknown[] {
  if (value === null || value === undefined) return out;
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) deepValues(v, out);
    return out;
  }
  out.push(value);
  return out;
}

/** Every key name reachable anywhere in `value`. */
function deepKeys(value: unknown, out: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(k);
    deepKeys(v, out);
  }
  return out;
}

// ─── 1. The projection never leaks ────────────────────────────────────────────

const loaded = bankEntryToLibraryRow(LOADED, 'he');
check('a loaded bank entry still yields a row', loaded !== null);

if (loaded) {
  const keys = deepKeys(loaded);
  for (const secret of SECRET_TASK_FIELD_NAMES) {
    check(`the row carries no "${secret}" key at any depth`, !keys.includes(secret));
  }

  const values = deepValues(loaded);
  const leaked = [SECRET_CODE, QUIZ_ANSWER, HINT_TEXT, STEP_ANSWER, NUMERIC_ANSWER, EXACT_LAT, EXACT_LNG]
    .filter((v) => values.includes(v));
  check('the row carries no secret VALUE at any depth', leaked.length === 0, JSON.stringify(leaked));

  // The exact authored point must not reappear as a public area either: a bank
  // mission is unplaced by definition — the creator drops its pin per event.
  check('a bank row publishes no approxLocation', loaded.approxLocation === undefined);
  check('a bank row publishes no coordinates', (loaded as { coordinates?: unknown }).coordinates === undefined);
}

// ─── 2. The projection copies the fields the library renders ──────────────────

if (loaded) {
  check('bankKey is the entry key', loaded.bankKey === LOADED.key);
  check('the row id is namespaced', loaded.id === `${BANK_ROW_ID_PREFIX}${LOADED.key}`);
  check('the built task id does not become the row id', !loaded.id.includes('built-id'));
  check('title is copied', loaded.title === 'Brass lion hunt');
  check('description is copied', loaded.description === 'Find the brass lion and read what is under it.');
  check('type is copied', loaded.type === 'smart_station');
  check('difficulty is copied', loaded.difficulty === 7);
  check('estimatedMinutes is copied', loaded.estimatedMinutes === 12);
  check('pointValue is copied', loaded.pointValue === 150);
  check('counters read as unpublished', loaded.copyCount === 0 && loaded.likeCount === 0 && loaded.popularity === 0);
  check('no source game is claimed', !loaded.sourceGameTitle && !loaded.sourceGameId);
  check('createdAt is not a fake publish date', !loaded.createdAt);
}

// Tags are localized through the bank's own vocabulary, not shown as raw ids:
// `locationBased` in a Hebrew list is exactly the "English in the Hebrew Builder"
// bug the i18n gate exists for, and a data-borne one no checker would catch.
const heTags = bankEntryToLibraryRow(LOADED, 'he')?.tags ?? [];
const enTags = bankEntryToLibraryRow(LOADED, 'en')?.tags ?? [];
check('tags are localized per language', heTags.length === 2 && enTags.length === 2 && heTags.join() !== enTags.join(),
  `${heTags.join('|')} vs ${enTags.join('|')}`);
check('tags are not raw bank ids in Hebrew', !heTags.includes('thinking'));

// ─── 3. Totality ──────────────────────────────────────────────────────────────

check('a build() that throws yields null, not an exception', bankEntryToLibraryRow(EXPLODING, 'he') === null);
for (const junk of [null, undefined, 42, 'x', [], {}]) {
  let threw = false;
  let result: unknown;
  try { result = bankEntryToLibraryRow(junk as unknown as TaskBankEntry, 'he'); } catch { threw = true; }
  check(`a malformed entry (${JSON.stringify(junk)}) yields null without throwing`, !threw && result === null);
}
check('bankRowsFor tolerates a non-array', bankRowsFor(null as unknown as TaskBankEntry[], 'he').length === 0);
check('bankRowsFor drops the entries it cannot build',
  bankRowsFor([SIMPLE, EXPLODING, LOADED], 'he').length === 2);

// ─── 4. The REAL bank projects cleanly ────────────────────────────────────────

const realRows = bankRowsFor(TASK_BANK, 'he');
check('every authored bank entry yields a row', realRows.length === TASK_BANK.length,
  `${realRows.length}/${TASK_BANK.length}`);
check('every real row has a title', realRows.every((r) => typeof r.title === 'string' && r.title.trim() !== ''));
check('every real row has a usable difficulty',
  realRows.every((r) => Number.isFinite(r.difficulty) && r.difficulty >= 1 && r.difficulty <= 10));
check('every real row id is unique', new Set(realRows.map((r) => r.id)).size === realRows.length);

const realKeys = new Set(realRows.flatMap((r) => deepKeys(r)));
for (const secret of SECRET_TASK_FIELD_NAMES) {
  check(`no real bank row carries "${secret}"`, !realKeys.has(secret));
}
check('no real bank row claims a location', realRows.every((r) => r.approxLocation === undefined));

// ─── 5. De-duplication ────────────────────────────────────────────────────────

check('normalizeLibraryTitle folds case and whitespace',
  normalizeLibraryTitle('  Brass   LION  hunt ') === normalizeLibraryTitle('brass lion hunt'));
check('normalizeLibraryTitle is total', normalizeLibraryTitle(null) === '' && normalizeLibraryTitle(42) === '');

const published = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  id: 'pt-1', sourceGameId: 'g-1', sourceGameTitle: 'Old City Treasure Hunt',
  ownerUid: 'owner-1', title: 'Brass lion hunt', description: 'A published copy.',
  type: 'smart_station', difficulty: 7, estimatedMinutes: 12, pointValue: 150,
  copyCount: 5, likeCount: 2, popularity: 1.5, createdAt: '2026-05-01T00:00:00.000Z',
  ...over,
} as LibraryRow);

const dedup = mergeLibraryRows([published()], [loaded as LibraryRow], '');
check('a published twin suppresses the bank row', dedup.length === 1 && dedup[0].bankKey === undefined);

const differentType = mergeLibraryRows([published({ type: 'photo' })], [loaded as LibraryRow], '');
check('same title but a different type is NOT a duplicate', differentType.length === 2);

const differentTitle = mergeLibraryRows([published({ title: 'Something else' })], [loaded as LibraryRow], '');
check('a different title is NOT a duplicate', differentTitle.length === 2);

check('the published row survives when nothing matches it',
  mergeLibraryRows([published()], [], '').length === 1);
check('bank rows alone still merge', mergeLibraryRows([], [loaded as LibraryRow], '').length === 1);
check('mergeLibraryRows is total on junk input',
  mergeLibraryRows(null as unknown as LibraryRow[], undefined as unknown as LibraryRow[], '').length === 0);

// ─── 6. Interleaved ranking ───────────────────────────────────────────────────

const bankSimple = bankEntryToLibraryRow(SIMPLE, 'he') as LibraryRow;

// Empty query: real usage wins. A bank row scores 0 on every engagement term.
const byPopularity = mergeLibraryRows([published({ title: 'City walk' })], [bankSimple], '');
check('with no query, a used published mission outranks a bank mission',
  byPopularity[0].bankKey === undefined, byPopularity.map((r) => r.id).join(' > '));

// A query the bank row's TITLE starts with (tier 3) beats a published row that
// only mentions it in its description (tier 1), however popular that row is.
const weakMatch = published({ title: 'City walk', description: 'we take a team photo here', popularity: 99, copyCount: 99 });
const byRelevance = mergeLibraryRows([weakMatch], [bankSimple], 'team photo');
check('a query matching a bank title lifts it above a weaker-matching published row',
  byRelevance[0].bankKey === SIMPLE.key, byRelevance.map((r) => r.title).join(' > '));

// The client re-rank must use the SAME adapter the server used, or it silently
// drops published rows that the server matched on a field the client forgot.
const bySourceTitle = mergeLibraryRows([published({ title: 'Nothing alike', description: 'nor here' })], [], 'Old City');
check('a published row matched on its source game title survives the client re-rank',
  bySourceTitle.length === 1, `${bySourceTitle.length} row(s)`);
const simpleTag = bankSimple.tags?.[0] ?? '';
const byTag = mergeLibraryRows([], [bankSimple], simpleTag);
check('a bank row matched on its own tag survives', simpleTag !== '' && byTag.length === 1, simpleTag);

// ─── 7. Facets ────────────────────────────────────────────────────────────────

const facetPool = bankRowsFor([SIMPLE, LOADED], 'he');
check('hasLocation:true drops every bank row (none is placed)',
  filterBankRowsByFacets(facetPool, { hasLocation: true }).length === 0);
check('hasLocation:false keeps them', filterBankRowsByFacets(facetPool, { hasLocation: false }).length === 2);
check('type narrows', filterBankRowsByFacets(facetPool, { type: 'photo' }).map((r) => r.bankKey).join() === SIMPLE.key);
check('difficulty is at-least', filterBankRowsByFacets(facetPool, { difficulty: 5 }).map((r) => r.bankKey).join() === LOADED.key);
check('empty facets are the identity', filterBankRowsByFacets(facetPool, {}).length === 2);
check('filterBankRowsByFacets is total', filterBankRowsByFacets(null as unknown as LibraryRow[], null).length === 0);

// Tags are matched against the row's LOCALIZED labels, because that is what the
// gallery's tag chips put in the facet.
const tag = heTags[0];
check('a tag facet narrows to rows carrying it',
  filterBankRowsByFacets(facetPool, { tags: [tag] }).every((r) => r.tags?.includes(tag)));
check('a tag facet nothing carries yields nothing',
  filterBankRowsByFacets(facetPool, { tags: ['תג-שלא-קיים'] }).length === 0);

// ─── 8. Wiring ────────────────────────────────────────────────────────────────

const taskLibrary = read('apps', 'creator-web', 'src', 'components', 'TaskLibrary.tsx');
check('the Builder library loads the live mission bank', taskLibrary.includes('loadMissionBank'));
check('the Builder library merges bank rows', taskLibrary.includes('mergeLibraryRows'));
check('the Builder library builds a fresh task from the bank entry', /\.build\(\)/.test(taskLibrary));
check('the Builder library does not bump copyCount for a bank row',
  /bankKey/.test(taskLibrary) && taskLibrary.indexOf('bankKey') < taskLibrary.indexOf('incrementTaskCopyCount('));

const galleryPage = read('apps', 'creator-web', 'src', 'pages', 'GalleryPage.tsx');
check('the Gallery task tab loads the live mission bank', galleryPage.includes('loadMissionBank'));
check('the Gallery task tab merges bank rows', galleryPage.includes('mergeLibraryRows'));
check('the Gallery task tab applies the facets to bank rows', galleryPage.includes('filterBankRowsByFacets'));

// The whole point of the change: nothing is seeded, so no writer may appear.
const bankRowsCode = codeOf(read('apps', 'creator-web', 'src', 'lib', 'libraryBankRows.ts'));
check('the projection writes nothing to Firestore',
  !/\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(bankRowsCode));
// The secrecy mechanism is copy-out; a spread of the built task would defeat the
// whole sweep above by construction, so it is refused structurally too.
check('the projection never spreads the built task or the entry',
  !/\.\.\.\s*(built|entry|task)\b/.test(bankRowsCode));

const i18n = read('apps', 'creator-web', 'src', 'i18n.ts');
for (const key of ['bankRowBadge', 'bankRowBadgeHelp', 'bankRowSource']) {
  const hits = i18n.split(`${key}:`).length - 1;
  check(`creator-web i18n defines ${key} in BOTH languages`, hits >= 2, `${hits} occurrence(s)`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

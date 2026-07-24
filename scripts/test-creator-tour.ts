// Pure-logic tests — the creator console's first-run guided tour
// (change: creator-guided-tour).
//
// The tour is DATA: an ordered step table, a reducer, and a handful of pure
// resolvers. Nothing here touches React, the DOM, Firebase or localStorage — the
// component only *reads* these decisions, so "what does the creator see after the
// Builder steps in free mode?" is an assertion, not a code read.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  TOUR_STEPS,
  TOUR_VERSION,
  INITIAL_TOUR_STATE,
  buildTourSteps,
  tourReducer,
  currentTourStep,
  tourProgress,
  tourStorageKey,
  readTourRecord,
  writeTourRecord,
  tourRecordFor,
  shouldAutoStartTour,
  resolveTourAnchoring,
  tourStepTarget,
  tourCardPosition,
  ONBOARDING_DISMISSED_KEY,
  KNOWN_GAME_COUNT_KEY,
  knownGameCountKey,
  isEstablishedCreator,
  PREVIEWED_STORAGE_KEY,
  type TourState,
  type TourStepId,
  type TourSurface,
} from '../apps/creator-web/src/lib/creatorOnboarding';
import { translations } from '../apps/creator-web/src/i18n';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const ALL = buildTourSteps({ paymentsEnabled: true });
const ids = ALL.map((s) => s.id);
const last = ALL.length - 1;

// A running state at a given index, without depending on how many `next`es it takes.
function at(index: number): TourState {
  return { status: 'running', index };
}

console.log('\n── 1. step table integrity ─────────────────────────────────');
ok('TOUR_STEPS is a non-empty ordered table', Array.isArray(TOUR_STEPS as unknown[]) && TOUR_STEPS.length > 0);
ok('every step id is unique', new Set(ids).size === ids.length);
eq('buildTourSteps preserves the declared order', ids, TOUR_STEPS.map((s) => s.id));
const SURFACES: TourSurface[] = ['dashboard', 'builder', 'run', 'gallery', 'wallet', 'settings', 'anywhere'];
ok('every step declares a known surface', ALL.every((s) => SURFACES.includes(s.surface)));
ok('every anchor is null or a non-empty string',
  ALL.every((s) => s.anchor === null || (typeof s.anchor === 'string' && s.anchor.length > 0)));
ok('every step declares a placement',
  ALL.every((s) => ['top', 'bottom', 'start', 'end', 'center'].includes(s.placement)));
eq('exactly one payments-only step', ALL.filter((s) => s.requiresPayments).length, 1);
ok('the first step is a centred welcome', ALL[0].anchor === null && ALL[0].surface === 'anywhere');
ok('the last step is a centred wrap-up', ALL[last].anchor === null && ALL[last].surface === 'anywhere');

console.log('\n── 2. feature coverage (the owner brief) ───────────────────');
const has = (id: string) => ids.includes(id as TourStepId);
for (const required of [
  'welcome', 'newGame', 'gameList',
  'builderStages', 'builderTasks', 'builderTaskTypes', 'builderLocation',
  'builderScoring', 'builderPreview', 'builderLaunch',
  'runConsole', 'gallery', 'wallet', 'settings', 'finish',
]) {
  ok(`covers "${required}"`, has(required));
}
for (const surface of ['dashboard', 'builder', 'run', 'gallery', 'settings'] as TourSurface[]) {
  ok(`the ${surface} surface is represented`, ALL.some((s) => s.surface === surface));
}
ok('the builder gets the most steps (it is the deepest surface)',
  ALL.filter((s) => s.surface === 'builder').length >= 7);

console.log('\n── 3. payments filtering ───────────────────────────────────');
const free = buildTourSteps({ paymentsEnabled: false });
eq('free mode is exactly one step shorter', free.length, ALL.length - 1);
ok('free mode drops the wallet step', !free.some((s) => s.requiresPayments));
eq('free mode keeps the relative order',
  free.map((s) => s.id), ids.filter((id) => id !== 'wallet'));

console.log('\n── 4. i18n copy exists for every step, in both languages ───');
for (const lang of ['he', 'en'] as const) {
  const dict = (translations[lang] as unknown as { tour: { steps: Record<string, { title: string; body: string }> } }).tour;
  ok(`[${lang}] a tour block exists`, !!dict && !!dict.steps);
  for (const step of TOUR_STEPS) {
    const copy = dict?.steps?.[step.id];
    ok(`[${lang}] "${step.id}" has a title and a body`,
      !!copy && typeof copy.title === 'string' && copy.title.trim().length > 0
      && typeof copy.body === 'string' && copy.body.trim().length > 0);
  }
}
{
  const heKeys = Object.keys((translations.he as unknown as { tour: { steps: Record<string, unknown> } }).tour.steps).sort();
  const enKeys = Object.keys((translations.en as unknown as { tour: { steps: Record<string, unknown> } }).tour.steps).sort();
  eq('both dictionaries carry the same step ids', heKeys, enKeys);
  eq('the dictionaries carry exactly the declared steps', heKeys, [...TOUR_STEPS.map((s) => s.id)].sort());
}

console.log('\n── 5. reducer transitions ──────────────────────────────────');
eq('the initial state is idle at 0', INITIAL_TOUR_STATE, { status: 'idle', index: 0 });
eq('start from idle runs at step 0',
  tourReducer(INITIAL_TOUR_STATE, { type: 'start' }, ALL), { status: 'running', index: 0 });
eq('next advances', tourReducer(at(0), { type: 'next' }, ALL), { status: 'running', index: 1 });
eq('back retreats', tourReducer(at(2), { type: 'back' }, ALL), { status: 'running', index: 1 });
eq('back at 0 is a no-op', tourReducer(at(0), { type: 'back' }, ALL), { status: 'running', index: 0 });
eq('next at the last step completes without overflowing',
  tourReducer(at(last), { type: 'next' }, ALL), { status: 'completed', index: last });
eq('skip from the FIRST step ends the tour',
  tourReducer(at(0), { type: 'skip' }, ALL), { status: 'skipped', index: 0 });
eq('skip from the LAST step is skipped, not completed',
  tourReducer(at(last), { type: 'skip' }, ALL), { status: 'skipped', index: last });
eq('restart replays from 0 after skipping',
  tourReducer({ status: 'skipped', index: 4 }, { type: 'restart' }, ALL), { status: 'running', index: 0 });
eq('restart replays from 0 after completing',
  tourReducer({ status: 'completed', index: last }, { type: 'restart' }, ALL), { status: 'running', index: 0 });
eq('start cannot replay a skipped tour',
  tourReducer({ status: 'skipped', index: 3 }, { type: 'start' }, ALL), { status: 'skipped', index: 3 });
eq('start cannot replay a completed tour',
  tourReducer({ status: 'completed', index: last }, { type: 'start' }, ALL), { status: 'completed', index: last });
eq('next on a non-running state is inert',
  tourReducer({ status: 'skipped', index: 1 }, { type: 'next' }, ALL), { status: 'skipped', index: 1 });
eq('jump clamps above the end', tourReducer(at(0), { type: 'jump', index: 999 }, ALL), { status: 'running', index: last });
eq('jump clamps below zero', tourReducer(at(3), { type: 'jump', index: -7 }, ALL), { status: 'running', index: 0 });
eq('jump ignores a non-finite index', tourReducer(at(3), { type: 'jump', index: NaN }, ALL), { status: 'running', index: 3 });

console.log('\n── 6. reducer safety ───────────────────────────────────────');
{
  const frozen = Object.freeze({ status: 'running', index: 1 }) as TourState;
  const out = tourReducer(frozen, { type: 'next' }, ALL);
  ok('the input state is never mutated', frozen.index === 1 && out !== frozen);
  const empty = tourReducer({ status: 'running', index: 0 }, { type: 'next' }, []);
  ok('an empty step list never yields an out-of-range index', empty.index === 0 && empty.status === 'completed');
  ok('currentTourStep on an empty list is null', currentTourStep({ status: 'running', index: 0 }, []) === null);
}
ok('currentTourStep is null while idle', currentTourStep(INITIAL_TOUR_STATE, ALL) === null);
ok('currentTourStep is null once skipped', currentTourStep({ status: 'skipped', index: 2 }, ALL) === null);
ok('currentTourStep is null once completed', currentTourStep({ status: 'completed', index: last }, ALL) === null);
eq('currentTourStep returns the indexed step while running', currentTourStep(at(2), ALL)?.id, ALL[2].id);
eq('progress is one-based and bounded', tourProgress(at(0), ALL), { step: 1, total: ALL.length });
eq('progress at the end', tourProgress(at(last), ALL), { step: ALL.length, total: ALL.length });

console.log('\n── 7. persistence parsers ──────────────────────────────────');
{
  const rec = { version: TOUR_VERSION, status: 'skipped' as const, lastStepId: 'builderTasks' as TourStepId };
  eq('a record round-trips', readTourRecord(writeTourRecord(rec)), rec);
  for (const bad of [null, undefined, '', '   ', '{', '[]', '[1,2]', '"str"', '{"status":"nope"}', '{"version":"x","status":"skipped"}', '{}']) {
    ok(`malformed input yields null: ${JSON.stringify(bad)}`, readTourRecord(bad as string | null) === null);
  }
  const older = readTourRecord(JSON.stringify({ version: TOUR_VERSION - 1, status: 'completed' }));
  ok('an OLDER version still parses (it counts as seen)', older !== null);
  const newer = readTourRecord(JSON.stringify({ version: TOUR_VERSION + 5, status: 'completed' }));
  ok('a NEWER version still parses (it counts as seen)', newer !== null);
}
{
  const a = tourStorageKey('uid-a');
  const b = tourStorageKey('uid-b');
  ok('keys are uid scoped and distinct', a !== b && a.includes('uid-a') && b.includes('uid-b'));
  ok('a blank uid still yields a stable key', typeof tourStorageKey('') === 'string' && tourStorageKey('').length > 0);
  ok('the key never collides with the checklist keys',
    ![ONBOARDING_DISMISSED_KEY, KNOWN_GAME_COUNT_KEY, PREVIEWED_STORAGE_KEY].includes(a));
}
ok('nothing is stored while idle', tourRecordFor(INITIAL_TOUR_STATE, ALL) === null);
ok('nothing is stored while running', tourRecordFor(at(3), ALL) === null);
eq('a skipped tour stores where it stopped',
  tourRecordFor({ status: 'skipped', index: 3 }, ALL),
  { version: TOUR_VERSION, status: 'skipped', lastStepId: ALL[3].id });
eq('a completed tour stores the last step',
  tourRecordFor({ status: 'completed', index: last }, ALL),
  { version: TOUR_VERSION, status: 'completed', lastStepId: ALL[last].id });

console.log('\n── 8. auto-start predicate (tour is ON-DEMAND ONLY) ────────');
// change: onboarding-overload-fix — the deep 15-step tour no longer auto-fires
// on a fresh, empty dashboard (its Builder steps described screens with no game
// behind them). The Wave-A checklist is the first-run guide; the tour is reached
// only via the header "?" button. So the predicate is now false for EVERY input.
ok('a brand new creator is NOT auto-greeted (checklist guides first run)',
  shouldAutoStartTour({ record: null, established: false }) === false);
ok('an established account is left alone', shouldAutoStartTour({ record: null, established: true }) === false);
ok('a skipped record is never auto-fired',
  shouldAutoStartTour({ record: { version: TOUR_VERSION, status: 'skipped' }, established: false }) === false);
ok('a completed record is never auto-fired',
  shouldAutoStartTour({ record: { version: TOUR_VERSION, status: 'completed' }, established: false }) === false);
ok('a record from another version is never auto-fired',
  shouldAutoStartTour({ record: { version: TOUR_VERSION + 9, status: 'completed' }, established: false }) === false);
ok('no combination of record/established ever auto-starts the tour',
  [null, { version: TOUR_VERSION, status: 'skipped' as const }, { version: TOUR_VERSION, status: 'completed' as const }]
    .every((record) => [true, false].every((established) =>
      shouldAutoStartTour({ record, established }) === false)));

console.log('\n── 8b. "established" is a fact about the ACCOUNT, not the browser ──');
// (change: post-review-fixes A) The seen-record beside it is uid scoped; the
// established signal was GLOBAL, so a second creator on a browser that already
// held someone else's game count never saw the tour at all. That uid-scoping
// still matters (the checklist reads the same key), even though the tour itself
// no longer auto-starts (change: onboarding-overload-fix).
{
  const a = knownGameCountKey('creator-a');
  const b = knownGameCountKey('creator-b');
  ok('the game-count key is uid scoped and distinct',
    a !== b && a.includes('creator-a') && b.includes('creator-b'));
  ok('a blank uid still yields a stable key',
    typeof knownGameCountKey('') === 'string' && knownGameCountKey('').length > 0);
  ok('the game-count key never collides with the tour record key',
    knownGameCountKey('creator-a') !== tourStorageKey('creator-a'));

  ok('a stored count of 1 marks the account established', isEstablishedCreator('1') === true);
  ok('a stored count of 9 marks the account established', isEstablishedCreator('9') === true);
  ok('a stored count of 0 does NOT mark it established', isEstablishedCreator('0') === false);
  for (const bad of [null, undefined, '', '   ', 'abc', '-3', 'NaN']) {
    ok(`an unreadable count assumes nothing: ${JSON.stringify(bad)}`,
      isEstablishedCreator(bad as string | null) === false);
  }

  // One browser, two creators. The tour is on-demand only now, so NEITHER is
  // auto-greeted regardless of whose game count the browser already holds — the
  // very interruption this change removed.
  const storage: Record<string, string> = { [knownGameCountKey('creator-a')]: '4' };
  const read = (key: string): string | null => storage[key] ?? null;
  const autoStartsFor = (uid: string): boolean => shouldAutoStartTour({
    record: readTourRecord(read(tourStorageKey(uid))),
    established: isEstablishedCreator(read(knownGameCountKey(uid))),
  });
  ok('creator A, already established, is not interrupted', autoStartsFor('creator-a') === false);
  ok('creator B, new on A\'s browser, is not auto-greeted either', autoStartsFor('creator-b') === false);
  storage[tourStorageKey('creator-b')] = writeTourRecord({ version: TOUR_VERSION, status: 'skipped' });
  ok('and a skip record keeps B on-demand only', autoStartsFor('creator-b') === false);
  ok('B\'s record did not touch A', autoStartsFor('creator-a') === false);
}

console.log('\n── 9. anchoring ────────────────────────────────────────────');
{
  const centred = ALL[0];
  const anchored = ALL.find((s) => s.anchor !== null)!;
  eq('a null anchor is always centred', resolveTourAnchoring(centred, true), 'centered');
  eq('a missing element degrades to centred', resolveTourAnchoring(anchored, false), 'centered');
  eq('a present element anchors', resolveTourAnchoring(anchored, true), 'anchored');
}

console.log('\n── 10. navigation targets ──────────────────────────────────');
{
  const ctx = { firstGameId: 'g1', liveRunPath: '/run/g1/r1' };
  const byId = (id: TourStepId) => ALL.find((s) => s.id === id)!;
  eq('dashboard step', tourStepTarget(byId('newGame'), ctx), '/');
  eq('builder step with a game', tourStepTarget(byId('builderTasks'), ctx), '/build/g1');
  eq('builder step with no game', tourStepTarget(byId('builderTasks'), { firstGameId: null, liveRunPath: null }), null);
  eq('gallery step', tourStepTarget(byId('gallery'), ctx), '/gallery');
  eq('wallet step', tourStepTarget(byId('wallet'), ctx), '/wallet');
  eq('settings step', tourStepTarget(byId('settings'), ctx), '/settings');
  eq('run step with a live run', tourStepTarget(byId('runConsole'), ctx), '/run/g1/r1');
  eq('run step with no live run', tourStepTarget(byId('runConsole'), { firstGameId: 'g1', liveRunPath: null }), null);
  eq('an "anywhere" step has no destination', tourStepTarget(byId('welcome'), ctx), null);
}

console.log('\n── 11. card position clamping ──────────────────────────────');
{
  const viewport = { width: 1000, height: 800 };
  const card = { width: 320, height: 200 };
  const inside = (p: { top: number; left: number }) =>
    Number.isFinite(p.top) && Number.isFinite(p.left)
    && p.top >= 0 && p.left >= 0
    && p.top + card.height <= viewport.height + 0.001
    && p.left + card.width <= viewport.width + 0.001;

  const edges = [
    { label: 'top-left', rect: { top: 0, left: 0, width: 40, height: 40 } },
    { label: 'top-right', rect: { top: 0, left: 960, width: 40, height: 40 } },
    { label: 'bottom-left', rect: { top: 760, left: 0, width: 40, height: 40 } },
    { label: 'bottom-right', rect: { top: 760, left: 960, width: 40, height: 40 } },
    { label: 'centre', rect: { top: 380, left: 480, width: 40, height: 40 } },
  ];
  for (const placement of ['top', 'bottom', 'start', 'end', 'center'] as const) {
    for (const e of edges) {
      const p = tourCardPosition({ rect: e.rect, viewport, card, placement });
      ok(`${placement} @ ${e.label} stays on screen`, inside(p));
    }
  }
  const garbage = tourCardPosition({
    rect: { top: NaN, left: Infinity, width: -10, height: NaN },
    viewport, card, placement: 'bottom',
  });
  ok('a garbage rect still yields a finite, non-negative position', inside(garbage));
  const tiny = tourCardPosition({
    rect: { top: 10, left: 10, width: 10, height: 10 },
    viewport: { width: 200, height: 150 }, card, placement: 'bottom',
  });
  ok('a card larger than the viewport is pinned to the origin, never negative',
    Number.isFinite(tiny.top) && Number.isFinite(tiny.left) && tiny.top >= 0 && tiny.left >= 0);
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ creator-guided-tour: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ creator-guided-tour: all assertions passed\x1b[0m');

// Pure-logic tests: the mission editor's step 3 disclosure state (change: mission-editor-value-rows,
// replacing the "+" chips of task-editor-progressive-disclosure).
//
// ─── The load-bearing rules these tests protect ──────────────────────────────
// 1. EVERY row opens CLOSED, always. When opening was coupled to "does this hold content", a template
//    seeder that disagreed with blankTask about capacity made every template-derived mission unfold
//    three or four sections the creator never chose.
// 2. At most one row is open at a time; that is what bounds step 3's height.
// 3. Opening or closing a row must not write to the task.
// 4. Nothing authored hides: every optional field a creator can set shows on some row's VALUE.
//    (The chips tried to guarantee this with a count badge; a row shows the value itself.)
// 5. The three task seeders agree on the defaults the "is it authored?" test compares against.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import type { Task } from '@rushpoint/shared';
import {
  OPT_IN_GROUP_KEYS, TASK_FIELD_DEFAULTS, defaultActiveGroups, openOnly, foldGroupAway,
} from '../apps/creator-web/src/lib/taskOptInGroups';
import { rowSummary, visibleRows, type SettingsRowKey } from '../apps/creator-web/src/lib/missionSettingsRows';
import { blankTask } from '../apps/creator-web/src/lib/wizardLogic';
import { libraryTaskToTask } from '../apps/creator-web/src/lib/libraryTask';

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

const fresh = (): Task => blankTask('t1');
const withT = (over: Partial<Task>): Task => ({ ...fresh(), ...over });

console.log('\n── 1. the row table ────────────────────────────────────────');
eq('the five settings rows', [...OPT_IN_GROUP_KEYS], ['scoring', 'hint', 'opens', 'timeLimit', 'more']);
// `media` is authored beside the description on step 2, always visible (change: task-media-durability).
ok('media is NOT a settings row', !(OPT_IN_GROUP_KEYS as readonly string[]).includes('media'));

console.log('\n── 2. every row opens closed, whatever the task holds ──────');
// The exact shape the template seeder produces (capacity 5, per-task difficulty and points, a hint):
// the case that used to unfold three or four sections on every template mission.
const templateShaped = withT({ maxConcurrentTeams: 5, difficulty: 8, pointValue: 150, hint: 'מתחת לספסל', tags: ['חוץ'] });
for (const task of [fresh(), templateShaped]) {
  const a = defaultActiveGroups(task);
  ok(`no row starts open (${task === templateShaped ? 'template-shaped' : 'fresh'})`, OPT_IN_GROUP_KEYS.every((k) => a[k] === false));
}

console.log('\n── 3. at most one row is open ──────────────────────────────');
let a = defaultActiveGroups(fresh());
a = openOnly(a, 'hint');
eq('opening one row', OPT_IN_GROUP_KEYS.filter((k) => a[k]), ['hint']);
a = openOnly(a, 'timeLimit');
eq('opening another closes the first', OPT_IN_GROUP_KEYS.filter((k) => a[k]), ['timeLimit']);
a = openOnly(a, 'timeLimit');
eq('opening the open row again closes it', OPT_IN_GROUP_KEYS.filter((k) => a[k]), []);

console.log('\n── 4. closing a row never writes ───────────────────────────');
{
  const task = withT({ hint: 'look up', hintPenalty: 40 });
  const folded = foldGroupAway(task, openOnly(defaultActiveGroups(task), 'hint'), 'hint');
  ok('the task comes back by the same reference', folded.task === task);
  ok('the row is closed', folded.active.hint === false);
}

console.log('\n── 5. nothing authored hides behind a closed row ───────────');
// For each optional field, the row that owns it must SAY something different from a fresh mission.
const ctx = (preset: string) => ({ preset, titleOf: () => 'משימה אחרת' });
const says = (row: SettingsRowKey, task: Task, preset = 'fixed_points_speed') => JSON.stringify(rowSummary(row, task, ctx(preset)));
const cases: [string, SettingsRowKey, Partial<Task>, string?][] = [
  ['a hint', 'hint', { hint: 'look up' }],
  ['a prerequisite', 'opens', { unlockAfterTaskIds: ['other'] }],
  ['a release after N minutes', 'opens', { releaseAfterMinutes: 15 }],
  ['a release time', 'opens', { releaseAt: '2026-10-22T15:00:00.000Z' }],
  ['a time limit', 'timeLimit', { timeLimitMinutes: 5 }],
  ['an expiry', 'more', { expiresAfterMinutes: 30 }],
  ['a closing time', 'more', { expiresAt: '2026-10-22T16:00:00.000Z' }],
  ['a station capacity', 'more', { maxConcurrentTeams: 3 }],
  ['a presence gate', 'more', { requirePresence: true }],
  ['a paused clock', 'more', { pausesTimer: true }],
  ['required contributors', 'more', { requiredContributors: 3 }],
  ['a tag', 'more', { tags: ['night'] }],
  ['free-hint thresholds', 'more', { hint: 'x', hintAutoRevealAttempts: 2 }],
  ['an interaction duration (points game)', 'more', { expectedDurationMinutes: 12 }],
  ['a point value (points game)', 'scoring', { pointValue: 250 }],
  ['a difficulty (smart score)', 'scoring', { difficulty: 9 }, 'smart_weighted'],
];
for (const [label, row, patch, preset] of cases) {
  const p = preset ?? 'fixed_points_speed';
  ok(`${label} shows on the "${row}" row`, visibleRows(p).includes(row) && says(row, withT(patch), p) !== says(row, fresh(), p));
}
// The derived walk-inclusive estimate is seeded on every task, so it is never "set".
ok('the seeded estimate does not name itself', says('more', withT({ estimatedMinutes: 40 }), 'smart_weighted') === says('more', fresh(), 'smart_weighted'));

console.log('\n── 6. the three seeders agree on the defaults ──────────────');
const f = fresh();
eq('the declared default difficulty matches blankTask', TASK_FIELD_DEFAULTS.difficulty, f.difficulty);
eq('the declared default points matches blankTask', TASK_FIELD_DEFAULTS.pointValue, f.pointValue);
eq('the declared default capacity matches blankTask', TASK_FIELD_DEFAULTS.maxConcurrentTeams, f.maxConcurrentTeams);
// Copying a task out of the gallery is the app's other way of creating one (lib/libraryTask.ts).
{
  const copied = libraryTaskToTask({
    id: 'pt1', gameId: 'g1', ownerUid: 'u1',
    title: 'x', description: 'y', type: 'photo',
    difficulty: 5, estimatedMinutes: 7, pointValue: 100,
  } as unknown as Parameters<typeof libraryTaskToTask>[0]);
  eq('a gallery copy seeds the same capacity as blankTask', copied.maxConcurrentTeams, f.maxConcurrentTeams);
  eq('…and the same capacity TASK_FIELD_DEFAULTS declares', copied.maxConcurrentTeams, TASK_FIELD_DEFAULTS.maxConcurrentTeams);
  // Difficulty travels with the copied mission (its author chose it); capacity describes the venue.
  eq('a gallery copy keeps the source difficulty', copied.difficulty, 5);
}
ok('a fresh mission names nothing in "עוד הגדרות"', says('more', fresh()) === JSON.stringify({ key: 'moreNone' }));

if (failures > 0) {
  console.error(`\n❌ task-opt-in-groups: ${failures} FAILED`);
  process.exit(1);
}
console.log('\n✅ task-opt-in-groups: ALL PASS');

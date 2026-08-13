// Pure-logic tests — the task editor's modular "opt-in" field groups
// (change: task-editor-progressive-disclosure).
//
// The editor used to show five collapsible sections stacked under the core
// fields, so every task — however simple — presented the full surface of the
// product. The redesign shows the core fields plus a row of CHIPS
// (+ Add hint, + Set timer / points, + Attach media, + Prerequisites / rules);
// clicking one mounts just that group, with a Remove control that clears it.
//
// The load-bearing rule these tests protect: a group that ALREADY HAS DATA must
// render expanded, never behind a chip. A creator editing an existing task must
// never have to guess which chip is hiding their hint. That makes
// `groupHasContent` a data-visibility guarantee, not a cosmetic default — and it
// is why the "is it authored?" test for a field that ships with a default
// (difficulty, points, station capacity) must compare against that DEFAULT rather
// than against undefined: otherwise every task looks authored, every group starts
// expanded, and the chips never appear at all.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import type { Task } from '@rushpoint/shared';
import { defaultExpectedDurationMinutes } from '@rushpoint/shared';
import {
  OPT_IN_GROUP_KEYS, TASK_FIELD_DEFAULTS,
  type OptInGroupKey,
  groupHasContent, defaultActiveGroups, groupApplies, groupSummary, clearGroupPatch,
} from '../apps/creator-web/src/lib/taskOptInGroups';
import { blankTask } from '../apps/creator-web/src/lib/wizardLogic';

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

console.log('\n── 1. the group table ──────────────────────────────────────');
eq('exactly four opt-in groups', [...OPT_IN_GROUP_KEYS],
  ['hint', 'timerPoints', 'media', 'rules']);
ok('every key is unique', new Set(OPT_IN_GROUP_KEYS).size === OPT_IN_GROUP_KEYS.length);

console.log('\n── 2. a FRESH task shows chips only (nothing expanded) ──────');
// This is the whole point of the redesign: a brand-new task is core fields plus
// four chips, not a wall of controls.
const f = fresh();
for (const k of OPT_IN_GROUP_KEYS) {
  ok(`fresh task: '${k}' has no authored content`, !groupHasContent(k, f));
}
const activeFresh = defaultActiveGroups(f);
ok('fresh task: no group starts expanded',
  OPT_IN_GROUP_KEYS.every((k) => activeFresh[k] === false));

// The defaults a blankTask ships must be stated, not guessed — the whole
// "is it authored?" test hangs off them.
eq('the declared default difficulty matches blankTask', TASK_FIELD_DEFAULTS.difficulty, f.difficulty);
eq('the declared default points matches blankTask', TASK_FIELD_DEFAULTS.pointValue, f.pointValue);
eq('the declared default capacity matches blankTask',
  TASK_FIELD_DEFAULTS.maxConcurrentTeams, f.maxConcurrentTeams);

console.log('\n── 3. a group with data renders EXPANDED, never behind a chip ─');
ok('a hint expands the hint group', groupHasContent('hint', withT({ hint: 'look up' })));
ok('an empty-string hint does NOT count as authored', !groupHasContent('hint', withT({ hint: '   ' })));
ok('media expands the media group',
  groupHasContent('media', withT({ media: [{ id: 'm', kind: 'image', url: 'u' }] as Task['media'] })));
ok('a prerequisite expands the rules group',
  groupHasContent('rules', withT({ unlockAfterTaskIds: ['other'] })));
ok('a presence gate expands the rules group', groupHasContent('rules', withT({ requirePresence: true })));
ok('a tag expands the rules group', groupHasContent('rules', withT({ tags: ['night'] })));
ok('a non-default station capacity expands the rules group',
  groupHasContent('rules', withT({ maxConcurrentTeams: 1 })));
ok('an expiry expands the timer group', groupHasContent('timerPoints', withT({ expiresAfterMinutes: 30 })));
ok('a paused clock expands the timer group', groupHasContent('timerPoints', withT({ pausesTimer: true })));
ok('a non-default difficulty expands the timer group', groupHasContent('timerPoints', withT({ difficulty: 9 })));
ok('a non-default point value expands the timer group', groupHasContent('timerPoints', withT({ pointValue: 250 })));
ok('an authored interaction duration expands the timer group',
  groupHasContent('timerPoints', withT({ expectedDurationMinutes: 12 })));
// ...but the TYPE-DERIVED default does NOT. This field's default is computed per
// interaction rather than living in TASK_FIELD_DEFAULTS, so a plain "is it a
// positive number?" test called every task authored and forced Step 3's timing
// group open on load — a creator seeing settings they never touched. Same rule the
// constant-defaulted fields already follow, applied to a derived default.
{
  const derived = withT({ type: 'quiz' });
  derived.expectedDurationMinutes = defaultExpectedDurationMinutes(derived);
  ok('a task carrying only the DERIVED duration keeps the timer group collapsed',
    !groupHasContent('timerPoints', derived));
  ok('and every group is collapsed for such a task (Step 3 opens clean)',
    Object.values(defaultActiveGroups(derived)).every((open) => open === false));
  // The guarantee still holds in the other direction: nudging it off the derived
  // value is authorship and must surface, or it becomes invisible state.
  const nudged = withT({ type: 'quiz' });
  nudged.expectedDurationMinutes = defaultExpectedDurationMinutes(nudged) + 3;
  ok('nudging the duration off its derived default DOES expand the timer group',
    groupHasContent('timerPoints', nudged));
}
// A carried release instant has no editor at all, so it MUST be visible where it
// is at least explained, or it is invisible state.
ok('a carried release instant expands the timer group',
  groupHasContent('timerPoints', withT({ releaseAfterMinutes: 20 })));

// The derived walk-inclusive estimate is seeded on EVERY task, so it cannot be a
// signal of authorship — if it were, every group would open and no chip would show.
ok('the auto-derived estimate alone does NOT expand the timer group',
  !groupHasContent('timerPoints', withT({ estimatedMinutes: (fresh().estimatedMinutes ?? 15) })));

console.log('\n── 4. defaultActiveGroups mirrors groupHasContent exactly ───');
// Two consumers, ONE rule: a group opens exactly when it has content. If these
// ever drift, a populated field hides behind a chip — the regression this change
// exists to prevent.
const mixed = withT({ hint: 'x', tags: ['a'] });
const activeMixed = defaultActiveGroups(mixed);
for (const k of OPT_IN_GROUP_KEYS) {
  eq(`'${k}': active state == has-content`, activeMixed[k], groupHasContent(k, mixed));
}

console.log('\n── 5. which groups are even offered ────────────────────────');
// Prerequisites are meaningless in a one-task stage, but the rules group also
// carries capacity/presence/tags, so the GROUP still applies — only the
// prerequisite control inside it is withheld.
ok('rules applies even in a one-task stage', groupApplies('rules', f, 1));
ok('hint always applies', groupApplies('hint', f, 1));
ok('media always applies', groupApplies('media', f, 1));
ok('timerPoints always applies', groupApplies('timerPoints', f, 1));

console.log('\n── 6. the chip badge counts what is set ────────────────────');
eq('fresh task badges nothing', OPT_IN_GROUP_KEYS.map((k) => groupSummary(k, f)), [0, 0, 0, 0]);
eq('one hint ⇒ 1', groupSummary('hint', withT({ hint: 'x' })), 1);
eq('two media ⇒ 2', groupSummary('media', withT({
  media: [{ id: 'a', kind: 'image', url: 'u' }, { id: 'b', kind: 'image', url: 'v' }] as Task['media'],
})), 2);
eq('two prerequisites + presence ⇒ 3',
  groupSummary('rules', withT({ unlockAfterTaskIds: ['a', 'b'], requirePresence: true })), 3);

console.log('\n── 7. Remove clears the group without corrupting the task ───');
// Required fields (difficulty, points, capacity) must RESET to their defaults,
// never to undefined — a Task is not valid without them, and a wizard control
// that can write `undefined` into a required number is a crash waiting to happen.
const loaded = withT({
  hint: 'x', hintPenalty: 50, hintAutoRevealMinutes: 3, hintAutoRevealAttempts: 2,
  difficulty: 9, pointValue: 250, expiresAfterMinutes: 30, pausesTimer: true,
  expectedDurationMinutes: 12,
  media: [{ id: 'a', kind: 'image', url: 'u' }] as Task['media'],
  unlockAfterTaskIds: ['a'], requirePresence: true, tags: ['night'], maxConcurrentTeams: 1,
});

const clearedHint = { ...loaded, ...clearGroupPatch('hint') };
ok('clearing hint empties every hint field',
  !clearedHint.hint && clearedHint.hintPenalty === undefined
  && clearedHint.hintAutoRevealMinutes === undefined && clearedHint.hintAutoRevealAttempts === undefined);
ok('clearing hint leaves the other groups alone',
  clearedHint.tags?.length === 1 && clearedHint.media?.length === 1 && clearedHint.difficulty === 9);
ok('a cleared hint group reports no content', !groupHasContent('hint', clearedHint));

const clearedTimer = { ...loaded, ...clearGroupPatch('timerPoints') };
eq('clearing timer/points RESETS difficulty to the default',
  clearedTimer.difficulty, TASK_FIELD_DEFAULTS.difficulty);
eq('clearing timer/points RESETS points to the default',
  clearedTimer.pointValue, TASK_FIELD_DEFAULTS.pointValue);
eq('clearing timer/points drops the expiry', clearedTimer.expiresAfterMinutes, undefined);
eq('clearing timer/points drops the pause flag', clearedTimer.pausesTimer, undefined);
ok('a cleared timer group reports no content', !groupHasContent('timerPoints', clearedTimer));

const clearedRules = { ...loaded, ...clearGroupPatch('rules') };
eq('clearing rules RESETS capacity to the default',
  clearedRules.maxConcurrentTeams, TASK_FIELD_DEFAULTS.maxConcurrentTeams);
eq('clearing rules empties the prerequisites', clearedRules.unlockAfterTaskIds, undefined);
eq('clearing rules empties the tags', clearedRules.tags, []);
ok('a cleared rules group reports no content', !groupHasContent('rules', clearedRules));

const clearedMedia = { ...loaded, ...clearGroupPatch('media') };
ok('clearing media empties the attachments', (clearedMedia.media?.length ?? 0) === 0);
ok('a cleared media group reports no content', !groupHasContent('media', clearedMedia));

console.log('\n── 8. totality: never throw on a malformed task ────────────');
const junk = { id: 'x', title: '', type: 'field', coordinates: { lat: 0, lng: 0 } } as Task;
let threw = false;
try {
  for (const k of OPT_IN_GROUP_KEYS) { groupHasContent(k, junk); groupSummary(k, junk); groupApplies(k, junk, 1); }
  defaultActiveGroups(junk);
} catch { threw = true; }
ok('a task missing every optional field is handled, not thrown on', !threw);

if (failures > 0) {
  console.error(`\n✗ ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ task opt-in groups OK\n');

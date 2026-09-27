// Pure-logic tests — the task editor's modular "opt-in" field groups
// (change: task-editor-progressive-disclosure).
//
// The editor used to show five collapsible sections stacked under the core
// fields, so every task — however simple — presented the full surface of the
// product. The redesign shows the core fields plus a row of CHIPS
// (+ Add hint, + Set timer / points, + Prerequisites / rules);
// clicking one mounts just that group, with a Remove control that clears it.
//
// ─── The load-bearing rules these tests protect ──────────────────────────────
// (updated by change: builder-nondestructive-disclosure)
//
// 1. EVERY group opens COLLAPSED, always. Expansion used to be coupled to "does
//    this group hold content", which read well on paper and failed in practice:
//    a template seeder wrote a different maxConcurrentTeams from
//    blankTask/TASK_FIELD_DEFAULTS, so EVERY template-derived task looked
//    authored and opened its rules group — plus timer/points, since the templates
//    override difficulty and pointValue per task. The editor greeted the creator
//    with three or four unfolded sections of settings they never chose.
// 2. Data is still discoverable while folded, via the chip's COUNT BADGE. That is
//    why `groupHasContent` keeps its meaning and keeps being tested here: it no
//    longer decides what OPENS, but it is what stops a folded group from hiding.
//    (And why the "is it authored?" test still compares against the DEFAULT for a
//    field that ships with one, rather than against undefined.)
// 3. HIDING a group must not write to the task. The fold used to clear the group's
//    fields first, so "hide this section" destroyed data on the way past.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import type { Task } from '@rushpoint/shared';
import { defaultExpectedDurationMinutes } from '@rushpoint/shared';
import {
  OPT_IN_GROUP_KEYS, TASK_FIELD_DEFAULTS,
  type OptInGroupKey,
  groupHasContent, defaultActiveGroups, groupApplies, groupSummary, clearGroupPatch,
  foldGroupAway,
} from '../apps/creator-web/src/lib/taskOptInGroups';
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

console.log('\n── 1. the group table ──────────────────────────────────────');
eq('exactly four opt-in groups', [...OPT_IN_GROUP_KEYS],
  ['hint', 'timerPoints', 'rules']);
// `media` LEFT this set (change: task-media-durability). A picture is part of describing
// a mission, so it is authored beside the description and always visible — it is not an
// optional extra hidden behind a chip on the last step. Pinned here so re-adding it to
// the registry without re-adding the UI (or vice versa) fails loudly.
ok('media is NOT an opt-in group',
  !(OPT_IN_GROUP_KEYS as readonly string[]).includes('media'));
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

// ── The THIRD seeder, which sat outside this guarantee until 2026-09-02 ──────
//
// Copying a task out of the gallery is the app's other way of creating one, and
// it seeds its own defaults. It was never compared against these two purely
// because it lived inside a component file; it is now lib/libraryTask.ts.
//
// The stakes are on record in taskOptInGroups.ts's header: when two seeders
// disagreed about capacity, every task derived from the disagreeing one read as
// "authored", and the editor greeted creators with three or four unfolded
// sections of settings they had never chosen.
{
  const copied = libraryTaskToTask({
    id: 'pt1', gameId: 'g1', ownerUid: 'u1',
    title: 'x', description: 'y', type: 'photo',
    difficulty: 5, estimatedMinutes: 7, pointValue: 100,
  } as unknown as Parameters<typeof libraryTaskToTask>[0]);
  eq('a gallery copy seeds the same capacity as blankTask',
    copied.maxConcurrentTeams, f.maxConcurrentTeams);
  eq('…and the same capacity TASK_FIELD_DEFAULTS declares',
    copied.maxConcurrentTeams, TASK_FIELD_DEFAULTS.maxConcurrentTeams);
  // It deliberately does NOT mirror difficulty/pointValue: those travel with the
  // copied mission because the original author chose them. Capacity does not,
  // because it describes the original's venue rather than the mission.
  eq('a gallery copy keeps the source difficulty rather than the default',
    copied.difficulty, 5);
}

console.log('\n── 3. a group with data renders EXPANDED, never behind a chip ─');
ok('a hint expands the hint group', groupHasContent('hint', withT({ hint: 'look up' })));
ok('an empty-string hint does NOT count as authored', !groupHasContent('hint', withT({ hint: '   ' })));

ok('a prerequisite expands the rules group',
  groupHasContent('rules', withT({ unlockAfterTaskIds: ['other'] })));
ok('a presence gate expands the rules group', groupHasContent('rules', withT({ requirePresence: true })));
ok('a tag expands the rules group', groupHasContent('rules', withT({ tags: ['night'] })));
ok('a non-default station capacity expands the rules group',
  groupHasContent('rules', withT({ maxConcurrentTeams: 3 })));
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

console.log('\n── 4. the editor ALWAYS opens collapsed ────────────────────');
// (change: builder-nondestructive-disclosure) Expansion is no longer coupled to
// content. The old rule — "open exactly when it has content" — meant a
// template-seeded game opened three or four sections on every task, because the
// template seeder and blankTask disagree about the defaults. Discoverability now
// rides the chip's count badge (section 6) instead of unfolding everything.
const mixed = withT({ hint: 'x', tags: ['a'] });
const activeMixed = defaultActiveGroups(mixed);
ok('a task with content in two groups still opens nothing',
  OPT_IN_GROUP_KEYS.every((k) => activeMixed[k] === false));

// THE REPRODUCTION. This is the exact shape apps/creator-web/src/templates.ts
// `task()` produces: maxConcurrentTeams 5 (blankTask/TASK_FIELD_DEFAULTS say 3, so
// it is "non-default" on 100% of template tasks) plus the per-task difficulty and
// pointValue overrides every template applies, plus a hint on many of them. Under
// the old rule this opened rules + timerPoints + hint on essentially every task in
// every template-derived game — the owner's "it opens all of the buttons
// automatically" report.
const templateShaped = withT({
  maxConcurrentTeams: 5,
  difficulty: 3,
  pointValue: 120,
  hint: 'שאלו בשקט את ההורים',
  hintPenalty: 20,
});
const activeTemplate = defaultActiveGroups(templateShaped);
for (const k of OPT_IN_GROUP_KEYS) {
  ok(`template-shaped task: '${k}' opens COLLAPSED`, activeTemplate[k] === false);
}

// A task with content in ALL four groups still opens clean.
const everything = withT({
  hint: 'x', media: [{ id: 'm', kind: 'image', url: 'u' }] as Task['media'],
  difficulty: 9, pointValue: 250, tags: ['night'], maxConcurrentTeams: 1,
});
ok('a task with content in all four groups still opens nothing',
  Object.values(defaultActiveGroups(everything)).every((open) => open === false));

console.log('\n── 5. which groups are even offered ────────────────────────');
// Prerequisites are meaningless in a one-task stage, but the rules group also
// carries capacity/presence/tags, so the GROUP still applies — only the
// prerequisite control inside it is withheld.
ok('rules applies even in a one-task stage', groupApplies('rules', f, 1));
ok('hint always applies', groupApplies('hint', f, 1));
ok('timerPoints always applies', groupApplies('timerPoints', f, 1));

console.log('\n── 6. the chip badge counts what is set ────────────────────');
eq('fresh task badges nothing', OPT_IN_GROUP_KEYS.map((k) => groupSummary(k, f)), [0, 0, 0]);
eq('one hint ⇒ 1', groupSummary('hint', withT({ hint: 'x' })), 1);
// (No media case here: media has no chip and therefore no badge — it is authored
// beside the description, always visible. See the note at the top of this file.)
eq('two prerequisites + presence ⇒ 3',
  groupSummary('rules', withT({ unlockAfterTaskIds: ['a', 'b'], requirePresence: true })), 3);

// THE DISCOVERABILITY GUARANTEE, now that expansion no longer carries it
// (change: builder-nondestructive-disclosure). Collapsing every group is only
// honest because a populated group still ADVERTISES itself on its chip. So
// `groupHasContent` must keep telling the truth even though it no longer decides
// what opens — if this pair ever went quiet, folding really would hide data.
ok('the template-shaped task still REPORTS its authored hint',
  groupHasContent('hint', templateShaped));
ok('the template-shaped task still REPORTS its authored timing/points',
  groupHasContent('timerPoints', templateShaped));
ok('the template-shaped task still REPORTS its non-default capacity',
  groupHasContent('rules', templateShaped));
ok('…and each of those lights a non-zero badge',
  groupSummary('hint', templateShaped) > 0
  && groupSummary('timerPoints', templateShaped) > 0
  && groupSummary('rules', templateShaped) > 0);
ok('a group it never touched still advertises nothing',
  !groupHasContent('media', templateShaped) && groupSummary('media', templateShaped) === 0);

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

// No media case: there is no media group to clear any more (change:
// task-media-durability). Attachments are removed one at a time by the ✕ on each entry,
// which is the only destructive control the section has ever needed — a group-wide
// "clear all media" that a creator could hit by folding a section away was exactly the
// kind of quiet data loss this change exists to remove.
ok('clearGroupPatch has no media arm',
  !Object.prototype.hasOwnProperty.call(clearGroupPatch('rules'), 'media'));

console.log('\n── 7b. HIDING a group must never touch the task ────────────');
// (change: builder-nondestructive-disclosure) The fold control used to run
// clearGroupPatch and THEN collapse, so "hide this section" silently wiped the
// fields under it and the wipe rode the Builder's autosave into updateGame. The
// fold is now a display decision and nothing else. Identity (not deep-equality) is
// asserted deliberately: returning the very same object reference is the strongest
// possible statement that no field was rewritten.
{
  const before = withT({
    hint: 'keep me', hintPenalty: 25,
    difficulty: 9, pointValue: 250, expiresAfterMinutes: 30, pausesTimer: true,
    media: [{ id: 'a', kind: 'image', url: 'u' }] as Task['media'],
    unlockAfterTaskIds: ['a'], requirePresence: true, tags: ['night'], maxConcurrentTeams: 1,
  });
  const snapshot = JSON.stringify(before);
  const active: Record<OptInGroupKey, boolean> = {
    hint: true, timerPoints: true, media: true, rules: true,
  };

  for (const k of OPT_IN_GROUP_KEYS) {
    const res = foldGroupAway(before, active, k);
    ok(`hiding '${k}' returns the SAME task object (nothing rewritten)`, res.task === before);
    ok(`hiding '${k}' leaves the task byte-identical`, JSON.stringify(res.task) === snapshot);
    ok(`hiding '${k}' collapses exactly that group`, res.active[k] === false);
    ok(`hiding '${k}' leaves the other groups' open state alone`,
      OPT_IN_GROUP_KEYS.filter((o) => o !== k).every((o) => res.active[o] === active[o]));
  }

  // The specific fields the old destructive path wiped, named so a regression says
  // which promise it broke rather than just "deep-equal failed".
  const hidHint = foldGroupAway(before, active, 'hint').task;
  eq('hiding the hint group keeps the hint text', hidHint.hint, 'keep me');
  eq('hiding the hint group keeps the hint penalty', hidHint.hintPenalty, 25);
  const hidTimer = foldGroupAway(before, active, 'timerPoints').task;
  eq('hiding timer/points keeps the authored difficulty', hidTimer.difficulty, 9);
  eq('hiding timer/points keeps the authored points', hidTimer.pointValue, 250);
  const hidRules = foldGroupAway(before, active, 'rules').task;
  eq('hiding rules keeps the prerequisites', hidRules.unlockAfterTaskIds, ['a']);
  eq('hiding rules keeps the tags', hidRules.tags, ['night']);
  eq('hiding rules keeps the authored capacity', hidRules.maxConcurrentTeams, 1);
  const hidMedia = foldGroupAway(before, active, 'media').task;
  eq('hiding media keeps the attachments', hidMedia.media?.length, 1);

  // A hidden group is still authored — so re-opening it shows the values back, and
  // its chip badge stays lit while folded.
  ok('a hidden group still reports its content (the badge stays lit)',
    groupHasContent('hint', hidHint) && groupSummary('hint', hidHint) === 1);
}

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

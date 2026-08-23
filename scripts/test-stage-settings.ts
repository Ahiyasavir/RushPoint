// Pure-logic tests for the stage-editor progressive-disclosure model
// (change: wave-k stage-editor-redesign).
//
// The stage editor now shows a CALM surface at rest — stage name + task cards —
// and tucks the advanced controls (partial-completion count, timed release,
// exclusive groups, chapter story) behind ONE "stage settings" disclosure. Which
// controls even APPLY to a given stage, which are NON-DEFAULT (badge-worthy, so a
// folded setting still advertises that it is configured), and the summary-chip
// fraction text are pure functions of the stage — extracted here so the
// disclosure rules are testable without rendering a pixel.
//
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { stageSettingsState, stageChips } from '../apps/creator-web/src/lib/stageSettings';
import { blankTask } from '../apps/creator-web/src/lib/wizardLogic';
import type { Stage } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const tasks = (n: number): Stage['tasks'] => Array.from({ length: n }, (_, i) => blankTask(`t${i + 1}`));

// ── A calm, default FIRST stage: one task, nothing configured ────────────────
const calm: Stage = { id: 's0', order: 0, title: 'Start', tasks: tasks(1) };
{
  const s = stageSettingsState(calm, { isFirstStage: true });
  ok(s.taskCount === 1, 'calm stage has one task');
  ok(s.requiredApplies === false, 'completion rule does not apply to a one-task stage');
  ok(s.releaseApplies === false, 'timed release does not apply to the first stage');
  ok(s.groupsApply === false, 'grouping does not apply to a one-task stage');
  ok(s.storyActive === false, 'a fresh stage has no story');
  ok(s.activeCount === 0, 'a calm default stage has zero active advanced settings');
  ok(stageChips(s).length === 0, 'a calm default stage surfaces no status chips');
}

// ── A rich, NON-first stage: 6 tasks, required 3, two groups, a story ────────
const rich: Stage = {
  id: 's1', order: 1, title: 'Field tasks', tasks: tasks(6),
  requiredTaskCount: 3,
  narrative: { intro: { title: 'Chapter 1' } },
  exclusiveGroups: [
    { id: 'g1', taskIds: ['t2', 't4'] },
    { id: 'g2', taskIds: ['t1', 't5'] },
  ],
};
{
  const s = stageSettingsState(rich, { isFirstStage: false });
  ok(s.requiredApplies === true, 'completion rule applies with a pool of tasks');
  ok(s.requiredValue === 3, 'required value reflects requiredTaskCount');
  ok(s.requiredActive === true, 'required is active when it is fewer than all tasks');
  ok(s.releaseApplies === true, 'timed release applies to a non-first stage');
  ok(s.releaseActive === false, 'no positive delay means release is not active');
  ok(s.groupsApply === true, 'grouping applies with more than one task');
  ok(s.groupCount === 2, 'two effective groups are counted');
  ok(s.groupsActive === true, 'grouping is active when an effective group exists');
  ok(s.storyActive === true, 'story is active when a field is authored');
  ok(s.activeCount === 3, 'required + groups + story = three active settings (release off)');
  // The at-rest read-only status chips are DERIVED from the same state, in a fixed
  // order — one door in (the ⚙ pill); the chips only advertise a folded setting.
  ok(JSON.stringify(stageChips(s)) === JSON.stringify(['completion', 'story', 'groups']),
    'rich stage surfaces completion + story + groups chips (release off), in order');
}

// ── requiredTaskCount default / undefined is NOT active ──────────────────────
ok(stageSettingsState({ ...rich, requiredTaskCount: undefined }, { isFirstStage: false }).requiredActive === false,
  'undefined requiredTaskCount (= all tasks) is not active');
ok(stageSettingsState({ ...rich, requiredTaskCount: 6 }, { isFirstStage: false }).requiredActive === false,
  'requiredTaskCount equal to the task count is not active');
ok(stageSettingsState({ ...rich, requiredTaskCount: undefined }, { isFirstStage: false }).requiredValue === 6,
  'requiredValue defaults to the task count when unset');

// ── Timed release ─────────────────────────────────────────────────────────────
{
  const s = stageSettingsState({ ...calm, tasks: tasks(2), releaseAfterMinutes: 15 }, { isFirstStage: false });
  ok(s.releaseActive === true, 'a positive delay on a non-first stage is active');
  ok(s.releaseMinutes === 15, 'the configured delay is surfaced');
  ok(stageChips(s).includes('release'), 'a timed non-first stage surfaces the release chip');
}
ok(stageSettingsState({ ...calm, releaseAfterMinutes: 15 }, { isFirstStage: true }).releaseActive === false,
  'a delay on the first stage is inert (release never applies there)');
ok(stageSettingsState({ ...calm, tasks: tasks(2), releaseAfterMinutes: 0 }, { isFirstStage: false }).releaseActive === false,
  'a zero delay is not active');

// ── Inert (single-member) groups are NOT counted (matches server enforcement) ─
{
  const s = stageSettingsState({ ...rich, exclusiveGroups: [{ id: 'g1', taskIds: ['t2'] }] }, { isFirstStage: false });
  ok(s.groupCount === 0, 'a one-member group is inert and not counted');
  ok(s.groupsActive === false, 'an inert group does not make grouping active');
}

console.log(failed === 0
  ? `\n✅ ALL STAGE SETTINGS TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

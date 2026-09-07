// The Builder's mission-editor URL contract (change: builder-mission-editor-route).
//
// The open mission moved out of `BuilderPage`'s local `editing` state and into the
// URL, so that all SIX entry points and FIVE exits behave identically and the
// phone's back gesture closes the editor instead of leaving the Builder.
//
// The history discipline is the part that can go quietly wrong — an editor that
// accumulates entries needs three backs to escape, and one that consumes an entry
// it never pushed walks a deep-linked creator straight off the site. That decision
// is `missionEditorNavAction`, and it is tested EXHAUSTIVELY below rather than by
// example, because there is no gate anywhere else in this repo that can see it.
//
// No emulator, no DOM.
//   npx tsx scripts/test-mission-editor-route.ts
import type { Game, Stage, Task } from '../packages/shared/src/types';
import {
  MISSION_PARAM,
  readOpenMissionId,
  missionEditorSearch,
  resolveOpenMission,
  missionEditorNavAction,
} from '../apps/creator-web/src/lib/missionEditorRoute';

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
function eq<T>(label: string, got: T, want: T): void {
  ok(label, Object.is(got, want), Object.is(got, want) ? '' : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── fixtures ────────────────────────────────────────────────────────────────
const task = (id: string, title = id): Task => ({ id, title, type: 'field' } as Task);
const stage = (id: string, order: number, tasks: Task[]): Stage =>
  ({ id, order, title: id, tasks } as Stage);
const GAME = {
  id: 'g1',
  title: 'demo',
  stages: [
    stage('s1', 0, [task('t1'), task('t2')]),
    stage('s2', 1, [task('t3')]),
  ],
} as Game;

// ── 1. readOpenMissionId ────────────────────────────────────────────────────
console.log('\nreadOpenMissionId');
{
  eq('the param name is the documented one', MISSION_PARAM, 'task');
  eq('an empty search means no mission', readOpenMissionId(''), null);
  eq('a bare ? means no mission', readOpenMissionId('?'), null);
  eq('the task id is read out', readOpenMissionId('?task=t1'), 't1');
  eq('a leading ? is optional', readOpenMissionId('task=t1'), 't1');
  eq('an unrelated param means no mission', readOpenMissionId('?other=1'), null);
  eq('the id is found beside other params', readOpenMissionId('?other=1&task=t1'), 't1');
  eq('an empty value is no mission', readOpenMissionId('?task='), null);
  eq('a whitespace-only value is no mission', readOpenMissionId('?task=%20%20'), null);
  eq('surrounding whitespace is trimmed', readOpenMissionId('?task=%20t1%20'), 't1');
  eq('a repeated param takes the first', readOpenMissionId('?task=t1&task=t2'), 't1');
  eq('a URLSearchParams is accepted too', readOpenMissionId(new URLSearchParams('task=t9')), 't9');
  // Total: BuilderPage renders on every navigation, so a throw here is a blank app.
  eq('null never throws', readOpenMissionId(null as unknown as string), null);
  eq('undefined never throws', readOpenMissionId(undefined as unknown as string), null);
  eq('a non-string never throws', readOpenMissionId(42 as unknown as string), null);
}

// ── 2. missionEditorSearch ──────────────────────────────────────────────────
console.log('\nmissionEditorSearch');
{
  eq('opening a mission from a clean URL', missionEditorSearch('', 't1'), 'task=t1');
  eq('opening preserves unrelated params', missionEditorSearch('?ref=abc', 't1'), 'ref=abc&task=t1');
  eq('switching missions replaces the value', missionEditorSearch('?task=t1', 't2'), 'task=t2');
  eq('switching preserves unrelated params',
    missionEditorSearch('?ref=abc&task=t1', 't2'), 'ref=abc&task=t2');
  // Closing must REMOVE the key, not blank it: `?task=` would round-trip through
  // readOpenMissionId as "no mission" but leaves a URL that looks half-open.
  eq('closing removes the key entirely', missionEditorSearch('?task=t1', null), '');
  eq('closing keeps unrelated params', missionEditorSearch('?ref=abc&task=t1', null), 'ref=abc');
  eq('closing an already-closed URL is a no-op', missionEditorSearch('?ref=abc', null), 'ref=abc');
  eq('no leading ? is produced', missionEditorSearch('', 't1').startsWith('?'), false);
  eq('a malformed search is tolerated', missionEditorSearch(null as unknown as string, 't1'), 'task=t1');
}

// ── 3. resolveOpenMission ───────────────────────────────────────────────────
console.log('\nresolveOpenMission');
{
  const hit = resolveOpenMission(GAME, 't1');
  eq('a real id resolves its task', hit?.task.id, 't1');
  eq('...and derives the containing stage', hit?.stageId, 's1');

  // The whole point of deriving: a mission in a stage that is not the active one
  // still resolves to ITS stage, so the pair can never disagree.
  const deep = resolveOpenMission(GAME, 't3');
  eq('a mission in another stage resolves to that stage', deep?.stageId, 's2');
  eq('...and to the right task', deep?.task.id, 't3');

  eq('an unknown id resolves to nothing', resolveOpenMission(GAME, 'nope'), null);
  eq('an empty id resolves to nothing', resolveOpenMission(GAME, ''), null);
  eq('a null id resolves to nothing', resolveOpenMission(GAME, null), null);

  // A deep link lands before getGame resolves; that must read as "no editor yet",
  // never as a crash and never as an error state.
  eq('a null game resolves to nothing', resolveOpenMission(null, 't1'), null);
  eq('an undefined game resolves to nothing', resolveOpenMission(undefined, 't1'), null);

  // Malformed stored data must degrade, per the repo's total-verdict rule.
  eq('a game with no stages array is safe',
    resolveOpenMission({ id: 'g', stages: null } as unknown as Game, 't1'), null);
  eq('a stage with no tasks array is safe',
    resolveOpenMission({ id: 'g', stages: [{ id: 's', tasks: null }] } as unknown as Game, 't1'), null);
  eq('a stages entry that is not an object is safe',
    resolveOpenMission({ id: 'g', stages: [null, 7] } as unknown as Game, 't1'), null);
  eq('a task entry that is not an object is safe',
    resolveOpenMission({ id: 'g', stages: [{ id: 's', tasks: [null] }] } as unknown as Game, 't1'), null);
}

// ── 4. missionEditorNavAction — EXHAUSTIVE ──────────────────────────────────
// Every combination of {closed, mission A, mission B} x {closed, A, B} x
// {we pushed the entry, we did not}. Listed one per line on purpose: this is the
// decision that strands or accumulates history entries, and an implicit case here
// is a back button that does the wrong thing on somebody's phone.
console.log('\nmissionEditorNavAction (exhaustive)');
{
  type Action = 'push' | 'replace' | 'back' | 'none';
  const TABLE: Array<[string | null, string | null, boolean, Action, string]> = [
    // nothing open, nothing opening
    [null, null, true, 'none', 'closed stays closed'],
    [null, null, false, 'none', 'closed stays closed'],
    // opening from closed => a history entry so back can dismiss it
    [null, 'A', true, 'push', 'opening pushes'],
    [null, 'A', false, 'push', 'opening pushes'],
    [null, 'B', true, 'push', 'opening pushes'],
    [null, 'B', false, 'push', 'opening pushes'],
    // same mission re-selected => nothing to do
    ['A', 'A', true, 'none', 'reopening the same mission does nothing'],
    ['A', 'A', false, 'none', 'reopening the same mission does nothing'],
    ['B', 'B', true, 'none', 'reopening the same mission does nothing'],
    ['B', 'B', false, 'none', 'reopening the same mission does nothing'],
    // switching missions => REPLACE, so one editor holds exactly one entry
    ['A', 'B', true, 'replace', 'switching replaces'],
    ['A', 'B', false, 'replace', 'switching replaces'],
    ['B', 'A', true, 'replace', 'switching replaces'],
    ['B', 'A', false, 'replace', 'switching replaces'],
    // closing => consume OUR entry, or clear one we never pushed
    ['A', null, true, 'back', 'closing consumes the entry we pushed'],
    ['A', null, false, 'replace', 'closing a deep-linked editor must not leave the site'],
    ['B', null, true, 'back', 'closing consumes the entry we pushed'],
    ['B', null, false, 'replace', 'closing a deep-linked editor must not leave the site'],
  ];
  eq('every combination is covered', TABLE.length, 3 * 3 * 2);
  for (const [prev, next, owns, want, why] of TABLE) {
    eq(`${String(prev)} -> ${String(next)} (owns=${owns}) ${why}`,
      missionEditorNavAction(prev, next, owns), want);
  }
}

console.log(failures === 0 ? '\n✅ mission-editor-route: ALL PASS' : `\n❌ mission-editor-route: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

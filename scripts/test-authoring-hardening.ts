// Pure-logic tests for the wave-J creator-authoring integrity hardening.
// Source of truth: docs/wave-j/authoring-hardening-impl.md.
//   • negative pointValue clamp (scoringPresets: taskScoreFixed + skipAward)
//   • gameStructureProblems (empty-task stage + uncompletable + negative reject)
//   • stripUnsafeDisplayChars (bidi/control/zero-width strip on authored text)
// Import SOURCE directly (no dist rebuild needed for the RED phase). No emulator.
//   npx tsx scripts/test-authoring-hardening.ts
import { taskScoreFixed, skipAward } from '../packages/shared/src/scoringPresets';
import { gameStructureProblems, stripUnsafeDisplayChars } from '../packages/shared/src/validation';
import type { Stage, Task } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── Negative pointValue must clamp to 0, never subtract from a team total ──────
check('taskScoreFixed clamps a negative pointValue to 0', taskScoreFixed({ pointValue: -50 }) === 0);
check('taskScoreFixed keeps a positive pointValue', taskScoreFixed({ pointValue: 42 }) === 42);
check('taskScoreFixed guards NaN', taskScoreFixed({ pointValue: NaN }) === 0);
check('skipAward fixed clamps a negative pointValue to 0',
  skipAward('fixed_points_speed', { pointValue: -50, difficulty: 3, estimatedMinutes: 10 }) === 0);
check('skipAward fixed keeps a positive pointValue',
  skipAward('fixed_points_speed', { pointValue: 120, difficulty: 3, estimatedMinutes: 10 }) === 120);

// ── gameStructureProblems — the shared save/publish winnability guard ──────────
function mkTask(over: Partial<Task>): Task {
  return {
    id: 't1', title: 'T', type: 'field',
    coordinates: { lat: 0, lng: 0 },
    difficulty: 3, estimatedMinutes: 5, pointValue: 50,
    ...over,
  } as Task;
}
function mkStage(tasks: Task[], over: Partial<Stage> = {}): Stage {
  return { id: 's1', order: 0, title: 'S', tasks, ...over };
}

check('valid single-task stage → no problems',
  gameStructureProblems([mkStage([mkTask({})])]).length === 0);

check('empty-task stage → a problem',
  gameStructureProblems([mkStage([])]).length > 0);

check('uncompletable quiz (no answer) → a problem',
  gameStructureProblems([mkStage([mkTask({ type: 'quiz', answers: [] })])]).length > 0);

check('uncompletable smart_station (no secretCode) → a problem',
  gameStructureProblems([mkStage([mkTask({ type: 'smart_station' })])]).length > 0);

check('negative pointValue → a problem',
  gameStructureProblems([mkStage([mkTask({ pointValue: -50 })])]).length > 0);

check('negative difficulty → a problem',
  gameStructureProblems([mkStage([mkTask({ difficulty: -3 })])]).length > 0);

check('negative estimatedMinutes → a problem',
  gameStructureProblems([mkStage([mkTask({ estimatedMinutes: -1 })])]).length > 0);

check('empty stages array → no problems (empty game is allowed at save)',
  gameStructureProblems([]).length === 0);

// ── stripUnsafeDisplayChars — bidi / control / zero-width strip ────────────────
check('strips RLO bidi override', stripUnsafeDisplayChars('a‮b') === 'ab');
check('strips zero-width space', stripUnsafeDisplayChars('a​b') === 'ab');
check('keeps Hebrew letters', stripUnsafeDisplayChars('שלום') === 'שלום');
check('keeps LRM/RLM directional marks', stripUnsafeDisplayChars('a‎b‏c') === 'a‎b‏c');

console.log(`\n${failures === 0 ? 'ALL AUTHORING-HARDENING TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

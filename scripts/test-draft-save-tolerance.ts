// Pure-logic tests for the draft-save tolerance rule (change: builder-draft-save-tolerance).
//
// THE BUG THIS PINS: the Builder autosaves 1.5 s after any edit. `updateGame` ran
// the FULL structural guard, including `taskCompletabilityError` — so the moment a
// creator picked "quiz" as a task type, every autosave was refused with
// `invalid-argument` until the answer key was finished. Authoring was silently not
// persisted, and the readiness popover force-reopened on every rejection.
//
// THE RULE: an unfinished ANSWER KEY is a draft state, not a corrupt one. It belongs
// to the go-live gate, never the save gate. Every OTHER guard is corruption (a
// negative point value, an unreachable requiredTaskCount, an impossible availability
// window) and stays save-blocking, because no amount of further authoring makes it
// legitimate.
//
// Enforcement split after this change:
//   • authoring (updateGame / importGameFile) → 'authoring' phase, completability skipped
//   • go-live   (publishGame / launchRun)     → 'golive'   phase, completability enforced
// launchRun keeps its OWN independent loop over `taskCompletabilityError`
// (functions/src/runs/index.ts) — that is what makes relaxing the save path safe.
//
// Import SOURCE directly (no dist rebuild needed for the RED phase). No emulator.
//   npx tsx scripts/test-draft-save-tolerance.ts
import { gameStructureProblems } from '../packages/shared/src/validation';
import type { Stage, Task } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

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

// Every answer-key-bearing type, each mid-authoring with the key not yet filled in.
const UNFINISHED_KEYS: Array<[string, Task]> = [
  ['quiz with no answers', mkTask({ type: 'quiz', answers: [] })],
  ['quiz with only blank answers', mkTask({ type: 'quiz', answers: ['', '  '] })],
  ['numeric with no numericAnswer', mkTask({ type: 'numeric' })],
  ['smart_station with no secretCode', mkTask({ type: 'smart_station' })],
  ['sequence with no steps', mkTask({ type: 'sequence', steps: [] })],
];

// ── The default is STRICT — every existing caller keeps today's behavior ────────
// (test-authoring-hardening.ts already pins the no-arg form; this pins that the
// explicit go-live phase is identical, so publishGame/launchRun cannot drift.)
for (const [label, task] of UNFINISHED_KEYS) {
  check(`go-live phase still REJECTS: ${label}`,
    gameStructureProblems([mkStage([task])], { phase: 'golive' }).length > 0);
  check(`default (no opts) still REJECTS: ${label}`,
    gameStructureProblems([mkStage([task])]).length > 0);
}

// ── Authoring phase SAVES an unfinished answer key ─────────────────────────────
for (const [label, task] of UNFINISHED_KEYS) {
  check(`authoring phase ACCEPTS: ${label}`,
    gameStructureProblems([mkStage([task])], { phase: 'authoring' }).length === 0,
    JSON.stringify(gameStructureProblems([mkStage([task])], { phase: 'authoring' })));
}

// A finished answer key is of course fine in both phases.
const finishedQuiz = mkTask({ type: 'quiz', answers: ['ירושלים'] });
check('authoring phase accepts a finished quiz',
  gameStructureProblems([mkStage([finishedQuiz])], { phase: 'authoring' }).length === 0);
check('go-live phase accepts a finished quiz',
  gameStructureProblems([mkStage([finishedQuiz])], { phase: 'golive' }).length === 0);

// ── CORRUPTION stays save-blocking in BOTH phases ──────────────────────────────
// These are not "unfinished" — no further authoring makes them legitimate, so
// relaxing them would let a broken shape reach the database.
const CORRUPT: Array<[string, Stage]> = [
  ['negative pointValue', mkStage([mkTask({ pointValue: -50 })])],
  ['negative difficulty', mkStage([mkTask({ difficulty: -3 })])],
  ['negative estimatedMinutes', mkStage([mkTask({ estimatedMinutes: -1 })])],
  ['non-finite expectedDurationMinutes', mkStage([mkTask({ expectedDurationMinutes: NaN })])],
  ['negative expectedDurationMinutes', mkStage([mkTask({ expectedDurationMinutes: -5 })])],
  ['stage with no tasks', mkStage([])],
];
for (const [label, stage] of CORRUPT) {
  check(`authoring phase still REJECTS corruption: ${label}`,
    gameStructureProblems([stage], { phase: 'authoring' }).length > 0);
  check(`go-live phase still REJECTS corruption: ${label}`,
    gameStructureProblems([stage], { phase: 'golive' }).length > 0);
}

// A corrupt task that is ALSO missing its answer key still fails the authoring
// phase — relaxing completability must not swallow the co-occurring real problem.
check('authoring phase rejects a negative-value quiz that is also key-less',
  gameStructureProblems([mkStage([mkTask({ type: 'quiz', answers: [], pointValue: -10 })])],
    { phase: 'authoring' }).length > 0);

// An empty game is fine everywhere (a game still being built).
check('empty stages array is fine in the authoring phase',
  gameStructureProblems([], { phase: 'authoring' }).length === 0);

console.log(failures === 0 ? '\n✅ ALL PASS' : `\n❌ ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

// Pure-logic tests for task-creation-wizard (wizardLogic navigation + metadata).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  blankTask,
  canGoNext,
  canGoBack,
  isTaskLocationValid,
  isTaskInteractionValid,
  TASK_TYPE_META,
  TYPE_PICKER_ORDER,
  WIZARD_STEPS,
  STEP_LABELS,
} from '../apps/creator-web/src/lib/wizardLogic';
import type { Task } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── blankTask default shape ──────────────────────────────────────────────────
const fresh = blankTask();
ok(!fresh.locationless, 'blankTask is not locationless');
ok(fresh.coordinates.lat === 0 && fresh.coordinates.lng === 0, 'blankTask starts with no pin (0,0)');
ok(fresh.title === '' && fresh.type === 'field', 'blankTask: empty title, field type');
ok(typeof fresh.id === 'string' && fresh.id.length > 0, 'blankTask gets an id');
ok(blankTask('fixed').id === 'fixed', 'blankTask accepts an explicit id');

// ── canGoNext ────────────────────────────────────────────────────────────────
ok(canGoNext(1, fresh) === true, 'step 1 always passable (even with 0,0 coords)');
ok(canGoNext(1, { ...fresh, coordinates: { lat: 31.7, lng: 35.1 } }) === true, 'step 1 passable with real coords too');
ok(canGoNext(2, fresh) === false, 'step 2 blocked with a blank title');
ok(canGoNext(2, { ...fresh, title: 'My task' }) === true, 'step 2 passable once titled');
ok(canGoNext(2, { ...fresh, title: '   ' }) === false, 'step 2 blocked for whitespace-only title');
ok(canGoNext(3, fresh) === false, 'step 3 is terminal');

// ── canGoBack ────────────────────────────────────────────────────────────────
ok(canGoBack(1) === false, 'cannot go back from step 1');
ok(canGoBack(2) === true && canGoBack(3) === true, 'can go back from steps 2 and 3');

// ── isTaskLocationValid ──────────────────────────────────────────────────────
ok(isTaskLocationValid({ ...fresh, locationless: true }) === true, 'locationless task valid even at 0,0');
ok(isTaskLocationValid({ ...fresh, triggerMode: 'instant' } as Task) === true, 'instant-trigger task valid at 0,0');
ok(isTaskLocationValid(fresh) === false, 'located task with 0,0 is invalid');
ok(isTaskLocationValid({ ...fresh, coordinates: { lat: 31.79, lng: 35.16 } }) === true, 'located task with real coords is valid');

// ── isTaskInteractionValid — block saving unwinnable tasks ───────────────────
// quiz: needs at least one non-empty accepted answer
ok(isTaskInteractionValid({ ...fresh, type: 'quiz' }) === false, 'quiz with no answers is unwinnable');
ok(isTaskInteractionValid({ ...fresh, type: 'quiz', answers: ['  '] }) === false, 'quiz with only blank answers is unwinnable');
ok(isTaskInteractionValid({ ...fresh, type: 'quiz', answers: ['Paris'] }) === true, 'quiz with a real answer is valid');
// numeric: matchesTaskAnswer always fails when numericAnswer is missing/NaN
ok(isTaskInteractionValid({ ...fresh, type: 'numeric' }) === false, 'numeric without an answer is unwinnable');
ok(isTaskInteractionValid({ ...fresh, type: 'numeric', numericAnswer: NaN }) === false, 'numeric with NaN answer is unwinnable');
ok(isTaskInteractionValid({ ...fresh, type: 'numeric', numericAnswer: 0 }) === true, 'numeric answer 0 is a valid answer');
ok(isTaskInteractionValid({ ...fresh, type: 'numeric', numericAnswer: 42 }) === true, 'numeric with an answer is valid');
// smart_station: verifyStationCode rejects everything when no secretCode is set
ok(isTaskInteractionValid({ ...fresh, type: 'smart_station' }) === false, 'station without a secret code is unwinnable');
ok(isTaskInteractionValid({ ...fresh, type: 'smart_station', smart: { verificationType: 'code_verification', secretCode: '  ' } } as Task) === false, 'station with blank code is unwinnable');
ok(isTaskInteractionValid({ ...fresh, type: 'smart_station', smart: { verificationType: 'code_verification', secretCode: 'OPEN' } } as Task) === true, 'station with a code is valid');
// sequence: submitSequenceStep throws failed-precondition when steps is empty
ok(isTaskInteractionValid({ ...fresh, type: 'sequence' }) === false, 'sequence without steps is unwinnable');
ok(isTaskInteractionValid({ ...fresh, type: 'sequence', steps: [] }) === false, 'sequence with empty steps is unwinnable');
ok(isTaskInteractionValid({ ...fresh, type: 'sequence', steps: [{ id: 's1', prompt: 'go', answer: '' }] } as Task) === true, 'sequence with a step is valid (empty answer = tap-to-confirm)');
// self-validating types stay valid
ok(isTaskInteractionValid({ ...fresh, type: 'field' }) === true, 'field task always valid');
ok(isTaskInteractionValid({ ...fresh, type: 'photo' }) === true, 'photo task always valid');

// ── TASK_TYPE_META ───────────────────────────────────────────────────────────
const metaKeys = Object.keys(TASK_TYPE_META);
ok(metaKeys.length === 8, `TASK_TYPE_META has exactly 8 task types (got ${metaKeys.length})`);
ok(Object.values(TASK_TYPE_META).every((m) => m.label.trim() && m.description.trim() && m.emoji), 'every type has emoji + label + description');
ok(TYPE_PICKER_ORDER.length === 8 && new Set(TYPE_PICKER_ORDER).size === 8, 'TYPE_PICKER_ORDER lists all 8 types once');
ok(TYPE_PICKER_ORDER.every((t) => t in TASK_TYPE_META), 'every picker-order type has metadata');

// ── steps / labels ───────────────────────────────────────────────────────────
ok(WIZARD_STEPS.length === 3, 'three wizard steps');
ok(WIZARD_STEPS.every((s) => STEP_LABELS[s]?.trim()), 'every step has a label');

console.log(failed === 0
  ? `\n✅ ALL WIZARD TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

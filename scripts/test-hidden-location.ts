// Pure-logic tests for hidden-location task validation (change: hidden-location-task).
// A hidden task keeps real coordinates server-side and is gated by physical arrival,
// so it MUST carry valid coordinates + a proximity (radius/exact) trigger. A missing
// clue is a soft warning only, never a hard block. No emulator.
//   npx tsx scripts/test-hidden-location.ts
import { checkHiddenLocationTask, type Task } from '../packages/shared/src/index';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const at = { lat: 31.78, lng: 35.21 };

// A non-hidden task is always fine (the check is a no-op for visible tasks).
check('visible task is ok regardless of clue/coords',
  checkHiddenLocationTask({ coordinates: undefined, hideLocation: false } as unknown as Task).ok === true);

// Hidden + valid coordinates + radius trigger → ok.
const good = checkHiddenLocationTask({
  hideLocation: true, coordinates: at, triggerMode: 'radius', locationClue: 'find me',
} as Task);
check('hidden with coords + radius + clue is ok', good.ok === true);
check('hidden valid task has no error', good.error === undefined);
check('hidden valid task with a clue has no warning', good.warning === undefined);

// Hidden without coordinates → blocked.
const noCoords = checkHiddenLocationTask({
  hideLocation: true, coordinates: undefined, triggerMode: 'radius',
} as unknown as Task);
check('hidden without coordinates is blocked', noCoords.ok === false);
check('hidden without coordinates flags no_coordinates', noCoords.error === 'no_coordinates', noCoords.error);

// Hidden with an invalid (out-of-range) coordinate → blocked.
const badCoords = checkHiddenLocationTask({
  hideLocation: true, coordinates: { lat: 999, lng: 0 }, triggerMode: 'radius',
} as Task);
check('hidden with invalid coordinates is blocked', badCoords.ok === false);

// Hidden with a non-proximity trigger (locationless/instant) → blocked: arrival can't gate it.
const wrongMode = checkHiddenLocationTask({
  hideLocation: true, coordinates: at, triggerMode: 'instant',
} as Task);
check('hidden with a non-proximity trigger is blocked', wrongMode.ok === false);
check('hidden with wrong trigger flags wrong_trigger', wrongMode.error === 'wrong_trigger', wrongMode.error);

// Hidden, valid coords, but no clue → still ok, but a soft warning.
const noClue = checkHiddenLocationTask({
  hideLocation: true, coordinates: at, triggerMode: 'radius',
} as Task);
check('hidden without a clue is still ok (not blocked)', noClue.ok === true);
check('hidden without a clue raises a no_clue warning', noClue.warning === 'no_clue', String(noClue.warning));

console.log(`\n${failures === 0 ? 'ALL HIDDEN-LOCATION TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

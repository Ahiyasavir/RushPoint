// Pure-logic test for partialStageStarvationWarning (WO-6 / sim-01 defect #2).
// In a partial stage, locationless tasks (transit cost 0) get picked before any
// located station, so a physical stop can go unvisited. The Builder warns on this
// mix. No emulator. Run: npx tsx scripts/test-partial-stage-starvation.ts
import { partialStageStarvationWarning } from '../packages/shared/src/gating';

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const loc = { locationless: true };
const pin = { locationless: false };

// Mixed + partial cap → warn.
check(
  'warns on a partial stage mixing locationless + located',
  partialStageStarvationWarning({ requiredTaskCount: 1, tasks: [loc, pin, pin] }) === true,
);

// No cap (all tasks required) → never warn.
check(
  'no warning when requiredTaskCount is undefined',
  partialStageStarvationWarning({ tasks: [loc, pin] }) === false,
);

// Cap >= task count → not actually partial → no warn.
check(
  'no warning when the cap is not below the task count',
  partialStageStarvationWarning({ requiredTaskCount: 2, tasks: [loc, pin] }) === false,
);

// Partial but all located → no starvation risk from locationless.
check(
  'no warning when every task is located',
  partialStageStarvationWarning({ requiredTaskCount: 1, tasks: [pin, pin, pin] }) === false,
);

// Partial but all locationless → nothing physical to starve.
check(
  'no warning when every task is locationless',
  partialStageStarvationWarning({ requiredTaskCount: 1, tasks: [loc, loc] }) === false,
);

console.log(`\n${failures === 0 ? 'ALL PARTIAL-STAGE-STARVATION TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

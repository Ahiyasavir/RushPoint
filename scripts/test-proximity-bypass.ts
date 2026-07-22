// Pure-logic test for the test-run proximity bypass predicate (wave-J).
//   npx tsx scripts/test-proximity-bypass.ts
//
// proximitySatisfied(distanceOk, isTestDrive) = isTestDrive === true || distanceOk.
// In a TEST run any submission passes (desk rehearsal); in a real run the distance
// verdict rules (anti-cheat). The flag MUST come from the server run doc, never a
// client payload — this pure test only pins the truth table the server gates rely on.
import { proximitySatisfied } from '../packages/shared/src/geo';

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

// Real run (isTestDrive falsy): the distance verdict rules.
check('real run, close → pass', proximitySatisfied(true, false) === true);
check('real run, far → reject (anti-cheat)', proximitySatisfied(false, false) === false);

// Test run (isTestDrive true): always pass regardless of distance.
check('TEST run, far → pass (the feature)', proximitySatisfied(false, true) === true);
check('test run, close → pass', proximitySatisfied(true, true) === true);

// A missing/undefined flag is treated as a real run (never a bypass).
check('undefined flag, close → pass', proximitySatisfied(true, undefined) === true);
check('undefined flag, far → reject', proximitySatisfied(false, undefined) === false);

// Only the literal boolean true bypasses — no truthy coercion of a stray value.
check('non-true flag does not bypass', proximitySatisfied(false, 1 as unknown as boolean) === false);

// Real-run identity: for a falsy flag the predicate is exactly distanceOk, so a
// real run is byte-identical to the pre-bypass behavior for every distance verdict.
for (const d of [true, false]) {
  check(`identity: p(${d}, false) === ${d}`, proximitySatisfied(d, false) === d);
  check(`identity: p(${d}, undefined) === ${d}`, proximitySatisfied(d, undefined) === d);
}

console.log(`\n${failures === 0 ? 'ALL PROXIMITY-BYPASS TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

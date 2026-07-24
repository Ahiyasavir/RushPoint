// Pure-logic test for the creator launch "liftoff" rotation seam
// (change: creator-launch-liftoff).
//
// The creator presses "Launch run" and waits through a save + `launchRun`
// round-trip. That wait now shows an engaging multi-step overlay
// (<LaunchLiftoff>) whose only automatable seam is the pure step-rotation
// function `liftoffStepIndex`. It must mirror play-web's `workingMessageIndex`
// exactly: a single/empty step set never rotates, otherwise the tick wraps, and
// it is total — never throws for any tick or count. Because these steps are
// reassurance (a single opaque launch round-trip), the ONLY correctness the
// helper must guarantee is a defined, in-range index for every input.
//
// No emulator, no React runner.
//   npx tsx scripts/test-launch-liftoff.ts
import { liftoffStepIndex } from '../apps/creator-web/src/lib/launchLiftoff';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── No rotation for a single/empty step set ──────────────────────────────────
console.log('\n── no rotation ──');
for (const tick of [0, 1, 2, 5, 100, -3]) {
  check(`count 0, tick ${tick} ⇒ 0`, liftoffStepIndex(tick, 0) === 0);
  check(`count 1, tick ${tick} ⇒ 0`, liftoffStepIndex(tick, 1) === 0);
}

// ── Wraps across a 3-step set ────────────────────────────────────────────────
console.log('\n── wrap (count 3) ──');
const want = [0, 1, 2, 0, 1, 2, 0];
want.forEach((exp, tick) => {
  const got = liftoffStepIndex(tick, 3);
  check(`tick ${tick} ⇒ ${exp}`, got === exp, `got ${got}`);
});

// ── Negative and non-finite handled, never throws, always in range ───────────
console.log('\n── total function / range ──');
const ticks: unknown[] = [-1, -2, -7, -100, 0.9, 2.4, NaN, Infinity, -Infinity, undefined, null];
const counts: unknown[] = [0, 1, 2, 3, 4, 2.7, NaN, Infinity, -1, undefined, null];
let rangeBad = 0;
let threw = 0;
for (const rawTick of ticks) {
  for (const rawCount of counts) {
    let got: number;
    try {
      got = liftoffStepIndex(rawTick as number, rawCount as number);
    } catch {
      threw++;
      continue;
    }
    // The result must be a defined integer in [0, count) (or 0 when count ≤ 1).
    const n = Number.isFinite(rawCount as number) && (rawCount as number) > 1
      ? Math.floor(rawCount as number) : 1;
    if (!Number.isInteger(got) || got < 0 || got >= n) {
      rangeBad++;
      console.log(`  out of range: tick=${String(rawTick)} count=${String(rawCount)} -> ${got}`);
    }
  }
}
check('never throws for any tick/count', threw === 0, `${threw} threw`);
check('always an integer in [0, count)', rangeBad === 0, `${rangeBad} bad`);

// ── Matches the play-web twin's contract on the shared cases ─────────────────
console.log('\n── twin parity ──');
check('negative tick wraps forward (tick -1, count 3 ⇒ 2)', liftoffStepIndex(-1, 3) === 2);
check('a large tick wraps (tick 10, count 4 ⇒ 2)', liftoffStepIndex(10, 4) === 2);
check('a fractional tick floors first (tick 4.9, count 3 ⇒ 1)', liftoffStepIndex(4.9, 3) === 1);

console.log(`\n${failures === 0 ? 'ALL LAUNCH-LIFTOFF TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

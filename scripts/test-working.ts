// Pure-logic test for the <Working> panel's message rotation (change:
// play-working-feedback). The one genuinely extractable decision in the "we're
// working, you're advancing" indicator is WHICH message shows at rotation tick N.
// It must be total (any tick, any count, never throws) and always in range, so a
// negative or huge tick can never index past the message array.
//
//   npx tsx scripts/test-working.ts
import { workingMessageIndex } from '../apps/play-web/src/lib/working';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

console.log('\n── workingMessageIndex ──');

// A single or empty message set never rotates: always index 0.
for (let t = 0; t < 5; t++) {
  check(`count 0 stays 0 at tick ${t}`, workingMessageIndex(t, 0) === 0);
  check(`count 1 stays 0 at tick ${t}`, workingMessageIndex(t, 1) === 0);
}

// count 3 wraps 0,1,2,0,1,2 across ticks 0..5.
const expected = [0, 1, 2, 0, 1, 2];
expected.forEach((exp, tick) => {
  const got = workingMessageIndex(tick, 3);
  check(`count 3 tick ${tick} => ${exp}`, got === exp, `got ${got}`);
});

// A negative tick stays in [0, count).
for (const tick of [-1, -2, -3, -4, -7, -30]) {
  const got = workingMessageIndex(tick, 3);
  check(`negative tick ${tick} in range`, got >= 0 && got < 3, `got ${got}`);
}
check('negative tick -1 wraps to 2', workingMessageIndex(-1, 3) === 2, `got ${workingMessageIndex(-1, 3)}`);

// A very large tick stays in range.
for (const tick of [999, 1000, 123456, Number.MAX_SAFE_INTEGER]) {
  const got = workingMessageIndex(tick, 4);
  check(`large tick ${tick} in range`, got >= 0 && got < 4, `got ${got}`);
}

// Never throws on degenerate counts.
check('count -1 yields 0', workingMessageIndex(2, -1) === 0);

console.log(`\n${failures === 0 ? 'ALL WORKING TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

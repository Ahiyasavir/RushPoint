// Pure-logic test for sumEstimatedMinutes (change: fix-public-game-minutes-nan).
// A missing/non-finite estimatedMinutes must never poison the publicGames total
// with NaN. No emulator.
//   npx tsx scripts/test-game-stats.ts
import { sumEstimatedMinutes } from '../packages/shared/src/gameStats';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const t = (estimatedMinutes: unknown) => ({ estimatedMinutes } as { estimatedMinutes: number });

check('all present → plain sum', sumEstimatedMinutes([t(5), t(10), t(15)]) === 30);
check('empty list → 0', sumEstimatedMinutes([]) === 0);

// The actual bug: one undefined must not turn the whole total into NaN.
const oneMissing = sumEstimatedMinutes([t(5), t(undefined), t(10)]);
check('one undefined → finite total (missing counts as 0)', Number.isFinite(oneMissing) && oneMissing === 15,
  String(oneMissing));

const allMissing = sumEstimatedMinutes([t(undefined), t(undefined)]);
check('all undefined → 0, never NaN', Number.isFinite(allMissing) && allMissing === 0, String(allMissing));

check('NaN input → treated as 0', sumEstimatedMinutes([t(5), t(NaN)]) === 5);
check('Infinity input → treated as 0', sumEstimatedMinutes([t(5), t(Infinity)]) === 5);
check('negative input → clamped to 0', sumEstimatedMinutes([t(5), t(-30)]) === 5);

// End-to-end guarantee: no combination of junk yields a non-finite result.
check('never returns NaN', Number.isFinite(sumEstimatedMinutes([t(undefined), t(NaN), t(-1), t(Infinity)])));

console.log(`\n${failures === 0 ? 'ALL GAME-STATS TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

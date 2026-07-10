// Pure-logic tests for the public-leaderboard row time (change:
// fix-live-board-elapsed-time). A still-playing team's ever-growing elapsed time
// must be distinguishable from a finisher's real completion time. No emulator.
//   npx tsx scripts/test-board-time.ts
import { isFinalTime, boardTimeSeconds, formatDuration } from '../apps/play-web/src/lib/boardTime';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── isFinalTime: the crux of the bug ─────────────────────────────────────────
check('finished team → final time', isFinalTime({ finishedAt: '2026-07-10T00:00:00.000Z', durationSeconds: 1110 }));
check('in-progress team → NOT a final time (even with durationSeconds set)',
  !isFinalTime({ durationSeconds: 2520 }));
check('no fields → not final', !isFinalTime({}));

// ── boardTimeSeconds ─────────────────────────────────────────────────────────
check('durationSeconds preferred', boardTimeSeconds({ durationSeconds: 90 }) === 90);
check('falls back to totalMinutes', boardTimeSeconds({ totalMinutes: 2 }) === 120);
check('none available → null', boardTimeSeconds({}) === null);

// ── formatDuration ───────────────────────────────────────────────────────────
check('m:ss under an hour', formatDuration(1110) === '18:30');
check('h:mm:ss past an hour', formatDuration(3661) === '1:01:01');
check('negative clamps to 0:00', formatDuration(-5) === '0:00');

console.log(`\n${failures === 0 ? 'ALL BOARD-TIME TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

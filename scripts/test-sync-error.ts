// Pure-logic test for isFatalSyncError (change: fix-play-offline-continuity).
// A team-state poll failure is FATAL (replace the screen) only for not-found /
// permission-denied / unauthenticated; every transient code keeps the last state
// and shows "reconnecting". No emulator.
//   npx tsx scripts/test-sync-error.ts
import { isFatalSyncError } from '../apps/play-web/src/lib/syncError';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Fatal → surface the error screen.
check('not-found is fatal', isFatalSyncError('functions/not-found') === true);
check('permission-denied is fatal', isFatalSyncError('functions/permission-denied') === true);
check('unauthenticated is fatal', isFatalSyncError('functions/unauthenticated') === true);

// Transient → keep last state + reconnecting.
check('unavailable is transient', isFatalSyncError('functions/unavailable') === false);
check('internal is transient', isFatalSyncError('functions/internal') === false);
check('deadline-exceeded is transient', isFatalSyncError('functions/deadline-exceeded') === false);
check('undefined (raw network error) is transient', isFatalSyncError(undefined) === false);
check('empty string is transient', isFatalSyncError('') === false);

console.log(`\n${failures === 0 ? 'ALL SYNC-ERROR TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

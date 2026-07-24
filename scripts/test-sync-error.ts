// Pure-logic test for isFatalSyncError (change: fix-play-offline-continuity).
// A team-state poll failure is FATAL (replace the screen) only for not-found /
// permission-denied / unauthenticated; every transient code keeps the last state
// and shows "reconnecting". No emulator.
//   npx tsx scripts/test-sync-error.ts
import { isFatalSyncError, syncErrorVerdict, FIRST_LOAD_MAX_FAILS } from '../apps/play-web/src/lib/syncError';

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

// --- syncErrorVerdict (change: fix-play-first-load-retry-grace) -----------------
// not-found → the game/run is gone.
check('verdict not-found → game-gone', syncErrorVerdict('not-found', false, 0) === 'game-gone');
check('verdict not-found → game-gone (with state)', syncErrorVerdict('not-found', true, 99) === 'game-gone');

// Fatal auth codes → hard sync-failed regardless of hasState / budget.
check('verdict permission-denied → sync-failed', syncErrorVerdict('permission-denied', false, 0) === 'sync-failed');
check('verdict permission-denied → sync-failed (with state)', syncErrorVerdict('permission-denied', true, 0) === 'sync-failed');
check('verdict unauthenticated → sync-failed', syncErrorVerdict('unauthenticated', false, 0) === 'sync-failed');
check('verdict unauthenticated → sync-failed (with state)', syncErrorVerdict('unauthenticated', true, 0) === 'sync-failed');

// Transient WITH state → keep the game on screen and reconnect.
check('verdict transient undefined + hasState → reconnect', syncErrorVerdict(undefined, true, 0) === 'reconnect');
check('verdict transient unavailable + hasState → reconnect', syncErrorVerdict('unavailable', true, 0) === 'reconnect');
check('verdict transient internal + hasState → reconnect', syncErrorVerdict('internal', true, 0) === 'reconnect');

// Transient FIRST load, budget not spent → reconnect (retry grace).
check('verdict first-load fail 1 → reconnect', syncErrorVerdict('unavailable', false, 1) === 'reconnect');
check('verdict first-load fail below max → reconnect', syncErrorVerdict(undefined, false, FIRST_LOAD_MAX_FAILS - 1) === 'reconnect');

// Transient FIRST load, budget spent → give up with sync-failed.
check('verdict first-load fail at max → sync-failed', syncErrorVerdict('unavailable', false, FIRST_LOAD_MAX_FAILS) === 'sync-failed');
check('verdict first-load fail over max → sync-failed', syncErrorVerdict('internal', false, FIRST_LOAD_MAX_FAILS + 3) === 'sync-failed');

console.log(`\n${failures === 0 ? 'ALL SYNC-ERROR TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

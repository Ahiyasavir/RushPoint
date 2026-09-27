// The Builder's "opens at / closes at" inputs (change: mission-time-limit). A datetime-local input
// speaks LOCAL wall time without a zone; the task stores an ISO instant. These two helpers convert
// both ways, and clearing the input must store ABSENT (never null or an empty string: the
// cleared-optional-field rule).
//   npx tsx scripts/test-time-window-input.ts
import { isoToLocalInput, localInputToIso } from '../apps/creator-web/src/lib/timeWindowInput';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const iso = new Date(2026, 8, 27, 10, 30).toISOString(); // 10:30 LOCAL on the machine running this
check('an instant shows as local wall time in the input', isoToLocalInput(iso) === '2026-09-27T10:30', isoToLocalInput(iso));
check('local wall time from the input is stored as that instant', localInputToIso('2026-09-27T10:30') === iso, String(localInputToIso('2026-09-27T10:30')));
check('round trip is exact to the minute', localInputToIso(isoToLocalInput(iso)) === iso);
check('empty or garbage input stores ABSENT', localInputToIso('') === undefined && localInputToIso('soon') === undefined && localInputToIso(undefined as never) === undefined);
check('no value, or an unreadable one, shows an empty input', isoToLocalInput(undefined) === '' && isoToLocalInput('soon') === '');

console.log(`\n${failures === 0 ? 'ALL TIME-WINDOW-INPUT TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

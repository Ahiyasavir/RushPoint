// Pure tests for the "the sending phone went quiet" verdict (change: team-phones-simple, D5).
//
// A team plays with one phone sending answers. When that phone dies, runs out of battery or is left
// in a bag, the other phones used to show "X is sending for the team" forever, and nobody knew to
// take over. The server now remembers, in memory, when each phone last asked for the team state,
// and the other phones say "X's phone went quiet: take over". The verdict must FAIL OPEN: never tell
// a team its phone died because the server restarted and simply does not know yet.
//   npx tsx scripts/test-sender-quiet.ts
import { senderQuiet, SENDER_QUIET_AFTER_SEC, OTHER_ACTIVE_WITHIN_SEC } from '../packages/shared/src/senderQuiet';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

check('thresholds are the designed ones', SENDER_QUIET_AFTER_SEC === 180 && OTHER_ACTIVE_WITHIN_SEC === 90);

const S = 'sender', A = 'a', B = 'b';
check('sender seen 200 s ago, another phone seen 10 s ago: quiet',
  senderQuiet({ presence: [{ uid: S, lastSeenSec: 200 }, { uid: A, lastSeenSec: 10 }], controllerUid: S }) === true);
check('sender seen 60 s ago: not quiet',
  senderQuiet({ presence: [{ uid: S, lastSeenSec: 60 }, { uid: A, lastSeenSec: 10 }], controllerUid: S }) === false);
check('exactly at the threshold is not quiet yet',
  senderQuiet({ presence: [{ uid: S, lastSeenSec: 180 }, { uid: A, lastSeenSec: 10 }], controllerUid: S }) === false);
check('sender UNKNOWN (server restarted): not quiet (fail open)',
  senderQuiet({ presence: [{ uid: A, lastSeenSec: 10 }], controllerUid: S }) === false);
check('nobody else active recently: not quiet (the whole team may simply be walking)',
  senderQuiet({ presence: [{ uid: S, lastSeenSec: 400 }, { uid: A, lastSeenSec: 300 }], controllerUid: S }) === false);
check('the only phone is the sender: never quiet',
  senderQuiet({ presence: [{ uid: S, lastSeenSec: 999 }], controllerUid: S }) === false);
check('one of several other phones active is enough',
  senderQuiet({ presence: [{ uid: S, lastSeenSec: 500 }, { uid: A, lastSeenSec: 400 }, { uid: B, lastSeenSec: 30 }], controllerUid: S }) === true);
check('no controller named: not quiet', senderQuiet({ presence: [{ uid: A, lastSeenSec: 10 }], controllerUid: undefined }) === false);
check('junk presence is total', senderQuiet({ presence: null as never, controllerUid: S }) === false
  && senderQuiet({ presence: [{ uid: S, lastSeenSec: Number.NaN }, { uid: A, lastSeenSec: 1 }], controllerUid: S }) === false
  && senderQuiet({ presence: [null as never, { uid: A, lastSeenSec: 1 }], controllerUid: S }) === false);
check('a negative age (clock skew) is not "old"',
  senderQuiet({ presence: [{ uid: S, lastSeenSec: -500 }, { uid: A, lastSeenSec: 1 }], controllerUid: S }) === false);

console.log(`\n${failures === 0 ? 'ALL SENDER-QUIET TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

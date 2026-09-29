// When the phone shows the final screen, and why (overnight 2026-09-29, found by PLAYING).
//
// The organizer pressed "סיום ריצה" and the phones of every team that had not finished all stages
// kept showing a mission, minutes later: the final screen opened only on `team.status === 'finished'`,
// and `finalizeRun` never touches team documents. The payload already carried `run.status`. And the
// final screen's copy said "you finished all the stages", which is false for those teams.
import { finalScreenReason } from '../apps/play-web/src/lib/finalReason';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
}

check('a team that finished every stage: finished', finalScreenReason({ status: 'finished' }, { status: 'live' }) === 'finished');
check('finished beats run-ended (it really did finish)', finalScreenReason({ status: 'finished' }, { status: 'finished' }) === 'finished');
check('the organizer ended the run while the team was playing: runEnded', finalScreenReason({ status: 'active' }, { status: 'finished' }) === 'runEnded');
check('a live run and an unfinished team: keep playing', finalScreenReason({ status: 'active' }, { status: 'live' }) === null);
check('unknown run status: keep playing (fail open)', finalScreenReason({}, {}) === null && finalScreenReason(null as never, null as never) === null);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

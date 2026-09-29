// Which mission the phone shows (overnight 2026-09-29, found by PLAYING route-team-to-mission).
//
// An operator may send a team to a mission in ANOTHER stage (a "visit"): the server assigns it there
// and ships its content (getMyTeamState adds the visit to activeStageTasks). But TaskRunner looked for
// the assigned record only in the ACTIVE stage, found none, and the phone sat on "מאתרים את היעד
// הבא… נסו שוב" with no mission, for a team the organizer had just sent somewhere on purpose.
import { currentAssignedRec } from '../apps/play-web/src/lib/currentMission';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
}

const active = { stageId: 's1', status: 'active', tasks: [{ taskId: 'a', status: 'completed' }, { taskId: 'b', status: 'unassigned' }] };
const later = { stageId: 's2', status: 'locked', tasks: [{ taskId: 'v', status: 'assigned' }, { taskId: 'w', status: 'unassigned' }] };

check('a mission assigned in the active stage is the current one',
  currentAssignedRec({ ...active, tasks: [...active.tasks, { taskId: 'c', status: 'assigned' }] }, [active, later])?.taskId === 'c');
check('a VISIT (assigned in another stage) is the current one when the active stage holds none',
  currentAssignedRec(active, [active, later])?.taskId === 'v');
check('nothing assigned anywhere ⇒ none', currentAssignedRec(active, [active, { ...later, tasks: [{ taskId: 'v', status: 'completed' }] }]) === undefined);
check('junk never throws', currentAssignedRec(null as never, null as never) === undefined && currentAssignedRec(active, [null] as never) === undefined);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

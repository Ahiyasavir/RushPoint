// Pure-logic tests for lockedTaskIds() — the server-authoritative "which
// unassigned active-stage tasks are GENUINELY gated (release/unlock) vs merely
// awaiting routing" decision (change: wave-f next-task-regression, Bug A).
//
// This is the signal getMyTeamState ships to the client so the play UI can stop
// mis-classifying "unassigned because routing hasn't picked it yet" as "locked"
// now that non-assigned task CONTENT is omitted from the payload (wave D). The
// decision must depend only on game-rule + team-record state, never on whether
// sanitized content happens to be on the wire.
//
// Run by scripts/run-unit-tests.mjs via `npm test`. No emulator needed.
import { lockedTaskIds } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const NOW = Date.parse('2026-07-22T12:00:00.000Z');
const START = '2026-07-22T11:00:00.000Z'; // run launched 60 min ago

// An ungated task (no unlock/release gate) is NOT locked — routing can hand it
// out this instant, so it must be absent from lockedTaskIds.
ok(lockedTaskIds([{ id: 'a' }], [], START, NOW).length === 0,
  'ungated task → not locked (routable now)');

// An unlock-gated task with an UNMET prerequisite is locked.
ok(lockedTaskIds([{ id: 'b', unlockAfterTaskIds: ['a'] }], [], START, NOW).join() === 'b',
  'unlock-gated with unmet prereq → locked');

// The same task once its prerequisite is completed is no longer locked.
ok(lockedTaskIds([{ id: 'b', unlockAfterTaskIds: ['a'] }], ['a'], START, NOW).length === 0,
  'unlock-gated with met prereq → not locked');

// A release-scheduled task not yet released is locked (releaseAfterMinutes in the
// future relative to the run start).
ok(lockedTaskIds([{ id: 'c', releaseAfterMinutes: 120 }], [], START, NOW).join() === 'c',
  'release-scheduled (not yet released) → locked');

// A release-scheduled task whose window has passed is not locked.
ok(lockedTaskIds([{ id: 'c', releaseAfterMinutes: 30 }], [], START, NOW).length === 0,
  'release-scheduled (already released) → not locked');

// THE REGRESSION CASE (Bug A): a multi-task stage where ONE task is routable and
// ONE is genuinely gated. Only the gated id is returned — so the client sees a
// routable task remains and shows the routing spinner, NOT a false "all locked".
{
  const ids = lockedTaskIds(
    [{ id: 'routable' }, { id: 'gated', unlockAfterTaskIds: ['done'] }],
    [], START, NOW,
  );
  ok(ids.length === 1 && ids[0] === 'gated',
    'mixed stage → only the genuinely-gated task is locked (routable one is not)');
}

// A hidden-location task carries no unlock/release gate → routable, not locked
// (its "sealed until arrival" state is handled elsewhere, not by lock gating).
ok(lockedTaskIds([{ id: 'hidden', hideLocation: true } as { id: string }], [], START, NOW).length === 0,
  'hidden-location task without a gate → not locked (routable)');

// Empty candidate list → empty result (nothing to lock).
ok(lockedTaskIds([], [], START, NOW).length === 0, 'no candidates → empty');

console.log(failed === 0
  ? `\n✅ ALL LOCKED-TASK-IDS TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

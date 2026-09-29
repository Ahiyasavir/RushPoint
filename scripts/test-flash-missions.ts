// Pure-logic tests for flash missions v2 (change: flash-missions-v2).
//
// Field report 2026-09-27: a flash mission was a banner nobody could act on. Now teams press
// "לקחתי", do it, and go back to the mission they were on (its time limit does not run meanwhile);
// the organizer chooses per flash mission whether only the FIRST team or ANY team may take it.
import { flashClaimVerdict, flashMissionState, resumedStartedAt, flashMyClaimLine, flashClaimsByFlash } from '../packages/shared/src/flashMission';
import { appendScoreLedger } from '../packages/shared/src/scoreLedger';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}\n      got  ${a}\n      want ${e}`);
}

const NOW = Date.parse('2026-09-28T10:00:00.000Z');
const later = (min: number) => new Date(NOW + min * 60_000).toISOString();
const base = { isActive: true, expiresAt: later(10), claimMode: 'first', doneBy: 'photo' } as const;

// D6 (overnight 2026-09-29): a claim lives on the TEAM (`team.flashClaims[flashId]`); the flash
// document keeps only `takenBy` in first mode. Every phone listens to the flash documents, so a
// claims map there made each claim a read on every phone (about 40,000 reads for one "many" flash at
// 100 teams). These cases pin the new shape.
console.log('\n— flashMissionState —');
eq('open', flashMissionState(base, NOW), 'open');
eq('ended by the organizer', flashMissionState({ ...base, isActive: false, endedAt: later(-1) }, NOW), 'ended');
eq('expired by time', flashMissionState({ ...base, expiresAt: later(-1) }, NOW), 'expired');
eq('first-team mission with a holder is taken', flashMissionState({ ...base, takenBy: 'A' }, NOW), 'taken');
eq('an empty holder is open', flashMissionState({ ...base, takenBy: '' }, NOW), 'open');
eq('"many" is never taken', flashMissionState({ ...base, claimMode: 'many', takenBy: 'A' }, NOW), 'open');
eq('a stray claims map on the flash doc means nothing now', flashMissionState({ ...base, claims: { A: { status: 'claimed' } } } as never, NOW), 'open');
eq('junk ⇒ ended, never a throw', flashMissionState(null as never, NOW), 'ended');

console.log('\n— flashClaimVerdict —');
const team = { stages: [] };
const v = (flash: object, teamId: string, t: object) => flashClaimVerdict({ flash: flash as never, flashId: 'f1', teamId, team: t as never, nowMs: NOW });
eq('a team can take an open mission', v(base, 'B', team), 'ok');
eq('first team only: B is refused once A holds it', v({ ...base, takenBy: 'A' }, 'B', team), 'taken');
eq('"many": B may take it too', v({ ...base, claimMode: 'many' }, 'B', team), 'ok');
eq('the same team cannot take it twice (its own claim, on its own doc)', v({ ...base, takenBy: 'A' }, 'A', { flashClaims: { f1: { status: 'claimed' } } }), 'alreadyClaimed');
eq('a claim on ANOTHER flash mission does not count', v(base, 'A', { flashClaims: { f2: { status: 'claimed' } } }), 'ok');
eq('a team that gave it up may take it again', v(base, 'A', { flashClaims: { f1: { status: 'released' } } }), 'ok');
eq('a team whose sending was not approved may try again', v(base, 'A', { flashClaims: { f1: { status: 'rejected' } } }), 'ok');
eq('a team that already won it cannot take it again', v({ ...base, claimMode: 'many' }, 'A', { flashClaims: { f1: { status: 'approved' } } }), 'alreadyClaimed');
eq('ended', v({ ...base, isActive: false }, 'B', team), 'ended');
eq('expired', v({ ...base, expiresAt: later(-1) }, 'B', team), 'expired');
eq('announce-only missions are not taken', v({ ...base, doneBy: 'announce' }, 'B', team), 'announceOnly');
eq('a legacy flash mission (no claimMode) is announce-only', v({ isActive: true, expiresAt: later(5) }, 'B', team), 'announceOnly');
eq('a team already on another flash mission', v(base, 'B', { flashSuspension: { flashId: 'other' } }), 'busyWithFlash');
eq('a paused team', v(base, 'B', { held: true }), 'teamCannotPlay');
eq('a removed team', v(base, 'B', { removed: true }), 'teamCannotPlay');

console.log('\n— back to the mission, with its time intact —');
// On mission M since 09:50 with a 20-minute limit ⇒ 10 min left at 10:00. Takes a flash mission at
// 10:00, returns at 10:06. M's clock moves forward by 6 minutes: still 10 min left.
eq('startedAt moves forward by the time away', resumedStartedAt('2026-09-28T09:50:00.000Z', '2026-09-28T10:00:00.000Z', Date.parse('2026-09-28T10:06:00.000Z')), '2026-09-28T09:56:00.000Z');
eq('no suspension stamp ⇒ unchanged', resumedStartedAt('2026-09-28T09:50:00.000Z', undefined, NOW), '2026-09-28T09:50:00.000Z');
eq('a suspension "in the future" (clock skew) never moves it backwards', resumedStartedAt('2026-09-28T09:50:00.000Z', '2026-09-28T10:30:00.000Z', NOW), '2026-09-28T09:50:00.000Z');
eq('junk start ⇒ unchanged (null)', resumedStartedAt(undefined, '2026-09-28T10:00:00.000Z', NOW), null);

console.log('\n— the points are recorded AS a flash-mission award —');
{
  const led = appendScoreLedger([], [{ at: '2026-09-28T10:00:00.000Z', delta: 25, kind: 'flash', reason: 'first to the farm', flashId: 'f1' }]);
  eq('the ledger keeps a flash entry', led.length, 1);
  eq('with its kind and its flash mission', [led[0]?.kind, led[0]?.flashId], ['flash', 'f1']);
}

console.log('');
// The phone's line about ITS OWN claim (found by playing it: after sending, and even after winning,
// the banner kept saying "you already took this mission").
eq('my claim: claimed', flashMyClaimLine({ status: 'claimed' }), 'claimed');
eq('my claim: sent, waiting for approval', flashMyClaimLine({ status: 'submitted' }), 'waiting');
eq('my claim: approved', flashMyClaimLine({ status: 'approved' }), 'won');
eq('my claim: rejected', flashMyClaimLine({ status: 'rejected' }), 'rejected');
eq('my claim: released (gave it back) says nothing', flashMyClaimLine({ status: 'released' }), null);
eq('my claim: none', flashMyClaimLine(undefined), null);
eq('my claim: junk', flashMyClaimLine({ status: 'weird' } as never), null);

console.log('\n— flashClaimsByFlash (D6: the console and the staff app read claims off the teams) —');
{
  const byFlash = flashClaimsByFlash([
    { id: 'A', flashClaims: { f1: { status: 'claimed', at: 'x' }, f2: { status: 'approved' } } },
    { id: 'B', flashClaims: { f1: { status: 'submitted' } } },
    { id: 'C' },
    null,
    { id: 'D', flashClaims: { f1: null, f3: 'junk' } },
  ] as never);
  eq('grouped by flash mission, then by team', Object.keys(byFlash.f1 ?? {}).sort(), ['A', 'B']);
  eq('each claim kept whole', byFlash.f1?.A, { status: 'claimed', at: 'x' });
  eq('another flash mission has its own takers', Object.keys(byFlash.f2 ?? {}), ['A']);
  eq('junk entries are skipped', byFlash.f3, undefined);
  eq('no teams, no claims', flashClaimsByFlash(undefined as never), {});
}

if (failures > 0) {
  console.error(`✗ flash-missions: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ flash-missions: all assertions passed\n');

// Pure-logic tests for the creator's rehearsal entry (change: test-drive-straight-to-play).
//
// "בדיקה" used to launch a test run and drop the creator on the ORGANIZER
// console: a QR code and the live-ops panel, i.e. the same screen a real event
// gets and nothing at all like playing the game. It now opens play-web on that
// run's own code with `?testdrive`, and two pure decisions carry the flow:
//
//   1. resolvePlayRoute must turn `?code=X&testdrive` into a join route flagged
//      `autoJoin` — and a bare `?testdrive` must not change any other route.
//   2. planTestDriveAutoJoin decides whether we may join on the creator's behalf.
//      The load-bearing rule is that the SERVER's `isTestDrive` is the gate, not
//      the URL: forging `?testdrive` onto someone else's real code must fall back
//      to the ordinary form.
//
// No emulator, no DOM.
//   npx tsx scripts/test-test-drive-autojoin.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RegistrationField } from '../packages/shared/src/types/index';
import { planTestDriveAutoJoin } from '../apps/play-web/src/lib/testDriveAutoJoin';
import { resolvePlayRoute, TEST_DRIVE_ROUTE_PARAM } from '../apps/play-web/src/lib/playRoute';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const NAME: RegistrationField = { id: 'name', label: 'Name', type: 'text', required: true, level: 'member' };
const PHONE: RegistrationField = { id: 'phone', label: 'Phone', type: 'text', required: true, level: 'member' };
const SHIRT: RegistrationField = { id: 'shirt', label: 'Shirt', type: 'select', required: false, level: 'member' };

function plan(over: Partial<Parameters<typeof planTestDriveAutoJoin>[0]> = {}) {
  return planTestDriveAutoJoin({
    requested: true, isTestDrive: true, runStatus: 'live',
    mode: 'individual', registrationFields: [NAME], playerName: 'בדיקה',
    ...over,
  });
}

// ── planTestDriveAutoJoin ────────────────────────────────────────────────────
console.log('\n── planTestDriveAutoJoin ──');

const happy = plan();
check('a requested test-drive join auto-joins', happy.kind === 'join');
check('the rehearsing creator is the sole member',
  happy.kind === 'join' && happy.memberNames.length === 1 && happy.memberNames[0] === 'בדיקה');
check('individual mode sends no teamName',
  happy.kind === 'join' && Object.keys(happy.values).length === 0);

const team = plan({ mode: 'team' });
check('team mode supplies the required teamName',
  team.kind === 'join' && team.values.teamName === 'בדיקה', JSON.stringify(team));

check('no ?testdrive in the URL means the normal form', plan({ requested: false }).kind === 'form');

// THE security-relevant case: the URL claims a rehearsal, the server disagrees.
const forged = plan({ isTestDrive: false });
check('a forged ?testdrive on a real run falls back to the form',
  forged.kind === 'form' && forged.reason === 'notTestDrive', JSON.stringify(forged));

const finished = plan({ runStatus: 'finished' });
check('a finished run is never auto-joined',
  finished.kind === 'form' && finished.reason === 'finished');

const required = plan({ registrationFields: [NAME, PHONE] });
check('a required custom field stops the auto-join',
  required.kind === 'form' && required.reason === 'requiredFields', JSON.stringify(required));

check('an OPTIONAL custom field does not stop it',
  plan({ registrationFields: [NAME, SHIRT] }).kind === 'join');

check('a blank player name falls back rather than joining anonymously',
  plan({ playerName: '   ' }).kind === 'form');

check('missing registrationFields does not throw',
  plan({ registrationFields: undefined as unknown as RegistrationField[] }).kind === 'join');

// Total: no input shape may throw.
console.log('\n── totality ──');
let threw = '';
for (const requested of [true, false]) {
  for (const isTestDrive of [true, false]) {
    for (const runStatus of ['live', 'finished', undefined, null, '']) {
      for (const mode of ['individual', 'team'] as const) {
        for (const fields of [[], [NAME], [NAME, PHONE], undefined]) {
          for (const playerName of ['x', '', '   ', undefined]) {
            try {
              planTestDriveAutoJoin({
                requested, isTestDrive, runStatus, mode,
                registrationFields: fields as RegistrationField[],
                playerName: playerName as string,
              });
            } catch (e) {
              threw = `${requested}/${isTestDrive}/${runStatus}/${mode}: ${String(e)}`;
            }
          }
        }
      }
    }
  }
}
check('never throws across the input matrix', threw === '', threw);

// ── resolvePlayRoute ─────────────────────────────────────────────────────────
console.log('\n── resolvePlayRoute ──');

const r1 = resolvePlayRoute({ search: `?code=ABC123&${TEST_DRIVE_ROUTE_PARAM}=1`, session: null });
check('code + testdrive yields a join route flagged autoJoin',
  r1.route.kind === 'join' && r1.route.autoJoin === true, JSON.stringify(r1.route));

const r2 = resolvePlayRoute({ search: '?code=ABC123', session: null });
check('a plain code join is NOT auto-joined',
  r2.route.kind === 'join' && !r2.route.autoJoin, JSON.stringify(r2.route));

const r3 = resolvePlayRoute({ search: `?${TEST_DRIVE_ROUTE_PARAM}=1`, session: null });
check('a bare testdrive with no code changes nothing',
  r3.route.kind === 'join' && r3.route.code === null && !r3.route.autoJoin, JSON.stringify(r3.route));

// A stale session pointing at a different run still yields to the link, and the
// autoJoin flag must survive that branch too.
const r4 = resolvePlayRoute({
  search: `?code=NEW999&${TEST_DRIVE_ROUTE_PARAM}`,
  session: { code: 'OLD111' },
});
check('a different-run rehearsal link wins over a stale session, keeping autoJoin',
  r4.route.kind === 'join' && r4.route.autoJoin === true && r4.clearSession === true, JSON.stringify(r4));

// Re-opening the SAME run resumes play — auto-join must not re-fire and re-join.
const r5 = resolvePlayRoute({
  search: `?code=SAME1&${TEST_DRIVE_ROUTE_PARAM}`,
  session: { code: 'SAME1' },
});
check('re-opening the same rehearsal resumes play instead of re-joining',
  r5.route.kind === 'play', JSON.stringify(r5.route));

// A staff link must never be downgraded by the flag.
const r6 = resolvePlayRoute({ search: `?staff=o.g.r&${TEST_DRIVE_ROUTE_PARAM}`, session: null });
check('testdrive never overrides a staff link', r6.route.kind === 'staff');

// ── wiring guards ────────────────────────────────────────────────────────────
console.log('\n── wiring ──');
const builder = readFileSync(join(process.cwd(), 'apps/creator-web/src/pages/BuilderPage.tsx'), 'utf8');
check('the Builder builds a testdrive play link', /testdrive=1/.test(builder));
// Ordering, not a regex over prose: the rehearsal branch must RETURN before the
// run-console navigation, or "בדיקה" would still land on the console.
const tdBranch = builder.indexOf('if (testDrive) {');
const tdReturn = builder.indexOf('return;', tdBranch);
const consoleNav = builder.indexOf('nav(`/run/', tdBranch);
check('the rehearsal branch returns before the run-console navigation',
  tdBranch > 0 && tdReturn > tdBranch && consoleNav > tdReturn,
  `branch=${tdBranch} return=${tdReturn} nav=${consoleNav}`);

const joinScreen = readFileSync(join(process.cwd(), 'apps/play-web/src/screens/JoinScreen.tsx'), 'utf8');
check('JoinScreen consumes the planner', /planTestDriveAutoJoin/.test(joinScreen));
check('JoinScreen gates auto-join on the server flag', /info\.isTestDrive/.test(joinScreen));

const runs = readFileSync(join(process.cwd(), 'functions/src/runs/index.ts'), 'utf8');
check('joinRun self-starts only on the server-side test-drive flag',
  /run\.isTestDrive === true/.test(runs));
check('guardian consent still blocks the self-start',
  /selfStart[\s\S]{0,300}requiresGuardianConsent/.test(runs));

console.log(`\n${failures === 0 ? 'ALL TEST-DRIVE AUTOJOIN TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

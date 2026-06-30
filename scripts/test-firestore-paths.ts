// Structural test for FIRESTORE_PATHS (packages/shared/src/types). Every server
// write goes through one of these builders; a malformed path silently writes to
// the wrong place (or throws at runtime deep inside the Admin SDK). Firestore
// requires: a DOCUMENT path has an EVEN segment count, a COLLECTION path an ODD
// one; no empty segments (a missing arg → "//"), no leading/trailing slash. This
// asserts the multi-tenant tree shape can't drift. No emulator.
//   npx tsx scripts/test-firestore-paths.ts
import { FIRESTORE_PATHS } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

function wellFormed(path: string): { ok: boolean; why: string } {
  if (path.startsWith('/') || path.endsWith('/')) return { ok: false, why: 'leading/trailing slash' };
  if (path.includes('//')) return { ok: false, why: 'empty segment (//)' };
  const segs = path.split('/');
  if (segs.some((s) => s.length === 0)) return { ok: false, why: 'empty segment' };
  if (segs.some((s) => s !== s.trim())) return { ok: false, why: 'whitespace in segment' };
  return { ok: true, why: '' };
}

// Every builder, the args it takes, and whether it points at a DOCUMENT (even
// segment count) or a COLLECTION (odd segment count).
const OWNER = 'owner1', GAME = 'game1', RUN = 'run1', TEAM = 'team1', UID = 'uid1';
const cases: Array<{ name: string; path: string; kind: 'doc' | 'col' }> = [
  { name: 'game',            path: FIRESTORE_PATHS.game(OWNER, GAME),                       kind: 'doc' },
  { name: 'run',             path: FIRESTORE_PATHS.run(OWNER, GAME, RUN),                   kind: 'doc' },
  { name: 'team',            path: FIRESTORE_PATHS.team(OWNER, GAME, RUN, TEAM),            kind: 'doc' },
  { name: 'teamsCol',        path: FIRESTORE_PATHS.teamsCol(OWNER, GAME, RUN),              kind: 'col' },
  { name: 'staffInvite',     path: FIRESTORE_PATHS.staffInvite(OWNER, GAME, RUN, 'inv1'),   kind: 'doc' },
  { name: 'publicGame',      path: FIRESTORE_PATHS.publicGame(GAME),                        kind: 'doc' },
  { name: 'publicTask',      path: FIRESTORE_PATHS.publicTask('task1'),                     kind: 'doc' },
  { name: 'discoveryPoisCol',path: FIRESTORE_PATHS.discoveryPoisCol(OWNER, GAME),           kind: 'col' },
  { name: 'discoveryPoi',    path: FIRESTORE_PATHS.discoveryPoi(OWNER, GAME, 'poi1'),       kind: 'doc' },
  { name: 'wallet',          path: FIRESTORE_PATHS.wallet(UID),                             kind: 'doc' },
  { name: 'transaction',     path: FIRESTORE_PATHS.transaction(UID, 'tx1'),                 kind: 'doc' },
  { name: 'accessCode',      path: FIRESTORE_PATHS.accessCode('CODE1'),                     kind: 'doc' },
  { name: 'runAnnouncement', path: FIRESTORE_PATHS.runAnnouncement(OWNER, GAME, RUN, 'a1'), kind: 'doc' },
  { name: 'runAlert',        path: FIRESTORE_PATHS.runAlert(OWNER, GAME, RUN, 'al1'),       kind: 'doc' },
  { name: 'teamLocation',    path: FIRESTORE_PATHS.teamLocation(OWNER, GAME, RUN, TEAM),    kind: 'doc' },
  { name: 'stationSecret',   path: FIRESTORE_PATHS.stationSecret('task1'),                  kind: 'doc' },
  { name: 'stationReview',   path: FIRESTORE_PATHS.stationReview('rev1'),                   kind: 'doc' },
  { name: 'auditLog',        path: FIRESTORE_PATHS.auditLog('log1'),                        kind: 'doc' },
];

for (const c of cases) {
  const wf = wellFormed(c.path);
  check(`${c.name}: well-formed path`, wf.ok, wf.ok ? c.path : `${wf.why} (${c.path})`);
  const segCount = c.path.split('/').length;
  const parityOk = c.kind === 'doc' ? segCount % 2 === 0 : segCount % 2 === 1;
  check(`${c.name}: ${c.kind} has ${c.kind === 'doc' ? 'even' : 'odd'} segment count`,
    parityOk, `segments=${segCount}`);
}

// ── Multi-tenant nesting invariants (the tree shape we must never deviate from) ─
check('team is nested under its run', FIRESTORE_PATHS.team(OWNER, GAME, RUN, TEAM)
  .startsWith(FIRESTORE_PATHS.run(OWNER, GAME, RUN) + '/'));
check('run is nested under its game', FIRESTORE_PATHS.run(OWNER, GAME, RUN)
  .startsWith(FIRESTORE_PATHS.game(OWNER, GAME) + '/'));
check('game is nested under users/{owner}', FIRESTORE_PATHS.game(OWNER, GAME)
  .startsWith(`users/${OWNER}/`));
check('teamsCol is the parent collection of team',
  FIRESTORE_PATHS.team(OWNER, GAME, RUN, TEAM) === `${FIRESTORE_PATHS.teamsCol(OWNER, GAME, RUN)}/${TEAM}`);
check('transaction is nested under its wallet',
  FIRESTORE_PATHS.transaction(UID, 'tx1').startsWith(FIRESTORE_PATHS.wallet(UID) + '/'));

// ── Distinct ids never collide in the same path ───────────────────────────────
check('two different teams yield different paths',
  FIRESTORE_PATHS.team(OWNER, GAME, RUN, 'a') !== FIRESTORE_PATHS.team(OWNER, GAME, RUN, 'b'));
check('same id under different owners is isolated',
  FIRESTORE_PATHS.game('ownerA', GAME) !== FIRESTORE_PATHS.game('ownerB', GAME));

console.log(`\n${failures === 0 ? 'ALL FIRESTORE-PATH TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

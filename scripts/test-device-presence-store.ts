// Pure tests for the in-process device presence store (change: team-phones-simple, D5).
// It remembers when each phone of a team last asked for the team state, with ZERO Firestore
// cost, so the other phones can be told "the sending phone went quiet". Bounded in memory.
//   npx tsx scripts/test-device-presence-store.ts
import { createDevicePresenceStore } from '../functions/src/devicePresenceStore';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const s = createDevicePresenceStore({ maxDevicesPerTeam: 3, maxTeams: 2, idleMs: 60_000 });
s.touch('run:A', 'u1', 1_000);
s.touch('run:A', 'u2', 5_000);
let p = s.list('run:A', 10_000);
check('lists every phone of the team with its age in whole seconds',
  JSON.stringify(p) === JSON.stringify([{ uid: 'u2', lastSeenSec: 5 }, { uid: 'u1', lastSeenSec: 9 }]), JSON.stringify(p));
s.touch('run:A', 'u1', 12_000);
p = s.list('run:A', 12_000);
check('a new touch refreshes the phone', p.find((x) => x.uid === 'u1')?.lastSeenSec === 0, JSON.stringify(p));
check('an unknown team lists nothing', s.list('run:Z', 12_000).length === 0);

s.touch('run:A', 'u3', 13_000);
s.touch('run:A', 'u4', 14_000);
p = s.list('run:A', 14_000);
check('a team keeps at most its device cap, dropping the longest silent', p.length === 3 && !p.some((x) => x.uid === 'u2'), JSON.stringify(p));

s.touch('run:B', 'b1', 15_000);
s.touch('run:C', 'c1', 16_000);
check('the store keeps at most maxTeams teams (oldest team dropped)', s.list('run:A', 16_000).length === 0 && s.list('run:C', 16_000).length === 1);

s.touch('run:C', 'c2', 16_000);
check('a team idle past the window is forgotten', s.list('run:C', 200_000).length === 0);

check('junk never throws', (() => { try { s.touch('', '', Number.NaN); s.list('', Number.NaN); return true; } catch { return false; } })());
check('a clock that runs backwards reports age 0, never negative',
  (() => { s.touch('run:D', 'd1', 50_000); return s.list('run:D', 40_000)[0]?.lastSeenSec === 0; })());

console.log(`\n${failures === 0 ? 'ALL DEVICE-PRESENCE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

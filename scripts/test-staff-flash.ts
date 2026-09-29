// The staff app's flash-mission list (change: flash-missions-v2, overnight 2026-09-29).
//
// A marshal in the field is exactly who sees a team finish a flash mission, but the staff app had no
// way to approve one or end one early; only the console did. This selector turns the run's recent
// flash missions into the two lists the staff app shows: submissions waiting for approval (oldest
// first) and missions still running. Pure, clock injected, total.
import { staffFlashLists } from '../apps/play-web/src/lib/staffFlash';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
}

const NOW = Date.parse('2026-09-29T02:00:00.000Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const inMin = (m: number) => new Date(NOW + m * 60_000).toISOString();
// Design D6: each claim lives on its TEAM (`team.flashClaims`), not on the flash document.
const teams = [
  { id: 't1', displayName: 'Lions', flashClaims: {
    f1: { status: 'submitted', at: ago(90), submittedAt: ago(30), mediaUrl: 'https://x/y.jpg' },
    f2: { status: 'claimed', at: ago(10) } } },
  { id: 't2', displayName: 'Eagles', flashClaims: {
    f2: { status: 'submitted', at: ago(200), submittedAt: ago(60) },
    f3: { status: 'submitted', at: ago(900) } } },
];

const lists = staffFlashLists([
  { id: 'f1', title: 'Farm', titleHe: 'חווה', isActive: true, expiresAt: inMin(4), claimMode: 'first', doneBy: 'photo', requiresApproval: true, takenBy: 't1' },
  { id: 'f2', title: 'Gate', isActive: true, expiresAt: inMin(2), claimMode: 'many', doneBy: 'video', requiresApproval: true },
  { id: 'f3', title: 'Old', isActive: false, expiresAt: ago(600), claimMode: 'many', doneBy: 'button' },
  { id: 'f4', title: 'Shout', isActive: true, expiresAt: inMin(3) },
], teams, NOW, 'he');

check('waiting submissions are listed oldest first, ended missions included',
  lists.waiting.map((w) => `${w.flashId}:${w.teamId}`).join() === 'f3:t2,f2:t2,f1:t1', lists.waiting.map((w) => `${w.flashId}:${w.teamId}`).join());
check('a waiting row carries the team name, the media and its age',
  lists.waiting[2].teamName === 'Lions' && lists.waiting[2].mediaUrl === 'https://x/y.jpg' && lists.waiting[2].ageMs === 30_000);
check('age falls back to the claim time when a submission predates submittedAt', lists.waiting[0].ageMs === 900_000);
check('titles follow the language', lists.waiting[2].title === 'חווה' && lists.waiting[1].title === 'Gate');
check('running = active and not expired, announcements included, newest expiry last',
  lists.running.map((r) => r.flashId).join() === 'f2,f4,f1', lists.running.map((r) => r.flashId).join());
check('a running row says how many minutes are left, rounded up', lists.running[0].minutesLeft === 2);
check('a team with no name is shown by its id', staffFlashLists([{ id: 'x', title: 'X', isActive: true, expiresAt: inMin(1) }],
  [{ id: 'zz', flashClaims: { x: { status: 'submitted', at: ago(5) } } }], NOW, 'en').waiting[0].teamName === 'zz');
check('junk never throws and yields empty lists', (() => {
  const a = staffFlashLists(null as never, teams, NOW, 'en');
  const b = staffFlashLists([null, 1, { id: 'q' }] as never, [null, { id: 3 }] as never, NaN, 'en');
  return a.waiting.length === 0 && a.running.length === 0 && Array.isArray(b.waiting) && Array.isArray(b.running);
})());

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

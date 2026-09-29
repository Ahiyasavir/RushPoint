// Pure-logic tests for team lifecycle (change: team-lifecycle-controls).
//
// Field report 2026-09-27: the organizer asked to take a test team out of a live race — "it
// should not play and not be seen in the table" — and nothing in the product could do it. The
// only way was deleting the team document. Removal is now a STATE: the team is refused at every
// progress door (like a staff hold) and left out of every standing, and nothing is deleted.
import { rankableTeams, teamAdvanceRefusal } from '../packages/shared/src/teamLifecycle';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}\n      got  ${a}\n      want ${e}`);
}

console.log('\n— rankableTeams: removed teams are out of every standing, nothing else is —');
const teams = [
  { id: 'a' }, { id: 'b', removed: true }, { id: 'c', held: true }, { id: 'd', removed: false },
];
eq('drops only the removed team', rankableTeams(teams).map((t) => t.id), ['a', 'c', 'd']);
eq('keeps the order', rankableTeams([{ id: 'z' }, { id: 'y' }]).map((t) => t.id), ['z', 'y']);
eq('a truthy non-boolean is not "removed"', rankableTeams([{ id: 'x', removed: 'yes' as never }]).length, 1);
eq('junk in ⇒ empty, never a throw', rankableTeams(null as never), []);
eq('junk entries dropped', rankableTeams([null, 5, { id: 'ok' }] as never).map((t) => t.id), ['ok']);

console.log('\n— teamAdvanceRefusal: may this team advance? —');
eq('a normal team may', teamAdvanceRefusal({}), null);
eq('a held team is refused as held', teamAdvanceRefusal({ held: true, heldReason: 'break' }), { code: 'TEAM_HELD', reason: 'break' });
eq('a removed team is refused as removed', teamAdvanceRefusal({ removed: true, removedReason: 'test team' }), { code: 'TEAM_REMOVED', reason: 'test team' });
eq('removed outranks held', teamAdvanceRefusal({ removed: true, held: true, heldReason: 'x' }), { code: 'TEAM_REMOVED', reason: '' });
eq('missing reason ⇒ empty string', teamAdvanceRefusal({ held: true }), { code: 'TEAM_HELD', reason: '' });
eq('undefined team ⇒ may (the caller already proved the team exists)', teamAdvanceRefusal(undefined), null);

console.log('');
if (failures > 0) {
  console.error(`✗ team-lifecycle: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ team-lifecycle: all assertions passed\n');

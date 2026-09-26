// The console's quick-actions catalogue (change: quick-dial-and-actions, D4).
//   npx tsx scripts/test-quick-actions.ts
import {
  QUICK_ACTIONS, QUICK_ACTION_IDS, DEFAULT_QUICK_ACTIONS, MAX_QUICK_ACTIONS, readQuickActions,
} from '../packages/shared/src/quickActions';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

check('every id has a catalogue entry', QUICK_ACTION_IDS.every((id) => !!QUICK_ACTIONS[id]));
check('the default set is made only of catalogue ids', DEFAULT_QUICK_ACTIONS.every((id) => QUICK_ACTION_IDS.includes(id)));
check('the default set fits the bar', DEFAULT_QUICK_ACTIONS.length <= MAX_QUICK_ACTIONS);
check('MAX is 6', MAX_QUICK_ACTIONS === 6);

check('nothing saved -> the default set', JSON.stringify(readQuickActions(undefined)) === JSON.stringify(DEFAULT_QUICK_ACTIONS));
check('garbage saved -> the default set', JSON.stringify(readQuickActions({ quickActions: 'x' } as never)) === JSON.stringify(DEFAULT_QUICK_ACTIONS));
check('a saved choice is kept in its order', JSON.stringify(readQuickActions({ quickActions: ['refreshStandings', 'broadcast'] })) === JSON.stringify(['refreshStandings', 'broadcast']));
check('an id removed from the catalogue is dropped, never breaks the bar',
  JSON.stringify(readQuickActions({ quickActions: ['broadcast', 'retiredAction', 'refreshStandings'] })) === JSON.stringify(['broadcast', 'refreshStandings']));
check('duplicates collapse', JSON.stringify(readQuickActions({ quickActions: ['broadcast', 'broadcast'] })) === JSON.stringify(['broadcast']));
check('more than 6 is cut to 6', readQuickActions({ quickActions: [...QUICK_ACTION_IDS, ...QUICK_ACTION_IDS] }).length === Math.min(6, QUICK_ACTION_IDS.length));
check('an explicitly EMPTY bar is respected (the organizer removed everything)', readQuickActions({ quickActions: [] }).length === 0);
check('actions that need a team say so', QUICK_ACTIONS.adjustScore.needsTeam === true && QUICK_ACTIONS.broadcast.needsTeam === false);

console.log(failures === 0 ? '\nquick actions: all passed' : `\nquick actions: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

// A finished team offers only what can still work on it (found in the staff app,
// 2026-10-03). The team that had crossed the finish line still showed "hold the
// team" (which does nothing to a team that is done) and "send to a mission"
// (which the server refuses for a team it cannot route). A marshal on a phone
// should see score and "send the team back", the two that mean something.
//
// The rule lives in apps/play-web/src/lib/staffTeamActions.ts; the card reads it.
import { readFileSync } from 'node:fs';
import { hasMoreActions, staffTeamActions } from '../apps/play-web/src/lib/staffTeamActions';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} :: ${JSON.stringify(detail)}`); }
};

console.log('\nstaff team actions');
const all = { score: true, hold: true, route: true };
const playing = staffTeamActions({ status: 'started', activeTaskId: 't1', held: false }, all);
check('a playing team gets everything', playing.score && playing.hold && playing.assign && playing.skip && playing.sendBack, playing);
const between = staffTeamActions({ status: 'started', activeTaskId: null, held: false }, all);
check('no active mission ⇒ no skip', between.skip === false && between.assign === true, between);
const done = staffTeamActions({ status: 'finished', activeTaskId: null, held: false }, all);
check('a finished team: no hold, no assign, no skip', !done.hold && !done.assign && !done.skip, done);
check('a finished team keeps score and send back', done.score && done.sendBack, done);
const heldDone = staffTeamActions({ status: 'finished', activeTaskId: null, held: true }, all);
check('a finished team that is somehow held can still be released', heldDone.hold === true, heldDone);
const noCaps = staffTeamActions({ status: 'started', activeTaskId: 't1', held: false }, { score: false, hold: false, route: false });
check('capabilities still gate everything', !noCaps.score && !noCaps.hold && !noCaps.assign && !noCaps.skip && !noCaps.sendBack, noCaps);
check('junk does not throw and fails toward showing (the server re-checks)',
  staffTeamActions(null as never, all).hold === true);

const src = readFileSync('apps/play-web/src/screens/StaffConsole.tsx', 'utf8');
check('the team card reads staffTeamActions', /staffTeamActions\(team, can\)/.test(src));

// change: staff-team-card-actions. Up to nine buttons per card, six cards per phone screen:
// the adjustments wait behind one "פעולות" button; hold and the state-driven safety actions stay.
check('hasMoreActions: score alone is enough', hasMoreActions(staffTeamActions({ status: 'started' }, { score: true, hold: false, route: false })) === true);
check('hasMoreActions: routing alone is enough', hasMoreActions(staffTeamActions({ status: 'started', activeTaskId: 't' }, { score: false, hold: true, route: true })) === true);
check('hasMoreActions: hold alone is not', hasMoreActions(staffTeamActions({ status: 'started' }, { score: false, hold: true, route: false })) === false);
check('hasMoreActions: junk is not', hasMoreActions(null as never) === false);
const card = src.slice(src.indexOf('function TeamOpsCard('), src.indexOf('\nfunction StaffChatSection('));
check('the card keeps a per-card actionsOpen state (closed on a phone, open in the computer team window)', /const \[actionsOpen, setActionsOpen\] = useState\(startOpen\)/.test(card) && /startOpen = false/.test(card));
check('an open panel keeps the actions shown', /const showMore = actionsOpen \|\| openPanel !== null/.test(card));
check('the score steps render only when the actions are shown', /\{showMore && acts\.score && <div className="flex items-center gap-4/.test(card));
check('send to, skip, send back and custom amount sit behind showMore',
  /showMore && acts\.assign/.test(card) && /showMore && acts\.skip/.test(card) && /showMore && acts\.sendBack/.test(card) && /showMore && acts\.score && <button/.test(card));
check('hold does not depend on showMore', /\{acts\.hold && <button/.test(card));
check('the toggle says whether it is open', /data-testid="staff-team-actions-toggle"[\s\S]{0,200}aria-expanded=\{showMore\}|aria-expanded=\{showMore\}[\s\S]{0,200}data-testid="staff-team-actions-toggle"/.test(card));

console.log(failures === 0 ? '\n✅ staff team actions: ALL PASS' : `\n❌ staff team actions: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

// Issue 46 (Ahiya, 2026-10-06): "ברגע שאני לוחץ סמן כהושלם הטיימר חייב להפסיק, לא לחכות למשימה
// הבאה או לדברים כאלה, קודם הטיימר מפסיק".
//
// Three causes, three pins: (1) a mission that needs no location must not wait for a GPS fix before
// it is even sent (that wait counted in the team's real time, the server stamps completion on
// arrival); (2) the mission countdown stands still from the tap until the next mission replaces it;
// (3) the race clock stands still from the tap when the mission ends the race.
//   npx tsx scripts/test-finish-line-clock.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { completionFinishesRace } from '../apps/play-web/src/lib/finishLine';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const st = (order: number, status: string, tasks: string[], requiredTaskCount?: number) =>
  ({ order, status, requiredTaskCount, tasks: tasks.map((s) => ({ status: s })) }) as never;

ok('last mission of the last stage ends the race',
  completionFinishesRace([st(0, 'completed', ['completed']), st(1, 'active', ['completed', 'assigned'])]));
ok('a mission with another still to do does not',
  !completionFinishesRace([st(0, 'active', ['assigned', 'unassigned'])]));
ok('a later stage still to play: not the finish line',
  !completionFinishesRace([st(0, 'active', ['assigned']), st(1, 'locked', ['unassigned'])]));
ok('partial stage: the Nth of N required ends it',
  completionFinishesRace([st(0, 'active', ['completed', 'assigned', 'unassigned'], 2)]));
ok('skipped missions do not count as still to do',
  completionFinishesRace([st(0, 'active', ['skipped', 'assigned'])]));
ok('no active stage: not the finish line', !completionFinishesRace([st(0, 'completed', ['completed'])]));
ok('total on junk', !completionFinishesRace(undefined) && !completionFinishesRace([] as never) && !completionFinishesRace([null] as never));

const runner = readFileSync(join(process.cwd(), 'apps/play-web/src/components/TaskRunner.tsx'), 'utf8');
const field = runner.slice(runner.indexOf('async function field()'), runner.indexOf('async function field()') + 900);
ok('a mission that needs no location is sent at once, before any GPS request',
  /canCompleteWithoutLocation\(task\)[\s\S]{0,200}submitCheckIn\(\)/.test(field)
  && field.indexOf('canCompleteWithoutLocation(task)') < field.indexOf('withLocation('));
ok('the mission countdown is paused from the tap (stoppedFor), not only while held',
  /<TimeLimitCountdown[^>]*paused=\{[^}]*stoppedFor/.test(runner.replace(/\n\s*/g, ' ')));
ok('a failed send lets the countdown run again', /setStoppedFor\(null\)/.test(runner));
const play = readFileSync(join(process.cwd(), 'apps/play-web/src/screens/PlayScreen.tsx'), 'utf8');
ok('the race clock freezes at the tap on the finishing mission',
  /completionFinishesRace\(/.test(play) && /<ElapsedClock[^>]*frozenAtMs=/.test(play));

console.log(failures === 0 ? '\n✅ finish line clock: ALL PASS' : `\n❌ finish line clock: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

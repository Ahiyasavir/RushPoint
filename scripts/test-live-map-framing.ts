// Issue 52 (7.10 simulation): the console's live team map zoomed out on its own. It re-framed on
// every change in the SET of reporting teams, throwing away the organizer's zoom. It may frame
// itself only until the person moves the map; after that only "show all teams" moves it.
//   npx tsx scripts/test-live-map-framing.ts
import { readFileSync } from 'node:fs';
import { shouldAutoFrame, isUserCameraEvent, USER_MAP_INPUTS } from '../packages/shared/src/liveMapFraming';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

check('first positions → frame', shouldAutoFrame({ presentKey: 'a', framedKey: '', userMoved: false, count: 1 }));
check('a new team reports, nobody touched the map → frame',
  shouldAutoFrame({ presentKey: 'a,b', framedKey: 'a', userMoved: false, count: 2 }));
check('a new team reports AFTER the person zoomed → keep their camera',
  !shouldAutoFrame({ presentKey: 'a,b', framedKey: 'a', userMoved: true, count: 2 }));
check('same set → never re-frame', !shouldAutoFrame({ presentKey: 'a,b', framedKey: 'a,b', userMoved: false, count: 2 }));
check('no positions → nothing to frame', !shouldAutoFrame({ presentKey: '', framedKey: 'a', userMoved: false, count: 0 }));
check('malformed input → false, never throws', !shouldAutoFrame(null as never));

check('a drag/zoom with a DOM event is the person', isUserCameraEvent({ originalEvent: {} }));
check('our own easeTo/fitBounds (no DOM event) is not', !isUserCameraEvent({}));
check('missing event → not the person', !isUserCameraEvent(undefined));

// Wiring: the component uses the rule, listens for the person's camera moves, and offers a way back.
const src = readFileSync(new URL('../apps/creator-web/src/components/LiveTeamMap.tsx', import.meta.url), 'utf8');
check('LiveTeamMap decides with shouldAutoFrame', /shouldAutoFrame\(/.test(src));
check('LiveTeamMap marks the person\'s own moves', /isUserCameraEvent\(/.test(src) && /'movestart'/.test(src));
check('LiveTeamMap offers "show all teams"', /data-testid="live-map-show-all"/.test(src));
const staff = readFileSync(new URL('../apps/play-web/src/components/StaffTeamMap.tsx', import.meta.url), 'utf8');
check('StaffTeamMap decides with shouldAutoFrame', /shouldAutoFrame\(/.test(staff));
check('StaffTeamMap marks the marshal\'s own moves', /isUserCameraEvent\(/.test(staff) && /'movestart'/.test(staff));
check('StaffTeamMap offers "show all teams"', /data-testid="staff-map-show-all"/.test(staff));

// 7.10 re-check in a real browser: MapLibre 4.7 fires a WHEEL zoom's movestart with no originalEvent,
// so the camera event alone missed the commonest desktop gesture and a new team re-framed the map
// the organizer had just zoomed. A wheel, touch or press on the canvas itself is the person too.
check('the canvas inputs that count as the person include wheel and touch',
  ['wheel', 'touchstart', 'mousedown'].every((t) => (USER_MAP_INPUTS as readonly string[]).includes(t)));
for (const [name, text] of [['LiveTeamMap', src], ['StaffTeamMap', staff]] as const) {
  check(`${name} marks a wheel/touch/press on the canvas as the person's move`,
    /USER_MAP_INPUTS/.test(text) && /getCanvas\(\)\.addEventListener/.test(text));
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}  (test-live-map-framing)`);
process.exit(failures === 0 ? 0 : 1);

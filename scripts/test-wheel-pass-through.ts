// A map asks for ctrl + wheel only when the page around it scrolls (Ahiya, 3.11).
import { boxScrolls, wantsCooperativeGestures } from '../apps/creator-web/src/lib/wheelPassThrough';

let failed = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failed++; };
const box = (overflowY: string, scrollHeight: number, clientHeight: number) => ({ overflowY, scrollHeight, clientHeight });

ok(boxScrolls(box('auto', 900, 600)), 'an auto box taller than itself scrolls');
ok(!boxScrolls(box('auto', 600, 600)), 'an auto box that fits does not');
ok(!boxScrolls(box('auto', 601, 600)), 'one pixel of rounding is not a scroll');
ok(!boxScrolls(box('hidden', 900, 600)), 'a hidden overflow never scrolls');
ok(!boxScrolls(box('visible', 900, 600)), 'a visible overflow is not a scroller');
ok(boxScrolls(box('scroll', 900, 600)), 'scroll counts');
ok(!wantsCooperativeGestures(true, [box('auto', 500, 500), box('visible', 900, 300), box('auto', 700, 700)]), 'a screen with nothing to scroll zooms with the wheel');
ok(wantsCooperativeGestures(true, [box('hidden', 500, 500), box('auto', 1400, 700)]), 'a page that scrolls keeps ctrl + wheel');
ok(!wantsCooperativeGestures(false, [box('auto', 1400, 700)]), 'a map that never asked stays plain');
ok(!wantsCooperativeGestures(true, []), 'no chain at all zooms with the wheel');

process.exit(failed ? 1 : 0);

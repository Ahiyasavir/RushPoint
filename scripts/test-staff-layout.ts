// The staff app on a computer (change: desktop-layouts-play-staff). Ahiya, 2026-10-05: "לא צריך
// להיות צפיפות אם יש לנו מחשב שלם". On a wide window the staff app lays its sections out in three
// columns; on a phone it keeps the order it had. One table decides both, so no section can be
// dropped from one layout or appear twice.
//   npx tsx scripts/test-staff-layout.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { STAFF_PHONE_ORDER, staffDesktopLayout, staffDeskCounts, STAFF_SECTIONS } from '../apps/play-web/src/lib/staffLayout';
import { WIDE_LAYOUT_QUERY } from '../apps/play-web/src/lib/useWideLayout';

let failures = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || detail === undefined ? '' : `  → ${JSON.stringify(detail)}`}`);
  if (!cond) failures++;
};

ok('one threshold: 1024px and wider is a computer', WIDE_LAYOUT_QUERY === '(min-width: 1024px)');
ok('the phone order is the order the staff app always had', JSON.stringify(STAFF_PHONE_ORDER) === JSON.stringify([
  'quickBar', 'followed', 'contacts', 'alerts', 'review', 'teams', 'flash', 'map', 'staffChannel', 'chat', 'feed', 'broadcast',
]), STAFF_PHONE_ORDER);
const desk = staffDesktopLayout();
const placed = [...desk.needsYou, ...desk.main, ...desk.sideTop, ...desk.sideTabs];
ok('every section except the quick bar is placed exactly once',
  STAFF_SECTIONS.filter((s) => s !== 'quickBar').every((s) => placed.filter((p) => p === s).length === 1) && placed.length === STAFF_SECTIONS.length - 1, desk);
ok('the quick bar is a phone jump list, not on a computer', !placed.includes('quickBar'));
// Issue 39 (Ahiya, 2026-10-06): a queue of what needs a person, the main list, one tabbed side panel.
ok('"needs you" first: help calls, photos, flash missions, my teams', JSON.stringify(desk.needsYou) === JSON.stringify(['alerts', 'review', 'flash', 'followed']), desk.needsYou);
ok('the teams are the main list', JSON.stringify(desk.main) === JSON.stringify(['teams']), desk.main);
ok('map and communication are ONE tabbed panel, not five stacked boxes', JSON.stringify(desk.sideTabs) === JSON.stringify(['map', 'chat', 'staffChannel', 'feed', 'broadcast']), desk.sideTabs);

const counts = staffDeskCounts([
  { launched: true, status: 'active' }, { launched: true, status: 'active', held: true },
  { launched: true, status: 'finished', held: true }, { launched: false, status: 'joined' }, { launched: true, removed: true },
], 2, 3);
ok('top bar counts: playing, held, finished, waiting; a removed team is not a team',
  counts.teams === 4 && counts.playing === 1 && counts.held === 1 && counts.finished === 1 && counts.waiting === 1 && counts.sos === 2 && counts.photos === 3, counts);
ok('top bar counts are total on junk', staffDeskCounts(undefined, NaN, -1).teams === 0 && staffDeskCounts(null, NaN, -1).sos === 0);

const src = readFileSync(path.resolve(__dirname, '../apps/play-web/src/screens/StaffConsole.tsx'), 'utf8');
ok('the staff app renders through the table, by width', /useWideLayout\(\)/.test(src) && /staffDesktopLayout\(\)/.test(src) && /STAFF_PHONE_ORDER\.map/.test(src));
ok('the computer layout has a top bar with the live counts', /data-testid="staff-topbar"/.test(src) && /staffDeskCounts\(/.test(src));
ok('the side panel is tabbed', /role="tablist"/.test(src) && /data-testid="staff-side-tabs"/.test(src));

console.log(failures === 0 ? '\n✅ staff layout: ALL PASS' : `\n❌ staff layout: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

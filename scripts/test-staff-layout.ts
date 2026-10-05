// The staff app on a computer (change: desktop-layouts-play-staff). Ahiya, 2026-10-05: "לא צריך
// להיות צפיפות אם יש לנו מחשב שלם". On a wide window the staff app lays its sections out in three
// columns; on a phone it keeps the order it had. One table decides both, so no section can be
// dropped from one layout or appear twice.
//   npx tsx scripts/test-staff-layout.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { STAFF_PHONE_ORDER, staffDesktopColumns, STAFF_SECTIONS } from '../apps/play-web/src/lib/staffLayout';
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
const cols = staffDesktopColumns();
ok('three columns on a computer', cols.length === 3);
const placed = cols.flat();
ok('every section except the quick bar is placed exactly once',
  STAFF_SECTIONS.filter((s) => s !== 'quickBar').every((s) => placed.filter((p) => p === s).length === 1) && placed.length === STAFF_SECTIONS.length - 1, cols);
ok('the quick bar is a phone jump list, not on a computer', !placed.includes('quickBar'));
ok('"עכשיו" first: my teams, help calls, photos, flash missions', JSON.stringify(cols[0]) === JSON.stringify(['followed', 'alerts', 'review', 'flash']), cols[0]);
ok('the teams in the middle', JSON.stringify(cols[1]) === JSON.stringify(['teams']), cols[1]);
ok('map and communication last', JSON.stringify(cols[2]) === JSON.stringify(['contacts', 'map', 'staffChannel', 'chat', 'feed', 'broadcast']), cols[2]);

const src = readFileSync(path.resolve(__dirname, '../apps/play-web/src/screens/StaffConsole.tsx'), 'utf8');
ok('the staff app renders through the table, by width', /useWideLayout\(\)/.test(src) && /staffDesktopColumns\(\)/.test(src) && /STAFF_PHONE_ORDER\.map/.test(src));

console.log(failures === 0 ? '\n✅ staff layout: ALL PASS' : `\n❌ staff layout: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

// "עכשיו" screen team picker (Ahiya, 2026-10-05: star and search teams right where he organises
// before the race). The picker opens by itself while no team is followed, and starring a team keeps
// it open: it used to close under the first star, so starring five teams meant reopening it four
// times. The component has no test runner, so these are source assertions on FollowedStrip.
//   npx tsx scripts/test-followed-picker.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const src = readFileSync(path.resolve(__dirname, '../apps/creator-web/src/components/FollowedStrip.tsx'), 'utf8');
const page = readFileSync(path.resolve(__dirname, '../apps/creator-web/src/pages/RunConsolePage.tsx'), 'utf8');

ok('opens by itself while nothing is followed', /\(pickOpen \|\| cards\.length === 0\)/.test(src));
ok('starring keeps the list open', /onClick=\{\(\) => \{ setPickOpen\(true\); picker\.onToggle\(tm\.id\); \}\}/.test(src));
ok('each row says whether the team is followed', /aria-pressed=\{tm\.followed\}/.test(src));
ok('the search box is there, with the same placeholder as the teams list', /type="search"/.test(src) && /rc\.teamSearchPlaceholder/.test(src));
ok('the console feeds it every team that is not removed, searched the same way as the teams list',
  /teams\.filter\(\(tm\) => tm\.removed !== true\)/.test(page) && /searchTeams\(active, \{ query: pickQuery/.test(page));
ok('its query is its own, so typing here never filters the Teams section', /const \[pickQuery, setPickQuery\] = useState\(''\)/.test(page));

process.exit(failures === 0 ? 0 : 1);

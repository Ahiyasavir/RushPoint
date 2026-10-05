// The active mission on the player's map is a flag, without its name beside it (Ahiya,
// 2026-10-05: "רק הדגל זה מעולה, השם מסתיר הרבה מהדרך והוא גדול מאוד"). The name stays the
// marker's accessible name and opens in a popup on tap.
//   npx tsx scripts/test-active-flag-marker.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const src = readFileSync(path.resolve(__dirname, '../apps/play-web/src/components/NavMap.tsx'), 'utf8');
const active = src.slice(src.indexOf('if (t.active) {'), src.indexOf("el.style.cssText = 'width:16px"));
ok('found the active-mission marker', active.length > 100);
ok('the flag is drawn', /iconSvgMarkup\('flag'/.test(active));
ok('no text label is appended next to the flag', !/label\.textContent/.test(active) && /el\.append\(ring, flag\)/.test(active));
ok('the name is still the accessible name', /setAttribute\('aria-label', t\.title\)/.test(active));
ok('a tap shows the name', /setPopup\([\s\S]*setText\(t\.title\)/.test(active));
process.exit(failures === 0 ? 0 : 1);

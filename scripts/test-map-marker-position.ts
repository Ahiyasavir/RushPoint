// Issues 52/53 (7.10 simulation: "a location bug in the console, and in the player app mid-game").
// MapLibre places a marker by giving `.maplibregl-marker` `position:absolute; top:0; left:0` and a
// translate to the point. A marker element that sets `position:relative` (or static) INLINE beats
// that class, so the markers fall into the normal flow of the canvas container: each one is drawn
// at its translate PLUS the height of every marker before it. One marker looks right; the second
// team, the second mission, sits below where it really is. Measured in a real browser on the
// console's live map: three teams within a few hundred metres drawn in a column at the map's edge.
// The rule: an element handed to `new maplibregl.Marker({ element })` never sets its own `position`.
//   npx tsx scripts/test-map-marker-position.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = [...walk(join(root, 'apps/creator-web/src')), ...walk(join(root, 'apps/play-web/src'))]
  .filter((f) => /new maplibregl\.Marker\(\{\s*element/.test(readFileSync(f, 'utf8')));

check('found the files that build custom markers', files.length >= 3, `${files.length} files`);
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // Every `X.style.cssText = '...'` where X is later passed as `element: X`.
  const elements = [...src.matchAll(/new maplibregl\.Marker\(\{\s*element:\s*(\w+)/g)].map((m) => m[1]);
  const bad: string[] = [];
  for (const el of new Set(elements)) {
    const re = new RegExp(`\\b${el}\\.style\\.cssText\\s*=\\s*[\`'"]([^\`'"]*)`, 'g');
    for (const m of src.matchAll(re)) {
      if (/(^|;)\s*position\s*:\s*(relative|static)/.test(m[1])) bad.push(`${el}: ${m[1].slice(0, 40)}`);
    }
    const re2 = new RegExp(`\\b${el}\\.style\\.position\\s*=\\s*['"](relative|static)`);
    if (re2.test(src)) bad.push(`${el}.style.position`);
  }
  check(`${f.slice(root.length)}: no marker element overrides MapLibre's absolute position`, bad.length === 0, bad.join(' | '));
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}  (test-map-marker-position)`);
process.exit(failures === 0 ? 0 : 1);

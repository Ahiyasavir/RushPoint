// Every reportArrival call from the phone sends the fix's accuracy (overnight 2026-09-29).
//
// The server refuses to unseal a mission on a fix too coarse to prove arrival
// (`evaluateArrivalFix`, change: arrival-needs-a-usable-fix), but it can only judge the accuracy it
// is TOLD: an absent `accuracyMeters` reads as a precise fix. Both of play-web's reportArrival calls
// (the background probe while walking, and the "we are here" button) omitted it, so a ±300 m fix
// could open a mission for a team still a street away. Since located-mission-arrival that is every
// located mission, not only hidden ones. Low-confidence GPS is not proof (CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
}

const root = path.join(__dirname, '..', 'apps', 'play-web', 'src');
const files: string[] = [];
(function walk(d: string) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !p.endsWith(path.join('services', 'calls.ts'))) files.push(p);
  }
})(root);

let calls = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // reportArrival always carries a position; completeTask does when it names one (the geofence auto
  // check-in). A completeTask that spreads a `coords` object built with accuracy is left to review.
  const re = /\b(reportArrival|completeTask)\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // The argument object: from the brace to its matching close.
    let depth = 0; let i = m.index + m[0].length - 1; const start = i;
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
    const arg = src.slice(start, i + 1);
    if (m[1] === 'completeTask' && !/\blat\s*:/.test(arg)) continue;
    calls++;
    const line = src.slice(0, m.index).split('\n').length;
    check(`${path.relative(root, f)}:${line} sends accuracyMeters`, /accuracyMeters/.test(arg), arg.replace(/\s+/g, ' ').slice(0, 120));
  }
}
// Print the denominator: "no call omits accuracy" must never mean "found no calls".
check(`found the phone's position-carrying calls (${calls})`, calls >= 3, String(calls));

const calls_ts = fs.readFileSync(path.join(root, 'services', 'calls.ts'), 'utf8');
const sig = calls_ts.slice(calls_ts.indexOf('export const reportArrival'), calls_ts.indexOf("('reportArrival')"));
check('the reportArrival wrapper accepts accuracyMeters and returns retriable', /accuracyMeters/.test(sig) && /retriable/.test(sig), sig.replace(/\s+/g, ' '));

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

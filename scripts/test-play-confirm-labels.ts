// Every confirmation in play-web names its action on the button (overnight 2026-09-29).
//
// `dialog.confirm(message)` with no `confirmLabel` renders a button that says "אישור" ("OK"). Found by
// playing the staff app: signing out asked "לצאת מקונסולת הצוות?" over a button reading "אישור", and
// the same shape sat on leaving the game, hiding a feed photo, muting a team and skipping a mission.
// A button that names the action is the one a person under time pressure reads; creator-web already
// learned this (`scripts/test-confirm-cta.ts`). This is the play-web half.
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
    else if (/\.tsx?$/.test(e.name) && !p.endsWith(path.join('components', 'dialog.tsx'))) files.push(p);
  }
})(root);

let calls = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /\bdialog\.confirm\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    calls++;
    let depth = 0; let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) break; }
    const args = src.slice(m.index, i + 1);
    const line = src.slice(0, m.index).split('\n').length;
    check(`${path.relative(root, f)}:${line} names its action (confirmLabel)`, /confirmLabel\s*:/.test(args), args.replace(/\s+/g, ' ').slice(0, 110));
  }
}
check(`found the play-web confirmations (${calls})`, calls >= 5, String(calls));

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

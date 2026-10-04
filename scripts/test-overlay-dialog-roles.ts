// Every full-screen window says it is a dialog (found 2026-10-04).
//
// Neither app has a shared modal component: each window is a hand-built
// `fixed inset-0` overlay. About a dozen of them (the new-game wizard, the share
// sheet, the task library, delete and trash confirmations, the feed's report box...)
// were plain divs with no role, no aria-modal and no name, so a screen reader was
// never told a window had opened over the page. This gate finds every centred
// full-screen overlay and requires a role on it or on the element just inside it.
// Decorative layers (aria-hidden, canvases, click-catchers) are not windows.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function walk(d: string, o: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) walk(p, o); else if (p.endsWith('.tsx')) o.push(p);
  }
  return o;
}

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}\n${Array.isArray(detail) ? detail.join('\n') : JSON.stringify(detail)}`); }
};

console.log('\nfull-screen windows are dialogs');
let windows = 0;
const missing: string[] = [];
for (const app of ['apps/creator-web/src', 'apps/play-web/src']) {
  for (const f of walk(app)) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      // A WINDOW: covers the screen and centres (or bottom-sheets) its content.
      if (!/fixed inset-0/.test(l) || !/(items-center|items-end)/.test(l)) return;
      if (/aria-hidden|pointer-events-none|<canvas/.test(l)) return;
      windows++;
      const near = lines.slice(Math.max(0, i - 6), i + 18).join('\n');
      if (!/role="(dialog|alertdialog|status)"/.test(near)) missing.push(`${f}:${i + 1}`);
    });
  }
}
check(`the scan found the windows (${windows})`, windows >= 15, windows);
check('every window declares role="dialog" or "alertdialog"', missing.length === 0, missing);

console.log(failures === 0 ? '\n✅ overlay dialog roles: ALL PASS' : `\n❌ overlay dialog roles: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

// Overlays opened FROM the team page must sit above it (Ahiya, 2026-10-05: "החזרת הקבוצה" opened
// a list that could not be used). The team page is a full-screen layer at z-[90]; the send-back
// and route pickers were z-50, so they drew UNDER its backdrop: visible through the dimming,
// unclickable. Confirm dialogs are z-[110] and must stay above everything. Declared order:
//   team page 90  <  pickers it opens 100  <  confirm dialog 110
//   npx tsx scripts/test-overlay-order.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

let failures = 0;
const ok = (label: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  → ${detail}`}`); if (!cond) failures++; };
const root = path.resolve(__dirname, '..');
/** The z of the component's outermost `fixed inset-0` layer. */
function z(file: string): number {
  const src = readFileSync(path.join(root, file), 'utf8');
  const m = src.match(/fixed inset-0 z-(?:\[(\d+)\]|(\d+))/);
  return m ? Number(m[1] ?? m[2]) : NaN;
}
const team = z('apps/creator-web/src/components/TeamPage.tsx');
const dialog = z('apps/creator-web/src/components/dialog.tsx');
ok('the team page is a full-screen layer', Number.isFinite(team), String(team));
for (const picker of ['SendBackPicker', 'RoutePicker']) {
  const pz = z(`apps/creator-web/src/components/${picker}.tsx`);
  ok(`${picker} (z ${pz}) is above the team page (z ${team})`, pz > team, `${pz} <= ${team}`);
  ok(`${picker} (z ${pz}) is below the confirm dialog (z ${dialog})`, pz < dialog, `${pz} >= ${dialog}`);
}
process.exit(failures === 0 ? 0 : 1);

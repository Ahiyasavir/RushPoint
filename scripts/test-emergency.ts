// SOS points to emergency services first (change: sos-points-to-101)
//
// Ahiya, 2026-09-25: "I want the SOS button to also guide them to call 101 if there is a serious
// problem." The SOS flow only ever alerted the ORGANIZER (who may be kilometres away), and its
// "sent" copy promised "help is on the way", which can delay the one call that matters.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EMERGENCY_MEDICAL_NUMBER, emergencyTelHref } from '../packages/shared/src/emergency';
import { translations } from '../apps/play-web/src/i18n';
const { he, en } = translations;

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}

console.log('\n— one number, declared once —');
ok('the medical emergency number is 101 (Magen David Adom)', EMERGENCY_MEDICAL_NUMBER === '101');
ok('its call link is tel:101', emergencyTelHref() === 'tel:101', emergencyTelHref());

console.log('\n— every SOS dialog offers the call —');
const root = path.resolve(__dirname, '..');
const play = fs.readFileSync(path.join(root, 'apps/play-web/src/screens/PlayScreen.tsx'), 'utf8').replace(/\r/g, '');
const sosFn = play.slice(play.indexOf('async function sos()'), play.indexOf('async function shareProgress()'));
ok('found the sos() handler', sosFn.length > 100);
// Each dialog call, up to the end of its own statement line (the confirm sits inside an `if`).
const dialogCalls = sosFn.match(/dialog\.(confirm|alert)\([^\n]*/g) ?? [];
ok('sos() opens three dialogs (confirm, sent, failed)', dialogCalls.length === 3, `found ${dialogCalls.length}`);
for (const c of dialogCalls) ok(`passes the 101 call action: ${c.replace(/\s+/g, ' ').slice(0, 70)}`, /callAction/.test(c));

const dialogSrc = fs.readFileSync(path.join(root, 'apps/play-web/src/components/dialog.tsx'), 'utf8');
ok('the dialog renders a tel: link for a callAction', /callAction/.test(dialogSrc) && /href=\{[^}]*callAction/.test(dialogSrc));

console.log('\n— the copy never promises help is coming —');
ok('he sosSent does not say "עזרה בדרך"', !he.play.sosSent.includes('עזרה בדרך'), he.play.sosSent);
ok('en sosSent does not say "on the way"', !/on the way/i.test(en.play.sosSent), en.play.sosSent);
ok('he SOS confirm names 101', he.play.sosConfirm.includes('101'), he.play.sosConfirm);
ok('en SOS confirm names 101', en.play.sosConfirm.includes('101'), en.play.sosConfirm);
ok('he failed message names 101', he.play.sosFailed.includes('101'), he.play.sosFailed);
ok('en failed message names 101', en.play.sosFailed.includes('101'), en.play.sosFailed);

if (failures > 0) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall passed');
process.exit(0);

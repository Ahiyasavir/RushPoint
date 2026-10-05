// SOS points to emergency services first (change: sos-points-to-101), offers every service and
// asks for a number to call back (change: sos-callback-and-authorities).
//
// Ahiya, 2026-09-25: "I want the SOS button to also guide them to call 101 if there is a serious
// problem." The SOS flow only ever alerted the ORGANIZER (who may be kilometres away), and its
// "sent" copy promised "help is on the way", which can delay the one call that matters.
// Ahiya, 2026-10-05: not only 101: "a button to contact the authorities, and then it gives them all
// the options", and ask for a team member's phone so the organizers can call back.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  EMERGENCY_MEDICAL_NUMBER, emergencyTelHref, EMERGENCY_SERVICES, sosCallbackVerdict,
} from '../packages/shared/src/emergency';
import { translations } from '../apps/play-web/src/i18n';
const { he, en } = translations;

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}

console.log('\n— the numbers, declared once —');
ok('the medical emergency number is 101 (Magen David Adom)', EMERGENCY_MEDICAL_NUMBER === '101');
ok('its call link is tel:101', emergencyTelHref() === 'tel:101', emergencyTelHref());
const byId = Object.fromEntries(EMERGENCY_SERVICES.map((s) => [s.id, s.number]));
ok('three services: medical 101, police 100, fire 102',
  EMERGENCY_SERVICES.length === 3 && byId.medical === '101' && byId.police === '100' && byId.fire === '102',
  JSON.stringify(EMERGENCY_SERVICES));
ok('medical comes first (an injury is the most common emergency)', EMERGENCY_SERVICES[0]?.id === 'medical');
for (const s of EMERGENCY_SERVICES) {
  ok(`he names ${s.id} with its number`, he.play.sosServices[s.id].includes(s.number), he.play.sosServices[s.id]);
  ok(`en names ${s.id} with its number`, en.play.sosServices[s.id].includes(s.number), en.play.sosServices[s.id]);
}

console.log('\n— the number to call back —');
ok('an empty field still sends (an alert without a number beats no alert)',
  JSON.stringify(sosCallbackVerdict('')) === JSON.stringify({ ok: true }) && sosCallbackVerdict('   ').ok === true
  && sosCallbackVerdict(undefined).ok === true);
const mobile = sosCallbackVerdict(' 050-123 4567 ');
ok('an Israeli mobile is kept as typed, trimmed', mobile.ok === true && mobile.phone === '050-123 4567', JSON.stringify(mobile));
ok('an international number is kept', sosCallbackVerdict('+44 20 7946 0958').ok === true);
ok('a number that cannot be dialled is refused', sosCallbackVerdict('12345').ok === false && sosCallbackVerdict('call me').ok === false);
ok('an absurdly long value is refused', sosCallbackVerdict('0'.repeat(60)).ok === false);

console.log('\n— the SOS sheet —');
const root = path.resolve(__dirname, '..');
const sheet = fs.readFileSync(path.join(root, 'apps/play-web/src/components/SosSheet.tsx'), 'utf8').replace(/\r/g, '');
ok('the sheet lists every service from EMERGENCY_SERVICES', /EMERGENCY_SERVICES\.map/.test(sheet));
ok('each service is a real tel: link (dials even if the app is stuck)', /href=\{`tel:\$\{s\.number\}`\}/.test(sheet));
ok('the sheet has the callback phone field', /type="tel"/.test(sheet) && /autoComplete="tel"/.test(sheet));
ok('the sheet is a dialog', /role="dialog"/.test(sheet) && /aria-modal="true"/.test(sheet));
const play = fs.readFileSync(path.join(root, 'apps/play-web/src/screens/PlayScreen.tsx'), 'utf8').replace(/\r/g, '');
ok('the SOS button opens the sheet', /<SosSheet\b/.test(play));
ok('PlayScreen sends the callback number with the alert', /callbackPhone/.test(play));

console.log('\n— the copy never promises help is coming —');
ok('he sosSent does not say "עזרה בדרך"', !he.play.sosSent.includes('עזרה בדרך'), he.play.sosSent);
ok('en sosSent does not say "on the way"', !/on the way/i.test(en.play.sosSent), en.play.sosSent);
ok('he sheet intro names 101', he.play.sosIntro.includes('101'), he.play.sosIntro);
ok('en sheet intro names 101', en.play.sosIntro.includes('101'), en.play.sosIntro);
ok('he failed message names 101', he.play.sosFailed.includes('101'), he.play.sosFailed);
ok('en failed message names 101', en.play.sosFailed.includes('101'), en.play.sosFailed);

if (failures > 0) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall passed');
process.exit(0);

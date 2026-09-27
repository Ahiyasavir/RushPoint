// The printable station QR sheet (change: qr-station-scan + answer-scored-question 2.7).
// A station scored BY CODE has no single secretCode, so it used to be left off the sheet entirely:
// the operator had nothing to hand out. Now it prints one card per code, each naming its points.
//   npx tsx scripts/test-station-qr-sheet.ts
import { stationQrCards } from '../apps/creator-web/src/lib/stationQrSheet';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const stages = [{ tasks: [
  { id: 'a', title: 'השער', type: 'smart_station', smart: { secretCode: 'GATE' } },
  { id: 'b', title: 'תבלין', type: 'smart_station', answerOutcomes: [
    { id: 'z', label: 'זעתר', accepts: ['זעתר'], points: 50 },
    { id: 'm', label: 'מרווה', accepts: ['מרווה', 'marva'], points: 100 },
  ] },
  { id: 'c', title: 'שאלה', type: 'quiz', answers: ['x'] },
  { id: 'd', title: 'בלי קוד', type: 'smart_station', smart: {} },
] }] as never;

const cards = stationQrCards(stages);
check('a single-code station prints one card', cards.filter((c) => c.taskId === 'a').length === 1);
check('its card carries the code', cards.find((c) => c.taskId === 'a')?.code === 'GATE');
const spice = cards.filter((c) => c.taskId === 'b');
check('a station scored by code prints ONE CARD PER CODE', spice.length === 2, JSON.stringify(spice));
check('each code card names the code and its points', spice[0].code === 'זעתר' && spice[0].points === 50 && spice[1].code === 'מרווה' && spice[1].points === 100);
check('the code is the first accepted text (what the scanner submits)', spice[1].code === 'מרווה');
check('non-stations and code-less stations print nothing', !cards.some((c) => c.taskId === 'c' || c.taskId === 'd'));
check('card keys are unique', new Set(cards.map((c) => c.key)).size === cards.length);
check('garbage in, empty out', stationQrCards(null as never).length === 0 && stationQrCards([{ tasks: null }] as never).length === 0);
const blankRow = stationQrCards([{ tasks: [{ id: 'e', title: 't', type: 'smart_station', answerOutcomes: [{ id: 'x', points: 5 }, { id: 'y', label: 'ok', points: 1 }] }] }] as never);
check('an outcome with no text prints no card (nothing to scan)', blankRow.length === 1 && blankRow[0].code === 'ok');

console.log(failures === 0 ? '\nstation qr sheet: all passed' : `\nstation qr sheet: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

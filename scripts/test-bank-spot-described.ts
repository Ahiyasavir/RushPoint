// A mission at a specific spot says WHERE at the spot (Ahiya, 28.10: "במקומות כמו קיר... רק מיקום לא
// יספיק"). A pin brings the team to the area; the wall, the box or the board is rarely touching it
// (lessons L37). So a located mission whose text points at something "here" must either carry a creator
// blank the setup walk asks for ("ליד [הוראות ליוצר: ציון דרך]"), or a location clue, or be declared
// below with the reason the spot needs no description.
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { CREATOR_BLANK } from '../packages/shared/src/templateWizard';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!cond) failures++;
}

// The pin IS the thing, or finding it is the mission.
const SPOT_IS_THE_PIN: Record<string, string> = {
  'youth-start-point': 'the meeting point is the pin itself',
  'team-pull-ups': 'the creator pins the pull-up bar itself',
  'odd-one-planted': 'searching the area for the odd object is the mission',
  'common-thread': 'finding the four details around the pin is the mission',
  'then-and-here': 'the old photo shows the spot; finding the angle is the mission',
  'passphrase-handoff': 'the contact is a person who stands at the pin',
};

const HERE = /(^|[\s"(])(ש?כאן|מכאן)([\s.,:]|$)/;
const blankRe = new RegExp(CREATOR_BLANK.source, 'i');
let located = 0;
const missing: string[] = [];
for (const entry of TASK_BANK) {
  if (!(entry.tags as readonly string[]).includes('locationBased')) continue;
  located++;
  const task = entry.build();
  const text = String(task.description ?? '');
  if (!HERE.test(text)) continue;
  const hasBlank = blankRe.test(text);
  const hasClue = (entry.setup ?? []).some((s) => s.field === 'locationClue');
  if (!hasBlank && !hasClue && !(entry.key in SPOT_IS_THE_PIN)) missing.push(entry.key);
}
ok(`located missions checked (${located})`, located >= 30, located);
ok('every located mission that points at something "here" says where', missing.length === 0, missing);

const keys = new Set(TASK_BANK.map((e) => e.key));
const stale = Object.keys(SPOT_IS_THE_PIN).filter((k) => !keys.has(k));
ok('no stale declared exception', stale.length === 0, stale);

// The missions changed for this rule ask for the spot in the setup walk.
for (const key of ['highest-note', 'cairn-record', 'record-board', 'cache-swap', 'five-objects', 'kims-game', 'elevator-race']) {
  const entry = TASK_BANK.find((e) => e.key === key);
  const text = String(entry?.build().description ?? '');
  ok(`${key}: the text has a spot blank and a description step`,
    blankRe.test(text) && (entry?.setup ?? []).some((s) => s.field === 'description' && s.required === true));
}

console.log(failures === 0 ? '\n✅ bank spot described: ALL PASS' : `\n❌ bank spot described: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

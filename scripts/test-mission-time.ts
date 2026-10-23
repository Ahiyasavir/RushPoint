// A mission's countdown follows the difficulty the creator asked for (change: composer-time-by-difficulty).
// Easy adds half, hard takes a quarter, balanced leaves it; the text and the timer always agree; a
// length that is part of the content (a 30 second video) is never touched. Plus the companion rule
// from the same request: a game without locations holds only missions played from anywhere.
import { scaleMissionTime, scaledMinutes } from '../apps/creator-web/src/lib/missionTime';
import { composeGame, seededRng, type ComposerAnswers, type ComposerDescriptionCopy } from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import type { Task } from '@rushpoint/shared';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
}

console.log('\nmission time by difficulty');
ok('easy adds half', scaledMinutes(4, 'easy') === 6 && scaledMinutes(3, 'easy') === 5 && scaledMinutes(1, 'easy') === 2);
ok('hard takes a quarter, never below a minute', scaledMinutes(4, 'hard') === 3 && scaledMinutes(7, 'hard') === 5 && scaledMinutes(1, 'hard') === 1);
ok('balanced leaves it', scaledMinutes(5, 'balanced') === 5);

const mk = (description: string, timeLimitMinutes?: number) => ({ id: 't', title: 'x', type: 'photo', description, timeLimitMinutes } as unknown as Task);
const e = scaleMissionTime(mk('יש לכם 4 דקות למצוא חנות.', 4), 'easy');
ok('the Hebrew text and the timer move together', e.timeLimitMinutes === 6 && e.description === 'יש לכם 6 דקות למצוא חנות.', e);
const one = scaleMissionTime(mk('עד שהוא מנחש. יש לכם דקה. סרטון.', 1), 'easy');
ok('"a minute" becomes two minutes', one.timeLimitMinutes === 2 && one.description.includes('יש לכם 2 דקות'), one);
const toOne = scaleMissionTime(mk('יש לכם 2 דקות לסדר.', 2), 'hard');
ok('two minutes made harder reads "a minute"', toOne.timeLimitMinutes === 2 || (toOne.timeLimitMinutes === 1 && toOne.description.includes('יש לכם דקה')), toOne);
const en = scaleMissionTime(mk('יש לכם 4 דקות.\n\nYou have 4 minutes.', 4), 'easy');
ok('both halves of a bilingual text change', en.description === 'יש לכם 6 דקות.\n\nYou have 6 minutes.', en.description);
const mismatch = mk('יש לכם 5 דקות.', 4);
ok('a text that states another number is left alone, timer included', scaleMissionTime(mismatch, 'easy') === mismatch);
const video = mk('סרטון של 30 שניות עם ראפ.');
ok('a content length with no countdown is never touched', scaleMissionTime(video, 'easy') === video);
ok('balanced returns the very same task', scaleMissionTime(mk('יש לכם 4 דקות.', 4), 'balanced').timeLimitMinutes === 4);
ok('junk does not throw', scaleMissionTime(null as never, 'easy') === null);

// Every countdown in the real bank is one this can scale: the text states the timer's number.
const timed = TASK_BANK.map((b) => ({ key: b.key, t: b.build() })).filter((x) => typeof x.t.timeLimitMinutes === 'number');
const unscalable = timed.filter((x) => scaleMissionTime(x.t, 'easy') === x.t).map((x) => x.key);
ok(`every countdown in the bank scales with its text (${timed.length} missions)`, timed.length >= 10 && unscalable.length === 0, unscalable);
const disagree = timed.map((x) => scaleMissionTime(x.t, 'easy')).filter((t) => !String(t.description).includes(t.timeLimitMinutes === 1 ? 'יש לכם דקה' : `יש לכם ${t.timeLimitMinutes} דקות`));
ok('after scaling, every text states its timer', disagree.length === 0, disagree.map((t) => t.title));

// In composed games.
const COPY = { lead: () => 'L', ageLabel: () => 'A', ageTag: () => 'a', durationTag: () => 'd', composedLead: () => 'C', activityPhrase: () => 'p', activityJoin: (p: string[]) => p.join(','), activityTag: () => 't', placeMissionPrompt: () => 'P' } as ComposerDescriptionCopy;
const byKey = new Map(TASK_BANK.map((b) => [b.key, b]));
let easyTimed = 0;
let wrong = 0;
for (const pref of ['easy', 'balanced', 'hard'] as const) for (const audience of ['kids', 'youth', 'adults', 'mixed']) for (const setting of ['outdoor', 'indoor', 'fromAnywhere']) for (const seed of [1, 2, 3, 4]) {
  const r = composeGame(TASK_BANK, { audience, setting, minutes: 90, people: 12, prepEffort: 3, locationMissions: true, difficultyPreference: pref, ageBandId: 'band-14-17' } as unknown as ComposerAnswers, COPY, seededRng(seed), { recentBankKeys: [] });
  if (!r) continue;
  r.stages.flatMap((s) => s.tasks).forEach((t, i) => {
    const authored = byKey.get(r.usedBankKeys[i])?.build().timeLimitMinutes;
    if (typeof authored !== 'number') return;
    const want = scaledMinutes(authored, pref);
    if (pref === 'easy') easyTimed++;
    if (t.timeLimitMinutes !== want) wrong++;
  });
}
ok(`composed games carry the scaled countdown (${easyTimed} timed missions in easy games)`, easyTimed > 0 && wrong === 0, { easyTimed, wrong });

// No locations asked for ⇒ nothing that needs a pin (prep level 1 is the questionnaire's "no locations").
let noLoc = 0;
const located: string[] = [];
for (const audience of ['kids', 'youth', 'adults', 'mixed', 'corporate']) for (const setting of ['outdoor', 'indoor', 'fromAnywhere']) for (const seed of [1, 2, 3, 4]) {
  const r = composeGame(TASK_BANK, { audience, setting, minutes: 90, people: 12, prepEffort: 1, locationMissions: false, difficultyPreference: 'balanced', ageBandId: 'band-14-17' } as unknown as ComposerAnswers, COPY, seededRng(seed), { recentBankKeys: [] });
  if (!r) continue;
  noLoc++;
  for (const t of r.stages.flatMap((s) => s.tasks)) if (t.locationless !== true && t.triggerMode !== 'locationless') located.push(`${audience}/${setting}/s${seed}: ${t.title}`);
  if (r.wizardSteps.some((w) => w.targetFieldPath === 'coordinates')) located.push(`${audience}/${setting}/s${seed}: asks for a pin`);
}
ok(`a game without locations holds only missions played from anywhere (${noLoc} games)`, noLoc >= 40 && located.length === 0, located.slice(0, 5));

console.log(failures === 0 ? '\n✅ mission time: ALL PASS' : `\n❌ mission time: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

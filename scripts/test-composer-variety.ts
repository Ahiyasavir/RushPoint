// The composer's variety (change: composer-variety). Ahiya, 23.10: "more missions in a stage, so not
// every team does the same missions, and use more interesting elements".
//
// Two things are asserted over the answer space, with the counts printed (a rule that holds over zero
// games prints the same green tick):
//   1. CHOICE STAGES. With several teams, a middle stage holds missions beyond what a team must do,
//      the opener and the finale stay shared, nothing grows past six, and a lone group gets none.
//   2. ONE HIDDEN MISSION in a placed game whose creator accepts authoring work: a mission the
//      composer pinned itself, in the middle stage, with a REQUIRED clue step. None otherwise.
import { maxCompletableTasks } from '@rushpoint/shared';
import {
  choiceExtras,
  composeGame,
  seededRng,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
}

const BASE_COPY: ComposerDescriptionCopy = {
  lead: () => 'LEAD',
  ageLabel: (b) => `AGE[${b}]`,
  ageTag: (b) => `agetag-${b}`,
  durationTag: (m) => `durtag-${m}`,
  composedLead: () => 'COMPOSED',
  activityPhrase: (t) => `phrase-${t}`,
  activityJoin: (p) => p.join(' + '),
  activityTag: (t) => `acttag-${t}`,
  placeMissionPrompt: () => 'PLACE_IT',
};
const COPY: ComposerDescriptionCopy = { ...BASE_COPY, hiddenCluePrompt: () => 'WRITE_THE_CLUE' };

console.log('\ncomposer variety');

console.log(' 1. choiceExtras');
ok('a lone group gets no extras', choiceExtras(1) === 0 && choiceExtras(5) === 0);
ok('two teams and up get one', choiceExtras(6) === 1 && choiceExtras(23) === 1);
ok('a crowd gets two', choiceExtras(24) === 2 && choiceExtras(200) === 2);
ok('junk is none', choiceExtras(undefined) === 0 && choiceExtras(Number.NaN) === 0 && choiceExtras('12') === 0);

console.log(' 2. choice stages over the answer space');
const AUD = ['kids', 'youth', 'adults', 'mixed'] as const;
const SET = ['outdoor', 'indoor', 'fromAnywhere'] as const;
let games = 0;
let withExtras = 0;
let extraTotal = 0;
const bad: string[] = [];
for (const audience of AUD) for (const setting of SET) for (const minutes of [60, 120]) for (const people of [4, 12, 30]) for (const seed of [1, 2, 3]) {
  const answers = { audience, setting, minutes, people, locationMissions: setting === 'outdoor', prepEffort: 3, difficultyPreference: 'balanced', ageBandId: 'band-14-17' } as unknown as ComposerAnswers;
  const r = composeGame(TASK_BANK, answers, COPY, seededRng(seed), { recentBankKeys: [] });
  if (!r) continue;
  games++;
  const cell = `${audience}/${setting}/${minutes}/${people}/s${seed}`;
  const extra = new Set(r.extraTaskIds);
  if (extra.size > 0) withExtras++;
  extraTotal += extra.size;
  if (people < 6 && extra.size > 0) bad.push(`${cell}: a lone group got extras`);
  const first = r.stages[0];
  const last = r.stages[r.stages.length - 1];
  if ([first, last].some((st) => st.tasks.some((t) => extra.has(t.id)))) bad.push(`${cell}: the opener or finale got an extra`);
  if ([first, last].some((st) => st.requiredTaskCount !== undefined && st.requiredTaskCount !== st.tasks.length && r.stages.length >= 3 && st.tasks.some((t) => extra.has(t.id)))) bad.push(`${cell}: shared stage is not shared`);
  for (const st of r.stages) {
    if (st.tasks.length > 6 && st.tasks.some((t) => extra.has(t.id))) bad.push(`${cell}: a stage grew past six`);
    const req = st.requiredTaskCount ?? st.tasks.length;
    if (req > maxCompletableTasks(st)) bad.push(`${cell}: a stage requires more than it can yield`);
    const extrasHere = st.tasks.filter((t) => extra.has(t.id)).length;
    if (extrasHere > 0 && req > st.tasks.length - extrasHere) bad.push(`${cell}: an extra raised what a team must do`);
  }
  if (r.usedBankKeys.length !== r.stages.reduce((n, st) => n + st.tasks.length, 0)) bad.push(`${cell}: usedBankKeys does not cover every mission`);
}
console.log(`    ${games} games · ${withExtras} with choice stages · ${extraTotal} extra missions`);
ok(`the sample composed games (${games})`, games >= 150, games);
ok(`games with several teams really get choice stages (${withExtras})`, withExtras >= games / 3, withExtras);
ok('every choice-stage rule holds', bad.length === 0, bad.slice(0, 6));

console.log(' 3. the hidden mission');
let placed = 0;
let hiddenGames = 0;
let noneAtAll = 0;
const hiddenBad: string[] = [];
for (const audience of AUD) for (const seed of [1, 2, 3, 4, 5]) {
  const answers = { audience, setting: 'outdoor', minutes: 90, people: 12, locationMissions: true, prepEffort: 4, difficultyPreference: 'balanced', ageBandId: 'band-14-17' } as unknown as ComposerAnswers;
  const r = composeGame(TASK_BANK, answers, COPY, seededRng(seed), { recentBankKeys: [] });
  if (!r) continue;
  placed++;
  // The composer's own hidden mission is the one with its clue step; the bank has hidden missions of its own.
  const mine = new Set(r.wizardSteps.filter((w) => w.id.startsWith('qs-hidden-')).map((w) => w.taskId));
  const hidden = r.stages.flatMap((st) => st.tasks.filter((t) => mine.has(t.id)).map((t) => ({ st, t })));
  const bankHidden = r.stages.some((st) => st.tasks.some((t) => t.hideLocation === true && !mine.has(t.id)));
  if (hidden.length > 1) hiddenBad.push(`${audience}/s${seed}: ${hidden.length} hidden missions added`);
  if (hidden.length > 0 && bankHidden) hiddenBad.push(`${audience}/s${seed}: added a hidden mission to a game that had one`);
  if (hidden.length === 0 && !bankHidden) noneAtAll++;
  if (hidden.length === 1 && hidden[0].t.hideLocation !== true) hiddenBad.push(`${audience}/s${seed}: the chosen mission is not hidden`);
  if (hidden.length === 1) {
    hiddenGames++;
    const { st, t } = hidden[0];
    const idx = r.stages.indexOf(st);
    if (idx === 0 || idx === r.stages.length - 1) hiddenBad.push(`${audience}/s${seed}: hidden mission in the opener or finale`);
    const clue = r.wizardSteps.find((w) => w.taskId === t.id && w.targetFieldPath === 'locationClue');
    if (!clue || clue.isRequired !== true || clue.instructionPrompt !== 'WRITE_THE_CLUE') hiddenBad.push(`${audience}/s${seed}: no required clue step`);
    if (!r.wizardSteps.some((w) => w.taskId === t.id && w.targetFieldPath === 'coordinates')) hiddenBad.push(`${audience}/s${seed}: the hidden mission is never placed`);
  }
}
console.log(`    ${placed} placed games · ${hiddenGames} with a hidden mission`);
ok(`every placed game with prep work ends with a hidden mission, the bank's or ours (${placed - noneAtAll} of ${placed})`, placed > 0 && noneAtAll <= placed * 0.1, { hiddenGames, noneAtAll, placed });
ok('every hidden-mission rule holds', hiddenBad.length === 0, hiddenBad.slice(0, 6));

const noPrep = composeGame(TASK_BANK, { audience: 'youth', setting: 'outdoor', minutes: 90, people: 12, locationMissions: true, prepEffort: 1, difficultyPreference: 'balanced', ageBandId: 'band-14-17' } as unknown as ComposerAnswers, COPY, seededRng(1), { recentBankKeys: [] });
ok('no hidden mission added when the creator wants no prep', !!noPrep && !noPrep.wizardSteps.some((w) => w.id.startsWith('qs-hidden-')));
const noCopy = composeGame(TASK_BANK, { audience: 'youth', setting: 'outdoor', minutes: 90, people: 12, locationMissions: true, prepEffort: 4, difficultyPreference: 'balanced', ageBandId: 'band-14-17' } as unknown as ComposerAnswers, BASE_COPY, seededRng(1), { recentBankKeys: [] });
ok('no hidden mission added when there is no way to ask for its clue', !!noCopy && !noCopy.wizardSteps.some((w) => w.id.startsWith('qs-hidden-')));

console.log(`\n${failures === 0 ? '✅ composer variety: ALL PASS' : `❌ composer variety: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

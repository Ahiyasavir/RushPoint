// Which missions of a composed game ask for a map pin (changes: composer-siting-by-station,
// then composer-pins-follow-prep, which made the pins follow the prep answer).
//
// At prep level 2 the composer used to turn ~11 missions per game into a required
// map pin, most of them invented: a conversation or a riddle that gains nothing
// from a place (docs/auto-build-setup-research-2026-10-02.md §1.3). Now a placed
// game invents at most ONE pin per stage, never sites a mission marked `never`,
// and the questionnaire says up front what the pins will cost.
//
// The before/after numbers are printed, not only asserted: "mean ≤ 5" passing on a
// sample of zero games would print the same green tick.
import { AGE_BANDS } from '@rushpoint/shared';
import {
  bankSiting,
  composeGame,
  previewPrepCost,
  seededRng,
  SPOT_KINDS,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK, type TaskBankEntry } from '../apps/creator-web/src/taskBank';
import { translations } from '../apps/creator-web/src/i18n';
import { isShortNote } from '../apps/creator-web/src/lib/quickSetup';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
}

const COPY: ComposerDescriptionCopy = {
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

console.log('\ncomposer siting');

// ── 1. The resolver ──────────────────────────────────────────────────────────
console.log(' 1. bankSiting');
const fake = (tags: string[], extra: Partial<TaskBankEntry> = {}) =>
  ({ key: 'k', tags, difficulty: 3, build: () => ({}) , ...extra } as unknown as TaskBankEntry);
ok('locationBased ⇒ must', bankSiting(fake(['locationBased'])) === 'must');
ok('fromAnywhere ⇒ possible', bankSiting(fake(['fromAnywhere'])) === 'possible');
ok('fromAnywhere + locationBased ⇒ must', bankSiting(fake(['fromAnywhere', 'locationBased'])) === 'must');
ok('neither ⇒ never', bankSiting(fake(['youth'])) === 'never');
ok('an explicit never wins over fromAnywhere', bankSiting(fake(['fromAnywhere'], { siting: 'never' } as never)) === 'never');
ok('junk does not throw', bankSiting(null as never) === 'never');

const keys = new Set(TASK_BANK.map((e) => e.key));
const annotated = TASK_BANK.filter((e) => (e as { siting?: string }).siting !== undefined || (e as { spot?: string }).spot !== undefined);
ok(`the bank carries siting annotations (${annotated.length})`, annotated.length >= 20, annotated.length);
const badSpot = TASK_BANK.filter((e) => { const s = (e as { spot?: string }).spot; return s !== undefined && !(SPOT_KINDS as readonly string[]).includes(s); });
ok('every spot is a known kind', badSpot.length === 0, badSpot.map((e) => e.key));
const neverWithSpot = TASK_BANK.filter((e) => bankSiting(e) === 'never' && (e as { spot?: string }).spot);
ok('no mission is both never and given a spot', neverWithSpot.length === 0, neverWithSpot.map((e) => e.key));
ok('the bank keys are unique (annotations target one mission each)', keys.size === TASK_BANK.length);

// ── 2. Over the answer space at prep level 2 ────────────────────────────────
// change: composer-pins-follow-prep. Choosing a location level IS choosing to place
// locations (Ahiya, 2026-10-04), so every mission a place can help gets a pin.
console.log(' 2. composed games at prep level 2: a pin for every mission a place can help');
const byKey = new Map(TASK_BANK.map((e) => [e.key, e]));
const AUDIENCES = ['kids', 'youth', 'adults', 'corporate', 'mixed'] as const;
const SETTINGS = ['outdoor', 'indoor'] as const;
const DURATIONS = [45, 90, 150];
let games = 0;
let pins = 0;
let costMismatch = 0;
const violations: string[] = [];
for (const audience of AUDIENCES) for (const setting of SETTINGS) for (const minutes of DURATIONS) for (const seed of [1, 2, 3, 4]) {
  const answers: ComposerAnswers = {
    audience, setting, minutes, locationMissions: true, prepEffort: 2, people: 24,
    difficultyPreference: 'balanced', ageBandId: AGE_BANDS[seed % AGE_BANDS.length]?.id ?? 'band-14-17',
  } as ComposerAnswers;
  const r = composeGame(TASK_BANK, answers, COPY, seededRng(seed), { recentBankKeys: [] });
  if (!r) continue;
  games++;
  const label = `${audience}/${setting}/${minutes}/s${seed}`;
  const located = r.wizardSteps.filter((s) => s.targetFieldPath === 'coordinates');
  pins += located.length;
  const cost = previewPrepCost(TASK_BANK, answers, seed, { recentBankKeys: [] });
  if (cost.pins !== located.length) costMismatch++;
  const invented = new Set(r.wizardSteps.filter((s) => s.id.endsWith('-placed-coordinates')).map((s) => s.taskId));
  const taskIds = r.stages.flatMap((s) => s.tasks.map((t) => t.id));
  taskIds.forEach((id, i) => {
    const e = byKey.get(r.usedBankKeys[i]);
    if (!e) return;
    const siting = bankSiting(e);
    if (siting === 'possible' && !invented.has(id)) violations.push(`${label}: ${e.key} (possible) got no pin`);
    if (siting !== 'possible' && invented.has(id)) violations.push(`${label}: ${e.key} (${siting}) was given an invented pin`);
  });
}
console.log(`    ${games} games · location steps per game: ${games ? (pins / games).toFixed(1) : 0}`);
ok(`the sample really composed games (${games})`, games >= 60, games);
ok('every possible mission is pinned and nothing else is invented', violations.length === 0, violations.slice(0, 5));
ok(`the cost line equals the pins the game asks for (${games - costMismatch} of ${games})`, costMismatch === 0, costMismatch);

// Prep level 1 asks for no pin at all.
let level1Pins = 0;
let level1Games = 0;
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const r = composeGame(TASK_BANK, { audience: 'youth', setting: 'outdoor', minutes: 90, locationMissions: false, prepEffort: 1, people: 24,
    difficultyPreference: 'balanced', ageBandId: 'band-14-17' } as ComposerAnswers, COPY, seededRng(seed), { recentBankKeys: [] });
  if (!r) continue;
  level1Games++;
  level1Pins += r.wizardSteps.filter((s) => s.id.endsWith('-placed-coordinates')).length;
}
ok(`prep level 1 invents no pin (${level1Games} games)`, level1Games > 0 && level1Pins === 0, level1Pins);

// ── 2b. Riddles and trivia can be placed; conversations and chores cannot ─────
console.log(' 2b. which missions a place can help');
const RIDDLES = ['trivia-bones', 'trivia-longest-river', 'the-hard-riddle', 'invention-order', 'anagram-easy',
  'anagram-medium', 'anagram-hard', 'puzzle-code', 'mystery-gift', 'balloon-message', 'echo-riddle',
  'vault-combination-riddle', 'disarm-the-device', 'household-riddle-comb', 'thinking-room'];
const STAY_NEVER = ['open-team-name', 'two-truths-one-lie', 'honest-compliment', 'open-team-pact', 'best-moment-so-far',
  'celebrants-favorites-ranking', 'chore-sock-pairs', 'chore-room-reset'];
const missing = [...RIDDLES, ...STAY_NEVER].filter((k) => !byKey.has(k));
ok('every named key is in the bank', missing.length === 0, missing);
const stillNever = RIDDLES.filter((k) => byKey.has(k) && bankSiting(byKey.get(k)!) !== 'possible');
ok(`riddles and trivia are possible (${RIDDLES.length - stillNever.length} of ${RIDDLES.length})`, stillNever.length === 0, stillNever);
const nowPossible = STAY_NEVER.filter((k) => byKey.has(k) && bankSiting(byKey.get(k)!) !== 'never');
ok('conversations, pacts and chores stay never', nowPossible.length === 0, nowPossible);

// ── 3. The questionnaire cost line ───────────────────────────────────────────
console.log(' 3. previewPrepCost');
const base = { audience: 'youth', setting: 'outdoor', minutes: 90, people: 24, difficultyPreference: 'balanced', ageBandId: 'band-14-17' } as ComposerAnswers;
const notPlaced = previewPrepCost(TASK_BANK, { ...base, locationMissions: false, prepEffort: 1 } as ComposerAnswers, 7);
ok('no pins when nothing is placed', notPlaced.pins === 0 && notPlaced.minutes === 0, notPlaced);
const placed = previewPrepCost(TASK_BANK, { ...base, locationMissions: true, prepEffort: 2 } as ComposerAnswers, 7);
ok('a placed plan asks for pins', placed.pins >= 3, placed);
ok('…and about a minute and a half each', placed.minutes === Math.ceil(placed.pins * 1.5), placed);
ok('fromAnywhere is never placed', previewPrepCost(TASK_BANK, { ...base, setting: 'fromAnywhere', locationMissions: true } as ComposerAnswers, 7).pins === 0);
let threw = false;
try { previewPrepCost(null as never, null as never, NaN); previewPrepCost([], {} as never, 1); } catch { threw = true; }
ok('total on junk', !threw);

// ── 4. The station line is short enough to be shown open ───────────────────
console.log(' 4. the station prompt fits on one line');
for (const lang of ['he', 'en'] as const) {
  const w = translations[lang].dashboard.wizard;
  const longestSpot = Math.max(...SPOT_KINDS.map((k) => (w.placeSpotHint[k] ?? '').length));
  const total = w.placeMissionPrompt.length + 1 + longestSpot;
  ok(`${lang}: station prompt + longest spot hint is a short note (${total} chars)`,
    isShortNote(`${w.placeMissionPrompt} ${'x'.repeat(longestSpot)}`), total);
}

console.log(failures === 0 ? '\n✅ composer siting: ALL PASS' : `\n❌ composer siting: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

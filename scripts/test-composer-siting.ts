// Stations, not a pin per mission (change: composer-siting-by-station).
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
console.log(' 2. composed games at prep level 2');
const byKey = new Map(TASK_BANK.map((e) => [e.key, e]));
const AUDIENCES = ['kids', 'youth', 'adults', 'corporate', 'mixed'] as const;
const SETTINGS = ['outdoor', 'indoor'] as const;
const DURATIONS = [45, 90, 150];
let games = 0;
let pinsAfter = 0;
let pinsBefore = 0;
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
  // What the old rule would have asked: one pin per possible mission.
  pinsBefore += r.usedBankKeys.filter((k) => bankSiting(byKey.get(k)!) === 'possible' || (byKey.get(k)!.tags.includes('fromAnywhere') && !byKey.get(k)!.tags.includes('locationBased'))).length;
  const invented = r.wizardSteps.filter((s) => s.id.endsWith('-placed-coordinates'));
  pinsAfter += r.wizardSteps.filter((s) => s.targetFieldPath === 'coordinates').length;

  // Map each task id → its bank entry, through the order the composer used.
  const taskIds = r.stages.flatMap((s) => s.tasks.map((t) => t.id));
  const entryOfTask = new Map(taskIds.map((id, i) => [id, byKey.get(r.usedBankKeys[i])]));
  for (const stage of r.stages) {
    const inStage = invented.filter((s) => s.stageId === stage.id);
    if (inStage.length > 1) violations.push(`${label}: ${inStage.length} invented pins in one stage`);
    const hasMust = stage.tasks.some((t) => bankSiting(entryOfTask.get(t.id)!) === 'must');
    if (hasMust && inStage.length > 0) violations.push(`${label}: a stage with a located mission still invented a pin`);
    for (const st of inStage) {
      const e = entryOfTask.get(st.taskId);
      if (!e || bankSiting(e) !== 'possible') violations.push(`${label}: sited ${e?.key} (${e ? bankSiting(e) : 'unknown'})`);
    }
    // A play-anywhere mission that is NOT the anchor stays playable anywhere.
    for (const t of stage.tasks) {
      const e = entryOfTask.get(t.id);
      if (e && bankSiting(e) !== 'must' && !inStage.some((s) => s.taskId === t.id) && t.locationless === false && t.triggerMode === 'radius'
        && !(e.build().locationless === false)) {
        violations.push(`${label}: ${e.key} was made location-gated without a pin`);
      }
    }
  }
}
const meanBefore = games ? pinsBefore / games : 0;
const meanAfter = games ? pinsAfter / games : 0;
console.log(`    ${games} games · location steps per game: before ≈ ${meanBefore.toFixed(1)}, after ${meanAfter.toFixed(1)}`);
ok(`the sample really composed games (${games})`, games >= 60, games);
ok('no stage invents more than one pin, none beside a located mission, never a "never"', violations.length === 0, violations.slice(0, 5));
ok(`mean location steps per game ≤ 5 (got ${meanAfter.toFixed(2)})`, meanAfter <= 5);
ok('the change really removed pins', meanAfter < meanBefore);

// ── 3. The questionnaire cost line ───────────────────────────────────────────
console.log(' 3. previewPrepCost');
const base = { audience: 'youth', setting: 'outdoor', minutes: 90, people: 24, difficultyPreference: 'balanced', ageBandId: 'band-14-17' } as ComposerAnswers;
const notPlaced = previewPrepCost(TASK_BANK, { ...base, locationMissions: false, prepEffort: 1 } as ComposerAnswers, 7);
ok('no pins when nothing is placed', notPlaced.pins === 0 && notPlaced.minutes === 0, notPlaced);
const placed = previewPrepCost(TASK_BANK, { ...base, locationMissions: true, prepEffort: 2 } as ComposerAnswers, 7);
ok('a placed plan costs one pin per planned stage', placed.pins >= 2 && placed.pins <= 6, placed);
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

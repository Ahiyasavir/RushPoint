// Pure-logic tests — a composed game is LAUNCH-VALID BY CONSTRUCTION
// (change: smart-game-composer).
//
// This is the load-bearing test of the whole change.
//
// `updateGame` re-validates every saved game with `stagesProblems`
// (gameStructureProblems + requiredTaskCountProblem + validateUnlockGraph +
// validateAvailabilityWindow). If the composer can emit a game those reject, the
// feature is worse than not shipping: the creator answers a questionnaire, is
// handed a finished-looking game, presses Launch — and is told their game is
// broken, with nothing on screen explaining what they did wrong. They did
// nothing wrong. We built it.
//
// So the guarantee is not "we validate afterwards and repair", it is "the
// composer cannot produce an invalid game in the first place". That claim is only
// as good as its coverage, so this runs a MATRIX — every duration band × every
// audience × every setting × every difficulty preference × several seeds — over
// the REAL bank, through the EXACT battery that
// apps/creator-web/src/lib/__tests__/templatesValid.test.ts runs on templates.
// Same validators, imported from @rushpoint/shared, never re-implemented: if this
// file passes, `updateGame` accepts the payload.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  gameStructureProblems,
  requiredTaskCountProblem,
  validateUnlockGraph,
  validateAvailabilityWindow,
  maxCompletableTasks,
} from '@rushpoint/shared';
import {
  composeGame,
  seededRng,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
  type ComposerResult,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { AGE_BANDS } from '@rushpoint/shared';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
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

const DURATIONS = [30, 60, 90, 120, 180];
const AUDIENCES = ['kids', 'youth', 'adults', 'corporate', 'mixed'] as const;
const SETTINGS = ['outdoor', 'indoor', 'fromAnywhere'] as const;
const PREFERENCES = ['easy', 'balanced', 'hard'] as const;
const SEEDS = [1, 2, 3, 4, 5];
const AGE_BAND_IDS = AGE_BANDS.map((b) => b.id);

/** One matrix cell. Returns a human label so a failure names the exact inputs. */
interface Cell { label: string; answers: ComposerAnswers; seed: number }

const CELLS: Cell[] = [];
for (const minutes of DURATIONS) {
  for (const audience of AUDIENCES) {
    for (const setting of SETTINGS) {
      for (const difficultyPreference of PREFERENCES) {
        for (const seed of SEEDS) {
          CELLS.push({
            label: `${minutes}m/${audience}/${setting}/${difficultyPreference}/s${seed}`,
            seed,
            answers: {
              minutes, audience, setting, difficultyPreference,
              people: 24,
              // Rotate the age band too, so ageFit is exercised across the matrix.
              ageBandId: AGE_BAND_IDS[CELLS.length % AGE_BAND_IDS.length] ?? 'band-14-17',
            },
          });
        }
      }
    }
  }
}

console.log(`\n── running the battery over ${CELLS.length} compositions ─────────`);

// Every failure kind is collected separately and reported ONCE with its first
// offending cell, so a systematic break prints one clear line instead of 1125.
const fail: Record<string, string> = {};
const note = (kind: string, label: string) => { if (!fail[kind]) fail[kind] = label; };

let composed = 0;
const results: ComposerResult[] = [];

for (const cell of CELLS) {
  const r = composeGame(TASK_BANK, cell.answers, COPY, seededRng(cell.seed), { recentBankKeys: [] });
  if (!r) { note('composition returned null', cell.label); continue; }
  composed++;
  results.push(r);

  const stages = r.stages;

  // ── The exact server battery ───────────────────────────────────────────────
  const structure = gameStructureProblems(stages);
  if (structure.length > 0) note(`gameStructureProblems: ${structure[0]}`, cell.label);

  for (const s of stages) {
    const problem = requiredTaskCountProblem(s as never);
    if (problem !== null) note(`requiredTaskCountProblem: ${problem}`, cell.label);

    if (!(s.requiredTaskCount == null || s.requiredTaskCount <= maxCompletableTasks(s as never))) {
      note('requiredTaskCount exceeds maxCompletableTasks', cell.label);
    }

    const unlock = validateUnlockGraph(s).errors;
    if (unlock.length > 0) note(`validateUnlockGraph: ${unlock[0]}`, cell.label);

    for (const tk of s.tasks) {
      const window = validateAvailabilityWindow(tk);
      if (window !== null) note(`validateAvailabilityWindow: ${window}`, cell.label);
    }

    if (s.tasks.length === 0) note('a stage has no missions', cell.label);
    if (!(typeof s.requiredTaskCount === 'number' && s.requiredTaskCount >= 1)) {
      note('a stage has no positive requiredTaskCount', cell.label);
    }
  }

  // ── Structural invariants the composer promises on top ─────────────────────
  const finals = stages.filter((s) => s.isFinal === true);
  if (finals.length !== 1) note(`expected exactly one final stage, saw ${finals.length}`, cell.label);
  if (stages.length > 0 && stages[stages.length - 1].isFinal !== true) {
    note('the final stage is not the last stage', cell.label);
  }

  if (stages.some((s, i) => s.order !== i)) note('stage.order does not match its index', cell.label);

  const stageIds = stages.map((s) => s.id);
  const taskIds = stages.flatMap((s) => s.tasks.map((t) => t.id));
  const allIds = [...stageIds, ...taskIds];
  if (new Set(allIds).size !== allIds.length) note('duplicate id within one result', cell.label);
  if (allIds.some((id) => typeof id !== 'string' || id === '')) note('an id is empty', cell.label);

  // ── Advanced structures the composer must never emit ───────────────────────
  for (const s of stages) {
    const raw = s as unknown as Record<string, unknown>;
    if (raw.exclusiveGroups !== undefined) note('a stage carries exclusiveGroups', cell.label);
    for (const tk of s.tasks) {
      const t = tk as unknown as Record<string, unknown>;
      if (t.unlockAfterTaskIds !== undefined) note('a mission carries unlockAfterTaskIds', cell.label);
      if (t.availableFrom !== undefined || t.availableUntil !== undefined) {
        note('a mission carries an availability window', cell.label);
      }
    }
  }

  // ── The rest of the result must be usable too ──────────────────────────────
  if (typeof r.description !== 'string' || r.description.trim() === '') note('empty description', cell.label);
  if (!Array.isArray(r.tags)) note('tags is not an array', cell.label);
  if (!Array.isArray(r.wizardSteps)) note('wizardSteps is not an array', cell.label);
  if (!(typeof r.estimatedMinutes === 'number' && Number.isFinite(r.estimatedMinutes) && r.estimatedMinutes > 0)) {
    note('estimatedMinutes is not a positive finite number', cell.label);
  }
  if (typeof r.scoringPreset !== 'string' || !r.scoringPreset) note('no scoring preset', cell.label);
  if (typeof r.mode !== 'string' || !r.mode) note('no game mode', cell.label);
  if (new Set(r.usedBankKeys).size !== r.usedBankKeys.length) note('a mission was used twice', cell.label);
}

console.log('\n── 1. every cell composed ──────────────────────────────────');
eq(`all ${CELLS.length} matrix cells produced a game`, composed, CELLS.length);

console.log('\n── 2. the server battery accepts every one ─────────────────');
{
  const kinds = Object.entries(fail);
  if (kinds.length === 0) {
    ok('gameStructureProblems is empty for every composition', true);
    ok('requiredTaskCountProblem is null for every stage', true);
    ok('requiredTaskCount never exceeds maxCompletableTasks', true);
    ok('validateUnlockGraph reports no error for any stage', true);
    ok('validateAvailabilityWindow is null for every mission', true);
    ok('every stage holds at least one mission with a positive required count', true);
    ok('exactly one final stage, and it is the last', true);
    ok('stage order matches index, and every id is unique and non-empty', true);
    ok('no exclusiveGroups, no unlock dependencies, no availability windows', true);
    ok('description, tags, wizard steps, preset, mode and duration are all usable', true);
  } else {
    for (const [kind, label] of kinds) {
      failures++;
      console.error(`  ✗ ${kind}  — first seen at ${label}`);
    }
  }
}

console.log('\n── 3. the matrix really varied the output ──────────────────');
{
  // A battery that passes because every cell produced the SAME game would prove
  // very little. This is the guard against a composer that silently ignores its
  // answers.
  const shapes = new Set(results.map((r) => r.stages.map((s) => s.tasks.length).join('-')));
  ok(`the matrix produced many distinct stage shapes (${shapes.size})`, shapes.size >= 5);

  const missionSets = new Set(results.map((r) => [...r.usedBankKeys].sort().join('|')));
  ok(`…and many distinct mission sets (${missionSets.size})`, missionSets.size >= 20);

  const blueprints = new Set(results.map((r) => r.blueprintKey));
  ok(`…across more than one blueprint (${[...blueprints].join(', ')})`, blueprints.size >= 2);

  const sizes = results.map((r) => r.usedBankKeys.length);
  ok(`…and a range of game lengths (${Math.min(...sizes)}-${Math.max(...sizes)} missions)`,
    Math.max(...sizes) > Math.min(...sizes));
}

console.log('\n── 4. longer answers really produce longer games ───────────');
{
  const at = (minutes: number) => {
    const r = composeGame(TASK_BANK, {
      minutes, audience: 'youth', setting: 'outdoor', people: 24,
      ageBandId: 'band-14-17', difficultyPreference: 'balanced',
    }, COPY, seededRng(9), { recentBankKeys: [] });
    return r ? r.usedBankKeys.length : 0;
  };
  const series = DURATIONS.map(at);
  ok(`mission count never decreases as duration grows (${series.join(', ')})`,
    series.every((v, i) => i === 0 || v >= series[i - 1]));
  ok('the longest answer yields more missions than the shortest', series[series.length - 1] > series[0]);
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/validators: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/validators: all assertions passed\x1b[0m');

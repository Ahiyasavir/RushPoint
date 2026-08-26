// Pure-logic tests — a composed game's Quick Setup always completes
// (change: smart-game-composer).
//
// Quick Setup is the creator's first screen after the questionnaire. It is a list
// of "fill this in" steps, each pointing at one field of one mission. A step
// pointing at a mission that is not in the game, or at a field that mission does
// not have, renders a control bound to nothing: the creator taps it, nothing
// happens, and a required step can never be satisfied. That is a dead end in the
// very first thirty seconds of the product.
//
// templates.ts declares its steps POSITIONALLY (stage index, task index) and
// resolves them to ids after `build()` — it has to, because it declares the setup
// before the ids exist. The composer has no such problem: it mints the mission
// and knows its id in the same statement, so it binds directly and there is no
// resolution step that can go stale.
//
// The guarantee is asserted through the REAL `resolveWizardTarget` from
// packages/shared/src/templateWizard.ts — the same function the Quick Setup
// screen itself calls. Re-implementing the resolver here would only prove that
// the test agrees with itself.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import { resolveWizardTarget, AGE_BANDS } from '@rushpoint/shared';
import {
  composeGame,
  seededRng,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK, type TaskBankEntry } from '../apps/creator-web/src/taskBank';
import type { BankTagId } from '../apps/creator-web/src/bankTags';
import { task } from '../apps/creator-web/src/taskShorthands';

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
// Pinning is now its own explicit answer (change: location-missions-opt-in) —
// covered as its own dimension so the matrix exercises BOTH "leave everything
// playable from anywhere" (the default) and "guide me through pinning each one".
const LOCATION_MISSIONS = [false, true] as const;
const AGE_BAND_IDS = AGE_BANDS.map((b) => b.id);

interface Cell { label: string; answers: ComposerAnswers; seed: number }
const CELLS: Cell[] = [];
for (const minutes of DURATIONS) {
  for (const audience of AUDIENCES) {
    for (const setting of SETTINGS) {
      for (const locationMissions of LOCATION_MISSIONS) {
        for (const seed of [1, 2, 3]) {
          CELLS.push({
            label: `${minutes}m/${audience}/${setting}/loc${locationMissions ? 1 : 0}/s${seed}`,
            seed,
            answers: {
              minutes, audience, setting, locationMissions, people: 24,
              difficultyPreference: 'balanced',
              ageBandId: AGE_BAND_IDS[CELLS.length % AGE_BAND_IDS.length] ?? 'band-14-17',
            },
          });
        }
      }
    }
  }
}

const fail: Record<string, string> = {};
const note = (kind: string, label: string) => { if (!fail[kind]) fail[kind] = label; };

console.log(`\n── resolving every step of ${CELLS.length} composed games ────────`);

let totalSteps = 0;
let withSteps = 0;
let requiredSteps = 0;

for (const cell of CELLS) {
  const r = composeGame(TASK_BANK, cell.answers, COPY, seededRng(cell.seed), { recentBankKeys: [] });
  if (!r) { note('composition returned null', cell.label); continue; }

  // Exactly what the Builder holds and the Quick Setup screen points into.
  const game = { stages: r.stages, wizardSteps: r.wizardSteps };

  const stageIds = new Set(r.stages.map((s) => s.id));
  const taskIds = new Set(r.stages.flatMap((s) => s.tasks.map((t) => t.id)));

  if (r.wizardSteps.length > 0) withSteps++;
  totalSteps += r.wizardSteps.length;

  const seenIds = new Set<string>();
  for (const step of r.wizardSteps) {
    // ── The guarantee ────────────────────────────────────────────────────────
    const target = resolveWizardTarget(game, step);
    if (target === null) {
      note(`a step did not resolve (field "${step.targetFieldPath}")`, cell.label);
      continue;
    }

    // ── …and the details behind it ───────────────────────────────────────────
    if (!stageIds.has(step.stageId)) note('a step names a stage not in the game', cell.label);
    if (step.taskId && !taskIds.has(step.taskId)) note('a step names a mission not in the game', cell.label);

    if (typeof step.id !== 'string' || step.id === '') note('a step has no id', cell.label);
    if (seenIds.has(step.id)) note(`duplicate step id "${step.id}"`, cell.label);
    seenIds.add(step.id);

    if (typeof step.instructionPrompt !== 'string' || step.instructionPrompt.trim() === '') {
      note('a step has an empty prompt', cell.label);
    }
    if (typeof step.targetFieldPath !== 'string' || step.targetFieldPath.trim() === '') {
      note('a step has an empty field path', cell.label);
    }

    if (step.isRequired === true) {
      requiredSteps++;
      // A REQUIRED step the creator cannot satisfy is the dead end this whole
      // file exists to prevent: it must resolve to a real mission field.
      if (target.taskIndex < 0) note('a required step resolves to no mission', cell.label);
      if (!step.taskId) note('a required step carries no mission id', cell.label);
    }

    // The resolved target must agree with what the step claims.
    if (target.stageId !== step.stageId) note('resolved stage differs from the declared one', cell.label);
    if (step.taskId && target.taskId !== step.taskId) note('resolved mission differs from the declared one', cell.label);
  }

  // ── Every chosen mission that ASKS for setup must have contributed ────────
  //
  // Two sources of steps, not one. Besides what an entry DECLARES, the composer
  // adds a pin request for every play-from-anywhere mission it decided to site
  // (see siteableInPlacedGame) — that step exists because of the composition, not
  // because of the mission, so it cannot come from the bank entry.
  const byKey = new Map(TASK_BANK.map((e) => [e.key, e]));
  // OUTDOOR only — an indoor game leaves its missions playable anywhere in the
  // venue rather than making the creator pin each one (see wantsPlacedMissions).
  // Matches wantsPlacedMissions: any venue setting, only when the creator
  // explicitly asked for pinned missions.
  const placedGame = cell.answers.setting !== 'fromAnywhere' && cell.answers.locationMissions === true;
  const expected = r.usedBankKeys.flatMap((k) => {
    const entry = byKey.get(k);
    const declared = (entry?.setup ?? []).map((st) => st.field);
    const sited = placedGame && entry
      && entry.tags.includes('fromAnywhere') && !entry.tags.includes('locationBased');
    return sited ? ['coordinates', ...declared] : declared;
  });
  const produced = r.wizardSteps.map((st) => st.targetFieldPath);
  if (expected.length !== produced.length) {
    note(`step count ${produced.length} does not match the ${expected.length} the chosen missions declare`, cell.label);
  }
  const missing = expected.filter((f) => !produced.includes(f));
  if (missing.length > 0) note(`a chosen mission's setup produced no step (${missing[0]})`, cell.label);
}

console.log('\n── 1. every emitted step resolves ──────────────────────────');
{
  const kinds = Object.entries(fail);
  if (kinds.length === 0) {
    ok('every step resolves through the real resolveWizardTarget', true);
    ok('every step names a stage and mission that are in the game', true);
    ok('every step has a unique id, a prompt and a field path', true);
    ok('every REQUIRED step resolves to a real mission field', true);
    ok('the resolved target always agrees with the declared ids', true);
    ok('every chosen mission that declares setup produced exactly one step', true);
  } else {
    for (const [kind, label] of kinds) {
      failures++;
      console.error(`  ✗ ${kind}  — first seen at ${label}`);
    }
  }
  ok(`steps were actually produced (${totalSteps} across ${withSteps}/${CELLS.length} games)`, totalSteps > 0);
  ok(`required steps were actually produced (${requiredSteps})`, requiredSteps > 0);
}

console.log('\n── 2. an unchosen mission contributes nothing ──────────────');
{
  // Fixture bank: exactly one mission declares setup, and it is deliberately a
  // terrible fit, so most seeds will not choose it. Whenever it is absent, no
  // step referring to its field may exist.
  const entry = (key: string, tags: BankTagId[], setup?: { field: string; prompt: string; required?: boolean }[]): TaskBankEntry => ({
    key, tags, difficulty: 5, sourceTemplateKey: 'fixture',
    ...(setup ? { setup } : {}),
    build: () => task({ title: key, description: key, difficulty: 5, numericAnswer: 1, type: 'numeric' }),
  });

  const BANK: TaskBankEntry[] = [
    entry('open-a', ['start', 'youth', 'outdoor', 'fromAnywhere']),
    entry('open-b', ['start', 'youth', 'outdoor', 'fromAnywhere']),
    entry('end-a', ['finish', 'youth', 'outdoor', 'fromAnywhere']),
    entry('end-b', ['finish', 'youth', 'outdoor', 'fromAnywhere']),
    ...Array.from({ length: 12 }, (_, i) => entry(`mid-${i}`, ['youth', 'outdoor', 'fromAnywhere'])),
    entry('lonely-setup', ['corporate', 'indoor'], [{ field: 'numericAnswer', prompt: 'SENTINEL', required: true }]),
  ];

  let leaked = ''; let sawAbsent = 0; let sawPresent = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = composeGame(BANK, {
      audience: 'youth', setting: 'outdoor', people: 20, minutes: 60,
      ageBandId: 'band-14-17', difficultyPreference: 'balanced',
    }, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) continue;

    const chosen = r.usedBankKeys.includes('lonely-setup');
    const hasStep = r.wizardSteps.some((s) => s.instructionPrompt === 'SENTINEL');
    if (chosen) { sawPresent++; if (!hasStep) leaked ||= `seed ${seed}: chosen but no step`; }
    else { sawAbsent++; if (hasStep) leaked ||= `seed ${seed}: NOT chosen but a step was emitted`; }
  }

  eq('a step exists exactly when its mission was chosen', leaked, '');
  ok(`the unchosen case was actually exercised (${sawAbsent} of 40)`, sawAbsent > 0);
  ok(`the chosen case was actually exercised (${sawPresent} of 40)`, sawPresent > 0 || sawAbsent === 40);
}

console.log('\n── 3. no setup anywhere is a valid, empty outcome ──────────');
{
  const entry = (key: string, tags: BankTagId[]): TaskBankEntry => ({
    key, tags, difficulty: 5, sourceTemplateKey: 'fixture',
    build: () => task({ title: key, description: key, difficulty: 5 }),
  });
  const BANK: TaskBankEntry[] = [
    entry('open', ['start', 'youth', 'outdoor', 'fromAnywhere']),
    entry('end', ['finish', 'youth', 'outdoor', 'fromAnywhere']),
    ...Array.from({ length: 12 }, (_, i) => entry(`mid-${i}`, ['youth', 'outdoor', 'fromAnywhere'])),
  ];

  // A NO-VENUE game on purpose: this scenario is about a bank that declares no
  // setup, and a located game would add a pin request per mission of its own
  // accord (see siteableInPlacedGame), which is a different rule with its own
  // coverage below.
  const r = composeGame(BANK, {
    audience: 'youth', setting: 'fromAnywhere', people: 20, minutes: 60,
    ageBandId: 'band-14-17', difficultyPreference: 'balanced',
  }, COPY, seededRng(1), { recentBankKeys: [] });

  ok('a bank with no setup still composes', r !== null);
  if (r) {
    eq('…and emits an empty step list', r.wizardSteps, []);
    ok('…while still producing a real game', r.stages.length > 0 && r.usedBankKeys.length > 0);
  }
}

console.log('\n── 4. two missions asking for the same field stay distinct ─');
{
  const entry = (key: string, tags: BankTagId[], withSetup: boolean): TaskBankEntry => ({
    key, tags, difficulty: 5, sourceTemplateKey: 'fixture',
    ...(withSetup ? { setup: [{ field: 'numericAnswer', prompt: `P-${key}`, required: true }] } : {}),
    build: () => task({ title: key, description: key, difficulty: 5, type: 'numeric', numericAnswer: 1 }),
  });

  // Every mid mission declares the SAME field, so several slots collide on it.
  const BANK: TaskBankEntry[] = [
    entry('open', ['start', 'youth', 'outdoor', 'fromAnywhere'], true),
    entry('end', ['finish', 'youth', 'outdoor', 'fromAnywhere'], true),
    ...Array.from({ length: 14 }, (_, i) => entry(`mid-${i}`, ['youth', 'outdoor', 'fromAnywhere'], true)),
  ];

  let bad = '';
  for (let seed = 1; seed <= 20; seed++) {
    const r = composeGame(BANK, {
      audience: 'youth', setting: 'outdoor', locationMissions: true, people: 20, minutes: 120,
      ageBandId: 'band-14-17', difficultyPreference: 'balanced',
    }, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) { bad ||= `seed ${seed}: null`; continue; }

    const ids = r.wizardSteps.map((s) => s.id);
    if (new Set(ids).size !== ids.length) bad ||= `seed ${seed}: duplicate step ids ${ids.join(',')}`;
    // Every mission declares one step, and every one is siteable in this OUTDOOR
    // game with locationMissions on, so each contributes a pin request too.
    const want = r.usedBankKeys.length * 2;
    if (r.wizardSteps.length !== want) {
      bad ||= `seed ${seed}: ${r.wizardSteps.length} steps, expected ${want}`;
    }

    // Each must still point at its OWN mission, not all at the first one. Two
    // steps per mission now, so the check is on the COUNT PER mission.
    const perTask = new Map<string, number>();
    for (const st of r.wizardSteps) perTask.set(st.taskId, (perTask.get(st.taskId) ?? 0) + 1);
    if ([...perTask.values()].some((n) => n !== 2)) bad ||= `seed ${seed}: uneven steps per mission`;
    if (perTask.size !== r.usedBankKeys.length) bad ||= `seed ${seed}: steps share a mission id`;

    const game = { stages: r.stages, wizardSteps: r.wizardSteps };
    if (r.wizardSteps.some((s) => resolveWizardTarget(game, s) === null)) bad ||= `seed ${seed}: unresolved`;
  }
  eq('many missions sharing one field still produce distinct, resolvable steps', bad, '');
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/wizard-steps: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/wizard-steps: all assertions passed\x1b[0m');

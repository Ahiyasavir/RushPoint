// Pure-logic tests — the QUALITY of every Quick Setup instruction in the bank
// (change: smart-game-composer).
//
// scripts/test-task-bank.ts already asserts a setup step points at a field that
// EXISTS on the mission. That is necessary and nowhere near sufficient. Quick
// Setup is the creator's first screen after the questionnaire, and it failed
// them in two ways that "the field exists" could never catch:
//
//   1. THE STEP WENT NOWHERE. A field can be real on the Task and still be
//      unknown to `QUICK_SETUP_FIELDS`, the registry that decides which tab to
//      open and which control to focus. Three missions pointed at bare `smart`,
//      which is a real Task field but not a registered one, so the step rendered,
//      the creator tapped it, and the Builder focused nothing. The instruction
//      said "set the code" and the product did not show them the code box.
//
//   2. THE INSTRUCTION WAS IN THE WRONG LANGUAGE. Bank prose is bilingual in one
//      string ("Hebrew\n\nEnglish"), and 24 of 50 steps carried only the Hebrew
//      half. An English creator was handed Hebrew instructions for the single
//      most instruction-dependent screen in the product. The i18n gate cannot see
//      this: these strings are DATA in taskBank.ts, not dictionary entries, so
//      PART A never walks them.
//
// Both are now structural. A new mission cannot ship a step that navigates
// nowhere, and cannot ship one an English creator cannot read.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { QUICK_SETUP_FIELDS } from '../apps/creator-web/src/lib/quickSetup';
import { hasEnglishWord, hasHebrew } from './lib/i18nLeak';

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

/** Every setup step in the bank, flattened, with the mission that owns it. */
const STEPS = TASK_BANK.flatMap((e) => (e.setup ?? []).map((s) => ({ key: e.key, ...s })));

/** The bilingual halves of a bank string: "Hebrew\n\nEnglish". */
function halves(prompt: string): { he: string; en: string } {
  const parts = String(prompt).split('\n\n');
  return { he: (parts[0] ?? '').trim(), en: (parts.slice(1).join('\n\n') ?? '').trim() };
}

console.log('\n── 1. there is something to check ──────────────────────────');
ok(`the bank declares setup steps (${STEPS.length})`, STEPS.length > 0);
ok('every step names a field', STEPS.every((s) => typeof s.field === 'string' && s.field !== ''));

console.log('\n── 2. every step actually navigates somewhere ──────────────');
{
  // The registry `quickSetupFocusPlan` reads. A field missing from it yields
  // `none` — the Builder opens no tab and focuses no control, so the creator is
  // told to set something and never shown where.
  const known = new Set(Object.keys(QUICK_SETUP_FIELDS));
  const orphaned = STEPS
    .filter((s) => !known.has(s.field))
    .map((s) => `${s.key} -> "${s.field}"`);

  eq('every setup field is one Quick Setup knows how to focus', orphaned, []);

  // A REQUIRED step that goes nowhere is the worst case: it blocks the launch
  // and gives the creator no way to satisfy it.
  const orphanedRequired = STEPS
    .filter((s) => s.required === true && !known.has(s.field))
    .map((s) => `${s.key} -> "${s.field}"`);
  eq('…and no REQUIRED step is unreachable', orphanedRequired, []);
}

console.log('\n── 3. every instruction exists in BOTH languages ───────────');
{
  const missingEn = STEPS.filter((s) => halves(s.prompt).en === '').map((s) => `${s.key}/${s.field}`);
  eq(`every step carries an English half (${STEPS.length - missingEn.length}/${STEPS.length} do)`, missingEn, []);

  const missingHe = STEPS.filter((s) => halves(s.prompt).he === '').map((s) => `${s.key}/${s.field}`);
  eq('every step carries a Hebrew half', missingHe, []);
}

console.log('\n── 4. the halves are really in their language ──────────────');
{
  // Same predicate the i18n gate uses — imported, never re-implemented.
  const heLeaks = STEPS
    .filter((s) => { const h = halves(s.prompt).he; return h !== '' && !hasHebrew(h); })
    .map((s) => `${s.key}/${s.field}`);
  eq('the Hebrew half is Hebrew', heLeaks, []);

  const enLeaks = STEPS
    .filter((s) => { const e = halves(s.prompt).en; return e !== '' && hasHebrew(e); })
    .map((s) => `${s.key}/${s.field}`);
  eq('the English half carries no Hebrew', enLeaks, []);

  const enEmpty = STEPS
    .filter((s) => { const e = halves(s.prompt).en; return e !== '' && !hasEnglishWord(e) && !/[A-Za-z]/.test(e); })
    .map((s) => `${s.key}/${s.field}`);
  eq('the English half is actually words', enEmpty, []);
}

console.log('\n── 5. the instruction is usable prose ──────────────────────');
{
  // Long enough to say what to do. "Set it" is not an instruction.
  const tooShort = STEPS
    .filter((s) => halves(s.prompt).he.length < 15)
    .map((s) => `${s.key}/${s.field}: "${halves(s.prompt).he}"`);
  eq('no instruction is too short to be actionable', tooShort, []);

  // Short enough to read on a phone, above the control it is about.
  const tooLong = STEPS
    .filter((s) => halves(s.prompt).he.length > 240 || halves(s.prompt).en.length > 240)
    .map((s) => `${s.key}/${s.field}`);
  eq('no instruction is longer than a phone screen will show', tooLong, []);

  const untrimmed = STEPS
    .filter((s) => s.prompt !== s.prompt.trim())
    .map((s) => `${s.key}/${s.field}`);
  eq('no instruction has stray leading or trailing whitespace', untrimmed, []);

  // A step whose prose is byte-identical to another step ON THE SAME MISSION is
  // two controls with one instruction — the creator cannot tell them apart.
  const dupeWithinMission: string[] = [];
  for (const e of TASK_BANK) {
    const prompts = (e.setup ?? []).map((s) => s.prompt);
    if (new Set(prompts).size !== prompts.length) dupeWithinMission.push(e.key);
  }
  eq('no mission repeats the same instruction twice', dupeWithinMission, []);
}

console.log('\n── 6. an instruction never leaks the data model ────────────');
{
  // The creator reads these. A raw field path or a code identifier in the prose
  // is the implementation showing through.
  const LEAKY = ['numericAnswer', 'locationClue', 'coordinates', 'smart.', 'surveyChoices',
    'requiredTaskCount', 'pointValue', 'expectedDurationMinutes', 'undefined', 'null'];
  const leaks: string[] = [];
  for (const s of STEPS) {
    for (const token of LEAKY) {
      if (s.prompt.includes(token)) leaks.push(`${s.key}/${s.field}: "${token}"`);
    }
  }
  eq('no instruction shows a raw field name to the creator', leaks, []);
}

console.log('\n── 7. a step that asks for a PIN is on a located mission ───');
{
  // "Drop this mission's pin on the map" makes no sense on a mission that is
  // played from anywhere — the location control is not even shown.
  const misplaced = TASK_BANK
    .filter((e) => (e.setup ?? []).some((s) => s.field === 'coordinates'))
    .filter((e) => {
      const t = e.build();
      return t.locationless === true && !e.tags.includes('locationBased');
    })
    .map((e) => e.key);
  eq('no play-from-anywhere mission asks the creator to drop a pin', misplaced, []);
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/setup-quality: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/setup-quality: all assertions passed\x1b[0m');

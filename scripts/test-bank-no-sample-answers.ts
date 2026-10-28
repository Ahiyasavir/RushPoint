// An answer the setup walk asks the creator for is never shipped with a sample (Ahiya, 28.10).
//
// "Where do they type the correct code?" turned out to be a whole class. Fifteen bank missions asked
// the creator for an answer that only THEY can know (how many benches are here, the word their signs
// spell, what they wrapped, the shops on their street) and were built with a sample in it: 6,
// 'כדור', 'פעם', five invented shop names. A filled field reads as done, so the walk skipped past it
// and offered "keep it", and the game launched with an answer no team could ever give. And three
// codes the creator plants were one fixed value in every game ('1234', '3719', 4821).
//
// A quiz or numeric mission with no answer cannot be SAVED (gameStructureProblems), so the sample
// stays; what changes is that it no longer passes for done. For every bank setup step that targets
// an answer field:
//   • either the step says `sample: true`: the composer marks the step (SAMPLE_STEP_PREFIX), the walk
//     shows an empty box with the sample as a placeholder, and the launch stays blocked until the
//     creator writes their own value (confirmSampleStep), or
//   • the entry is declared FRESH below: a code the creator copies, different on every build.
// Also: a creator blank that asks for several things in one box ("the start AND the steps", "what to
// count for each digit") is split into one blank per thing, each on its own row.
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { parseSentence } from '../apps/creator-web/src/lib/sentenceForm';
import { composeGame } from '../apps/creator-web/src/lib/composeGame';
import { confirmEditedSamples } from '../apps/creator-web/src/lib/quickSetup';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWizardStepConfigured, isSampleStep, confirmSampleStep, SAMPLE_STEP_PREFIX } from '@rushpoint/shared';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
}

const ANSWER_FIELDS = ['numericAnswer', 'answers', 'choices', 'orderItems'] as const;
/** Codes the creator only copies onto what they plant. Fresh per build, never empty. */
const FRESH = new Set(['four-places', 'balloon-message', 'color-code-trail']);

const isEmpty = (v: unknown) => v === undefined || v === null || (Array.isArray(v) && v.every((x) => String(x ?? '').trim() === ''));

const sampled: string[] = [];
const notFresh: string[] = [];
let asked = 0;
for (const e of TASK_BANK) {
  for (const step of e.setup ?? []) {
    if (!(ANSWER_FIELDS as readonly string[]).includes(step.field)) continue;
    asked++;
    const a = (e.build() as unknown as Record<string, unknown>)[step.field];
    if (step.sample === true) continue;
    if (FRESH.has(e.key)) {
      const values = new Set(Array.from({ length: 30 }, () => JSON.stringify((e.build() as unknown as Record<string, unknown>)[step.field])));
      if (isEmpty(a) || values.size < 20) notFresh.push(`${e.key}.${step.field}`);
    } else if (!isEmpty(a)) {
      sampled.push(`${e.key}.${step.field}=${JSON.stringify(a)}`);
    }
  }
}
console.log(`\n${asked} answer fields the walk asks the creator for`);
ok('none ships with a sample that passes for done (not marked sample, not fresh)', sampled.length === 0, sampled);
ok('every declared code is fresh per build', notFresh.length === 0, notFresh);
ok('every FRESH entry still exists', [...FRESH].every((k) => TASK_BANK.some((e) => e.key === k)));

console.log('\na sample never passes for done');
{
  const t = { id: 't', type: 'numeric', title: 'x', numericAnswer: 6 };
  const game = { id: 'g', stages: [{ id: 's', order: 0, tasks: [t] }], wizardSteps: [
    { id: `${SAMPLE_STEP_PREFIX}qs-0-numericAnswer`, stageId: 's', taskId: 't', targetFieldPath: 'numericAnswer', instructionPrompt: '', isRequired: true },
  ] };
  ok('a marked step reads as open although the field holds 6', !isWizardStepConfigured(game as never, game.wizardSteps[0]));
  const confirmed = confirmSampleStep(game as never, game.wizardSteps[0].id) as typeof game;
  ok('confirming drops the mark', confirmed.wizardSteps[0].id === 'qs-0-numericAnswer' && !isSampleStep(confirmed.wizardSteps[0]));
  ok("and the creator's value then reads as done", isWizardStepConfigured(confirmed as never, confirmed.wizardSteps[0]));
  ok('confirming an unmarked step is a no-op', confirmSampleStep(confirmed as never, 'qs-0-numericAnswer') === (confirmed as never));
  // The Builder's setter runs every edit through confirmEditedSamples, whichever screen made it.
  const edited = { ...game, stages: [{ ...game.stages[0], tasks: [{ ...t, numericAnswer: 11 }] }] };
  const viaEditor = confirmEditedSamples(game as never, edited as never) as typeof game;
  ok('an edit of the field in any screen drops the mark', !isSampleStep(viaEditor.wizardSteps[0]));
  const other = { ...game, title: 'renamed' };
  ok('an unrelated edit keeps the mark (and the same object)', confirmEditedSamples(game as never, other as never) === (other as never));
  const builder = readFileSync(join(process.cwd(), 'apps/creator-web/src/pages/BuilderPage.tsx'), 'utf8');
  ok('the Builder setter goes through confirmEditedSamples', /const setGame = [^\n]*confirmEditedSamples\(/.test(builder));
}
{
  // The composer carries the mark from the bank to the game.
  const COPY = { lead: () => '', ageLabel: () => '', ageTag: () => '', durationTag: () => '', composedLead: () => '',
    activityPhrase: () => '', activityJoin: (p: string[]) => p.join(' '), activityTag: () => '', placeMissionPrompt: () => '' };
  const marked = new Set<string>();
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 60; i++) {
    const r = composeGame(TASK_BANK, { audience: i % 2 ? 'youth' : 'adults', setting: 'outdoor', minutes: 120, locationMissions: true,
      prepEffort: 5, people: 24, difficultyPreference: 'balanced', ageBandId: 'band-14-17' } as never, COPY as never, rng, { recentBankKeys: [] });
    for (const s of r?.wizardSteps ?? []) if (isSampleStep(s)) marked.add(s.targetFieldPath);
  }
  ok('composed games carry marked sample steps', marked.size > 0, [...marked]);
}

console.log('\none thing per blank');
const multi: string[] = [];
let blanks = 0;
for (const e of TASK_BANK) {
  const t = e.build() as unknown as Record<string, unknown>;
  for (const f of ['title', 'description', 'hint', 'locationClue']) {
    for (const p of parseSentence(t[f]) as { kind: string; hint?: string }[]) {
      if (p.kind !== 'slot') continue;
      blanks++;
      // "X and the Y" or "for each … in order" in ONE blank is several answers in one box.
      if (/לכל .+ לפי הסדר|ארבעה מקומות|ההתחלה והצעדים/.test(p.hint ?? '')) multi.push(`${e.key}: ${p.hint}`);
    }
  }
}
console.log(`  (${blanks} creator blanks checked)`);
ok('no blank asks for several things at once', multi.length === 0, multi);
for (const key of ['four-places', 'the-combination-lock', 'pirate-map']) {
  const e = TASK_BANK.find((x) => x.key === key);
  const n = e ? (parseSentence(e.build().description) as { kind: string }[]).filter((p) => p.kind === 'slot').length : 0;
  ok(`${key} has one blank per thing`, n === ({ 'four-places': 4, 'the-combination-lock': 3, 'pirate-map': 2 } as Record<string, number>)[key], n);
}

console.log(failures === 0 ? '\n✅ bank sample answers: ALL PASS' : `\n❌ bank sample answers: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

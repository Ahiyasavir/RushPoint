// Pure-logic invariants for the FLAGSHIP instant-play demo game
// (change: flagship-instant-demo).
//
// This is the game a first-time visitor taps "נסה משחק לדוגמה" / "Try a sample
// game" and plays instantly, solo, from anywhere on earth — no organizer, no
// staff approval, no GPS. These assertions pin the contract that makes that
// possible, so a later edit to the game definition can never quietly reintroduce
// a located task, a review-gated photo, a consent gate, or a dead-end stage.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
// DOM-free, emulator-free.
//   npx tsx scripts/test-flagship-demo.ts
import {
  GAME_ID,
  OWNER_UID,
  GAME_META,
  INSTRUCTIONS,
  buildStages,
  buildFlagshipGame,
} from './lib/spy-academy-game-def.mjs';
import {
  normalizeTriggerMode,
  describeGameRequirements,
  requiredTaskCountProblem,
  publicTaskLocation,
} from '../packages/shared/src/index';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const HEBREW = /[֐-׿]/;
const LATIN = /[A-Za-z]/;

const stages = buildStages();
const allTasks = stages.flatMap((s: any) => s.tasks);
const game = buildFlagshipGame(new Date().toISOString());

// ── Shape: a short, focused flagship (2–3 stages, 6–9 tasks, one final) ───────
check('stable gameId', GAME_ID === 'demo-instant-spy', GAME_ID);
check('has an owner', typeof OWNER_UID === 'string' && OWNER_UID.length > 0);
check('2–3 stages', stages.length >= 2 && stages.length <= 3, String(stages.length));
check('6–9 tasks total', allTasks.length >= 6 && allTasks.length <= 9, String(allTasks.length));
check('exactly one final stage', stages.filter((s: any) => s.isFinal).length === 1);
check('final stage is last', !!stages[stages.length - 1].isFinal);

// ── HARD REQ 1: every task is playable from anywhere on earth ─────────────────
for (const task of allTasks) {
  check(`[${task.id}] locationless === true`, task.locationless === true);
  check(`[${task.id}] triggerMode === 'locationless'`, task.triggerMode === 'locationless');
  check(`[${task.id}] normalizeTriggerMode resolves locationless`,
    normalizeTriggerMode(task) === 'locationless');
}
check("describeGameRequirements === 'anywhere'", describeGameRequirements(game) === 'anywhere');

// ── HARD REQ: no staff-blocking / GPS-blocking task types ─────────────────────
const BANNED_TYPES = new Set(['field', 'geofence', 'smart_station']);
for (const task of allTasks) {
  check(`[${task.id}] type "${task.type}" is allowed`, !BANNED_TYPES.has(task.type));
}
check('no task carries hideLocation', allTasks.every((t: any) => !t.hideLocation));

// ── HARD REQ 3: every photo task auto-approves (no human review queue) ─────────
for (const task of allTasks.filter((t: any) => t.type === 'photo')) {
  check(`[${task.id}] photo autoApprove === true`, task.smart?.autoApprove === true);
  check(`[${task.id}] photo is NOT review-gated`, task.smart?.photoReviewRequired !== true);
  check(`[${task.id}] photo has no secret code`, !task.smart?.hasCode && !task.smart?.secretCode);
}
check('at least one auto-approved photo task exists',
  allTasks.some((t: any) => t.type === 'photo' && t.smart?.autoApprove === true));

// ── HARD REQ 2: instant-play eligible, and NOT consent-gated ──────────────────
check('game.allowInstantPlay === true', game.allowInstantPlay === true);
check('publicGame flag mirrors allowInstantPlay', game.allowInstantPlay === true);
check('NOT requiresGuardianConsent', !game.requiresGuardianConsent);
check('game.visibility public', game.visibility === 'public');

// ── HARD REQ 4 / winnability: no stage can dead-end ───────────────────────────
for (const stage of stages) {
  const problem = requiredTaskCountProblem(stage, stage.id);
  check(`[${stage.id}] winnable (requiredTaskCount ok)`, problem === null, problem ?? '');
  check(`[${stage.id}] has at least one task`, Array.isArray(stage.tasks) && stage.tasks.length > 0);
}

// ── Answer keys / verification config present where the type needs it ─────────
for (const task of allTasks) {
  switch (task.type) {
    case 'quiz':
      check(`[${task.id}] quiz has an answer key`,
        Array.isArray(task.answers) && task.answers.length > 0);
      break;
    case 'numeric':
      check(`[${task.id}] numeric has numericAnswer`, typeof task.numericAnswer === 'number');
      break;
    case 'sequence':
      check(`[${task.id}] sequence has steps`, Array.isArray(task.steps) && task.steps.length >= 2);
      break;
    case 'survey':
      check(`[${task.id}] survey has surveyChoices`,
        Array.isArray(task.surveyChoices) && task.surveyChoices.length >= 2);
      break;
    default:
      break;
  }
}

// ── Winnability: an instructed literal token must be an ACCEPTED answer, in BOTH
//    languages the prompt presents. Closes the "protocol"/פרוטוקול trap — a
//    sequence step (single `answer`) or a typed-answer quiz whose prompt tells the
//    player to type a specific word, but whose accepted value(s) omit that word for
//    one of the two languages, is permanently unwinnable for players of that
//    language. This assertion FAILS on the original spy-defuse step 2
//    (prompt "type the code word: protocol" vs answer 'פרוטוקול').
const TYPE_INSTRUCTION = /type|הקליד/i; // "type the code word" / "הקלידו"
// A prompt presents its two languages separated by " / " (and/or a blank line).
function languageSegments(text: string): string[] {
  return text.split(/\s*\/\s*|\n+/).filter((s: string) => s.trim().length > 0);
}
// The specific literal a segment instructs the player to type: the token after the
// segment's final colon (e.g. "…code word: protocol" → "protocol"). null when the
// segment names no trailing literal (e.g. "…(type your answer)").
function trailingInstructedToken(segment: string): string | null {
  const idx = segment.lastIndexOf(':');
  if (idx === -1) return null;
  const tok = segment.slice(idx + 1).trim();
  return tok.length > 0 ? tok : null;
}
function acceptsToken(accepted: string[], token: string): boolean {
  const norm = token.trim().toLowerCase(); // submitSequenceStep matches trimmed + case-insensitive
  return accepted.some((a) => String(a).trim().toLowerCase() === norm);
}
function assertInstructedTokensAccepted(id: string, prompt: string, accepted: string[]): void {
  for (const seg of languageSegments(prompt)) {
    if (!TYPE_INSTRUCTION.test(seg)) continue;
    const token = trailingInstructedToken(seg);
    if (!token) continue;
    check(`[${id}] instructed token "${token}" is an accepted answer`,
      acceptsToken(accepted, token), `accepted=${JSON.stringify(accepted)}`);
  }
}
for (const task of allTasks) {
  if (task.type === 'sequence') {
    for (const step of task.steps ?? []) {
      if (typeof step.answer === 'string' && step.answer.trim()) {
        assertInstructedTokensAccepted(step.id ?? task.id, step.prompt ?? '', [step.answer]);
      }
    }
  }
  if (task.type === 'quiz' && !task.choices && Array.isArray(task.answers)) {
    assertInstructedTokensAccepted(task.id, task.description ?? '', task.answers);
  }
}

// ── Showcase depth: a visible-but-optional paid hint on the harder tasks ──────
const hintedTasks = allTasks.filter((t: any) => typeof t.hint === 'string' && t.hint.trim());
check('at least one task offers a paid hint', hintedTasks.length >= 1);
for (const task of hintedTasks) {
  check(`[${task.id}] hint has a positive penalty`,
    typeof task.hintPenalty === 'number' && task.hintPenalty > 0);
}
check('a sequence task is present (multi-step-at-one-stop)',
  allTasks.some((t: any) => t.type === 'sequence'));
check('a survey task is present (opinion, no wrong answer)',
  allTasks.some((t: any) => t.type === 'survey'));
check('a self_report task is present',
  allTasks.some((t: any) => t.type === 'self_report'));
check('a typed-answer quiz is present (no choices)',
  allTasks.some((t: any) => t.type === 'quiz' && !t.choices));
check('a multiple-choice quiz is present',
  allTasks.some((t: any) => t.type === 'quiz' && Array.isArray(t.choices) && t.choices.length > 0));

// ── Bilingual: Hebrew default + polished English, per the data model ──────────
// Game/Task carry single-language content (dir="auto"); the bilingual channels
// are `instructions` (body EN + bodyHe HE) and per-stage `narrative`.
check('title has Hebrew', HEBREW.test(GAME_META.title));
check('description is bilingual (HE + EN)',
  HEBREW.test(GAME_META.description) && LATIN.test(GAME_META.description));
check('instructions has an English body', LATIN.test(INSTRUCTIONS.body ?? ''));
check('instructions has a Hebrew body', HEBREW.test(INSTRUCTIONS.bodyHe ?? ''));
for (const task of allTasks) {
  check(`[${task.id}] description is bilingual (HE + EN)`,
    HEBREW.test(task.description ?? '') && LATIN.test(task.description ?? ''));
}
// A stage with a bilingual narrative beat exists (story wrapper in both langs).
const bilingualNarrative = stages.some((s: any) =>
  (LATIN.test(s.narrative?.intro?.body ?? '') && HEBREW.test(s.narrative?.intro?.bodyHe ?? '')));
check('at least one stage has a bilingual narrative beat', bilingualNarrative);

// ── Every task description is dash-free (product UI-copy standard) ─────────────
const BANNED_DASH = /[-‐‑‒–—―]/;
for (const task of allTasks) {
  const text = `${task.title}\n${task.description ?? ''}`;
  check(`[${task.id}] title+description dash-free`, !BANNED_DASH.test(text));
}

// ── publicTaskLocation omits every task (all locationless ⇒ no map leak) ───────
for (const task of allTasks) {
  check(`[${task.id}] publicTaskLocation omitted (locationless)`,
    publicTaskLocation(task) === undefined);
}

console.log(`\n${failures === 0 ? 'ALL FLAGSHIP DEMO TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

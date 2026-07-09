// Security test for sanitizeTaskForParticipant — the single boundary that strips
// server-secret answer keys before a task reaches a player's phone. A regression
// here would leak secret station codes, quiz answers, numeric targets, sequence
// answers, hint text, or admin notes to the client (where they're trivially read
// from the network tab). e2e covers the happy path; this asserts NO secret field
// survives, across every task type. No emulator.
//   npx tsx scripts/test-sanitize-task.ts
import { sanitizeTaskForParticipant } from '../functions/src/runs/sanitizeTask';
import type { Task } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Deep-scan a sanitized payload for a forbidden substring anywhere in it
// (catches a secret leaking under any nested key, not just the ones we name).
function leaks(obj: unknown, secret: string): boolean {
  return JSON.stringify(obj).includes(secret);
}

const base: Task = {
  id: 'task-1',
  title: 'Find the fountain',
  type: 'field',
  coordinates: { lat: 31.79, lng: 35.16 },
  difficulty: 5,
  estimatedMinutes: 10,
  pointValue: 100,
  maxConcurrentTeams: 3,
};

// ── 1. Quiz answers are stripped, choices are kept ────────────────────────────
{
  // A typed-answer quiz (no choices): the answer is the only secret and must not
  // appear anywhere. (For multiple-choice the answer is one of the visible
  // choices by design, so we use a free-text quiz to prove the key is stripped.)
  const quiz: Task = { ...base, type: 'quiz', answers: ['TYPEDSECRETANSWER'] };
  const out = sanitizeTaskForParticipant(quiz) as Record<string, unknown>;
  check('quiz: answer key removed', !('answers' in out) && !leaks(out, 'TYPEDSECRETANSWER'));

  // Multiple-choice: choices are kept (UI needs them) even though the answer is
  // among them — but the `answers` key itself is still stripped.
  const mc: Task = { ...base, type: 'quiz', choices: ['Red', 'Blue', 'Green'], answers: ['Blue'] };
  const mcOut = sanitizeTaskForParticipant(mc) as Record<string, unknown>;
  check('quiz: choices preserved (UI needs them)', leaks(mcOut, 'Red') && leaks(mcOut, 'Green'));
  check('quiz: multiple-choice answers key still stripped', !('answers' in mcOut));
}

// ── 2. Numeric target is stripped, tolerance is kept ──────────────────────────
{
  const numeric: Task = { ...base, type: 'numeric', numericAnswer: 42, numericTolerance: 2 };
  const out = sanitizeTaskForParticipant(numeric) as Record<string, unknown>;
  check('numeric: numericAnswer removed', !('numericAnswer' in out) && !leaks({ a: out, sentinel: 0 }, '42'));
  check('numeric: tolerance preserved', out.numericTolerance === 2);
}

// ── 3. Sequence step ANSWERS stripped, prompts + ids kept ─────────────────────
{
  const seq: Task = {
    ...base,
    type: 'sequence',
    steps: [
      { id: 's1', prompt: 'What colour is the door?', answer: 'SECRETRED' },
      { id: 's2', prompt: 'How many windows?', answer: 'SECRETSEVEN' },
    ],
  };
  const out = sanitizeTaskForParticipant(seq) as Record<string, unknown>;
  check('sequence: no step answer leaks', !leaks(out, 'SECRETRED') && !leaks(out, 'SECRETSEVEN'));
  check('sequence: prompts preserved', leaks(out, 'What colour') && leaks(out, 'How many windows'));
  const steps = out.steps as Array<Record<string, unknown>>;
  check('sequence: step ids preserved', steps[0].id === 's1' && steps[1].id === 's2');
  check('sequence: step objects carry ONLY id + prompt',
    steps.every((s) => Object.keys(s).sort().join(',') === 'id,prompt'));
}

// ── 4. Hint text never sent — only hasHint + penalty ──────────────────────────
{
  const withHint: Task = { ...base, hint: 'Look behind the blue door SECRETHINT', hintPenalty: 30 };
  const out = sanitizeTaskForParticipant(withHint) as Record<string, unknown>;
  check('hint: text never leaks', !leaks(out, 'SECRETHINT') && !('hint' in out));
  check('hint: hasHint flag set true', out.hasHint === true);
  check('hint: penalty exposed', out.hintPenalty === 30);

  const noHint = sanitizeTaskForParticipant(base) as Record<string, unknown>;
  check('hint: hasHint false when no hint', noHint.hasHint === false);
  check('hint: empty/whitespace hint → hasHint false',
    (sanitizeTaskForParticipant({ ...base, hint: '   ' }) as Record<string, unknown>).hasHint === false);
  check('hint: default penalty is 25 when unset', noHint.hintPenalty === 25);
}

// ── 5. Smart station: secretCode + adminNotes stripped, hasCode kept ──────────
{
  const smart: Task = {
    ...base,
    type: 'smart_station',
    smart: {
      enabled: true,
      verificationType: 'code_verification',
      secretCode: 'FOX42SECRET',
      adminNotes: 'CONFIDENTIAL operator note',
      hasCode: true,
      codeInputLabel: 'Enter the code',
      geofenceRadiusMeters: 40,
      attemptLimit: 3,
      autoApprove: false,
      // owner-only flags that must NOT round-trip to the client:
      canSkip: true,
      photoReviewRequired: true,
    },
  };
  const out = sanitizeTaskForParticipant(smart) as Record<string, unknown>;
  const outSmart = out.smart as Record<string, unknown>;
  check('smart: secretCode never leaks', !leaks(out, 'FOX42SECRET') && !('secretCode' in outSmart));
  check('smart: adminNotes never leaks', !leaks(out, 'CONFIDENTIAL') && !('adminNotes' in outSmart));
  check('smart: hasCode preserved (UI renders a code input)', outSmart.hasCode === true);
  check('smart: codeInputLabel preserved', outSmart.codeInputLabel === 'Enter the code');
  check('smart: geofence radius preserved', outSmart.geofenceRadiusMeters === 40);
  check('smart: attemptLimit preserved', outSmart.attemptLimit === 3);
  // The sanitizer uses an explicit ALLOW-LIST, so any owner-only smart flag not
  // on the list (canSkip / photoReviewRequired / …) must be absent. This is the
  // property that keeps NEW secret fields safe-by-default.
  check('smart: owner-only flag canSkip stripped (allow-list default-deny)', !('canSkip' in outSmart));
  check('smart: owner-only flag photoReviewRequired stripped', !('photoReviewRequired' in outSmart));
}

// ── 6. A task with no smart config → smart is undefined (no crash) ────────────
{
  const out = sanitizeTaskForParticipant(base) as Record<string, unknown>;
  check('no smart config → smart undefined', out.smart === undefined);
  check('plain task keeps its title/points', out.title === 'Find the fountain' && out.pointValue === 100);
}

// ── 7. Belt-and-braces: a maximal task leaks none of its secrets at once ───────
{
  const everything: Task = {
    ...base,
    type: 'quiz',
    answers: ['LEAK_ANSWER'],
    numericAnswer: 13131313,
    hint: 'LEAK_HINT',
    steps: [{ id: 'x', prompt: 'p', answer: 'LEAK_STEP' }],
    smart: { enabled: true, verificationType: 'code_verification', secretCode: 'LEAK_CODE', adminNotes: 'LEAK_NOTE' },
  };
  const out = sanitizeTaskForParticipant(everything);
  const allSecrets = ['LEAK_ANSWER', '13131313', 'LEAK_HINT', 'LEAK_STEP', 'LEAK_CODE', 'LEAK_NOTE'];
  const leaked = allSecrets.filter((s) => leaks(out, s));
  check('maximal task: ZERO secrets leak', leaked.length === 0, `leaked=[${leaked.join(', ')}]`);
}

console.log(`\n${failures === 0 ? 'ALL SANITIZE-TASK TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

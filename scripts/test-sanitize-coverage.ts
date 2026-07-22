// Sanitizer TYPE-DRIFT guard — the forward-looking complement to test-sanitize-task.ts.
//
// test-sanitize-task.ts proves the CURRENTLY-KNOWN secret keys (answers, numericAnswer,
// hint, steps[].answer, smart.secretCode) are stripped. But the top-level sanitizer
// passes unknown fields straight through (`...rest`), so the dangerous future bug is:
// someone adds a NEW secret field to the `Task` or `SmartStationConfig` type and the
// sanitizer silently echoes it to participants. typecheck won't catch it — the field is
// a valid string. This test reads the type definitions themselves and fails the moment a
// secret-looking field appears that the sanitizer does not strip.
//
// "Secret-looking" = the field name contains answer / secret / solution / password / pin /
// adminNotes / privateKey — the naming our codebase uses for server-only data. A new field
// matching that pattern MUST NOT survive sanitization; the author either renames it (if it
// isn't actually secret) or adds it to the sanitizer's strip set (if it is).
//
// No emulator — imports the pure sanitizer + reads the shared types source.
//   npx tsx scripts/test-sanitize-coverage.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sanitizeTaskForParticipant } from '../functions/src/runs/sanitizeTask';
import type { Task } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// A field name that, by our naming conventions, denotes server-only data.
const SECRET_NAME = /(answer|secret|solution|password|\bpin\b|adminnotes|privatekey)/i;
// Fields whose NAME matches the pattern but which are deliberately participant-safe
// (they hold UI labels / booleans, not the secret itself).
// `wrongAnswerPenalty` (change: wrong-answer-cost) matches /answer/ but holds a
// strictness LEVEL ('off'|'gentle'|'standard'|'strict'), never an answer key. It
// must reach the participant: the whole deterrent depends on the player being told
// what a wrong guess costs BEFORE they guess, so stripping it would break the
// feature rather than protect anything.
const SAFE_DESPITE_NAME = new Set([
  'codeInputLabel', 'hasCode', 'numericTolerance', 'wrongAnswerPenalty',
]);

// Extract the field names declared inside `export interface <Name> { … }`.
function interfaceFields(src: string, name: string): string[] {
  const start = src.indexOf(`export interface ${name}`);
  if (start === -1) throw new Error(`interface ${name} not found`);
  const open = src.indexOf('{', start);
  // Walk to the matching closing brace (interfaces here have no nested braces in
  // field positions, but count to be safe).
  let depth = 0, i = open, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(open + 1, end);
  const fields: string[] = [];
  // Match `name?:` / `name:` at the start of a (trimmed) line, skipping comments.
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
    const m = /^(\w+)\??\s*:/.exec(line);
    if (m) fields.push(m[1]);
  }
  return fields;
}

const typesSrc = readFileSync(
  fileURLToPath(new URL('../packages/shared/src/types/index.ts', import.meta.url)), 'utf8');
const taskFields = interfaceFields(typesSrc, 'Task');
const smartFields = interfaceFields(typesSrc, 'SmartStationConfig');
const stepFields = interfaceFields(typesSrc, 'TaskStep');

check('parsed Task fields', taskFields.length > 10, `count=${taskFields.length}`);
check('parsed SmartStationConfig fields', smartFields.length > 10, `count=${smartFields.length}`);

// ── Build a Task with a unique sentinel in EVERY field, so any leak is traceable
//    to the exact field that leaked. Strings get a sentinel; the few non-string
//    fields (numericAnswer is the only secret-named number) get a sentinel number. ──
const SENTINEL = 'LEAKSENTINEL';
const sentinelFor = (field: string): unknown =>
  field === 'numericAnswer' ? 999777 : `${SENTINEL}_${field}`;

function leaks(obj: unknown, needle: string): boolean {
  return JSON.stringify(obj).includes(needle);
}

// ── (1) Top-level secret-named Task fields must be stripped ───────────────────
{
  // Start from a minimal valid task, then stamp a sentinel into each secret field.
  const task = {
    id: 't1', title: 'x', type: 'field', coordinates: { lat: 0, lng: 0 },
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 3,
  } as Record<string, unknown>;

  const secretTaskFields = taskFields.filter((f) => SECRET_NAME.test(f) && !SAFE_DESPITE_NAME.has(f));
  check('Task has secret-named fields to guard', secretTaskFields.length > 0,
    secretTaskFields.join(', '));

  for (const f of secretTaskFields) {
    task[f] = f === 'steps' ? undefined : sentinelFor(f);
  }
  const out = sanitizeTaskForParticipant(task as unknown as Task);
  for (const f of secretTaskFields) {
    if (f === 'steps') continue; // steps handled in (3)
    const needle = f === 'numericAnswer' ? '999777' : `${SENTINEL}_${f}`;
    check(`Task.${f} is stripped from participant payload`, !leaks(out, needle),
      leaks(out, needle) ? 'SECRET LEAKED — add this field to sanitizeTaskForParticipant' : '');
  }
}

// ── (2) Secret-named smart fields must be stripped from the smart allow-list ──
{
  const smart: Record<string, unknown> = { enabled: true, verificationType: 'code_verification' };
  for (const f of smartFields) {
    if (f === 'enabled' || f === 'verificationType') continue;
    if (f === 'stationCoords') { smart[f] = { lat: 1, lng: 1 }; continue; }
    smart[f] = `${SENTINEL}_${f}`;
  }
  const task = {
    id: 't1', title: 'x', type: 'smart_station', coordinates: { lat: 0, lng: 0 },
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 3,
    smart,
  } as unknown as Task;
  const out = sanitizeTaskForParticipant(task);

  const secretSmartFields = smartFields.filter((f) => SECRET_NAME.test(f) && !SAFE_DESPITE_NAME.has(f));
  check('SmartStationConfig has secret-named fields to guard', secretSmartFields.length > 0,
    secretSmartFields.join(', '));
  for (const f of secretSmartFields) {
    check(`smart.${f} is stripped from participant payload`, !leaks(out, `${SENTINEL}_${f}`),
      leaks(out, `${SENTINEL}_${f}`) ? 'SECRET LEAKED — remove it from the smart allow-list in sanitizeTask' : '');
  }
}

// ── (3) Sequence step answers stripped, prompts kept ──────────────────────────
{
  check('TaskStep declares an answer field (the secret)', stepFields.includes('answer'));
  const task = {
    id: 't1', title: 'x', type: 'sequence', coordinates: { lat: 0, lng: 0 },
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 3,
    steps: [{ id: 's1', prompt: 'KEEPPROMPT', answer: `${SENTINEL}_stepanswer` }],
  } as unknown as Task;
  const out = sanitizeTaskForParticipant(task);
  check('steps[].answer is stripped', !leaks(out, `${SENTINEL}_stepanswer`));
  check('steps[].prompt is preserved (UI needs it)', leaks(out, 'KEEPPROMPT'));
}

// ── (4) Positive control: a non-secret field still passes through ─────────────
{
  const task = {
    id: 't1', title: 'KEEPTITLE', type: 'quiz', coordinates: { lat: 0, lng: 0 },
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 3,
    choices: ['KEEPCHOICE'],
  } as unknown as Task;
  const out = sanitizeTaskForParticipant(task);
  check('non-secret field (title) passes through', leaks(out, 'KEEPTITLE'));
  check('quiz choices pass through (UI needs them)', leaks(out, 'KEEPCHOICE'));
}

console.log(`\n${failures === 0 ? 'ALL SANITIZER-COVERAGE TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

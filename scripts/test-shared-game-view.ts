// Pure-logic test for the share-link game projection (change: game-share-link).
//
// Two properties, and the second is the one that matters:
//   1. the view carries everything a reviewer needs (stages, missions, map points);
//   2. it carries NO server secret unless the link opted in — proved by a deep
//      sweep for every secret name AND for the secret VALUES, so a rename of a
//      field cannot quietly re-open the leak.
// Plus the allowlist guard: a NEW field on `Task` must be considered explicitly.
// A copy-out projection fails safe (missing field), so the guard is a REMINDER,
// not the mechanism — but an unconsidered field still fails this suite loudly.
//   npx tsx scripts/test-shared-game-view.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  sanitizeGameForShare, sanitizeTaskForShare, SECRET_SHARE_FIELD_NAMES,
} from '../packages/shared/src/sharedGameView';
import type { Game, Task, Stage } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const SECRET_VALUES = [
  'THE-QUIZ-ANSWER', 'THE-HINT-TEXT', 'THE-STATION-CODE', 'THE-STEP-ANSWER',
  'https://hooks.slack.com/services/SECRET', 'admin-only-note',
];

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Find the fountain',
  description: 'Stand by the fountain and answer.',
  type: 'quiz',
  coordinates: { lat: 31.77, lng: 35.21 },
  difficulty: 4,
  estimatedMinutes: 12,
  pointValue: 100,
  maxConcurrentTeams: 3,
  choices: ['1948', '1967'],
  answers: ['THE-QUIZ-ANSWER'],
  numericAnswer: 42,
  hint: 'THE-HINT-TEXT',
  hintPenalty: 25,
  orderItems: ['first', 'second'],
  hideLocation: true,
  locationClue: 'Where water sings',
  media: [{ id: 'm1', kind: 'image', url: 'https://api.rush-point.com/media/x.jpg', caption: 'hi' }],
  tags: ['jerusalem'],
  steps: [{ id: 's1', prompt: 'Count the arches', answer: 'THE-STEP-ANSWER' }],
  smart: { enabled: true, verificationType: 'code_verification', secretCode: 'THE-STATION-CODE', adminNotes: 'admin-only-note' },
  ...over,
});

const stage = (over: Partial<Stage> = {}): Stage => ({
  id: 'st1', order: 0, title: 'Stage one', tasks: [task()],
  narrative: { intro: { title: 'Chapter 1', body: 'It begins' } },
  requiredTaskCount: 1,
  ...over,
});

const game = (over: Partial<Game> = {}): Game => ({
  id: 'g1',
  ownerUid: 'owner-secret-uid',
  title: 'Old City Treasure Hunt',
  description: 'A walk through history',
  mode: 'team',
  stages: [stage()],
  scoringPreset: 'smart_weighted',
  registrationFields: [],
  visibility: 'private',
  tags: ['family'],
  playCount: 3,
  integrationWebhookUrl: 'https://hooks.slack.com/services/SECRET',
  safeZone: { center: { lat: 31.77, lng: 35.21 }, radiusMeters: 800 },
  instructions: { title: 'How to play', body: 'Walk, solve, win' },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  ...over,
});

function walk(node: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      visit(k, v);
      walk(v, visit);
    }
  }
}

function secretsIn(view: unknown): { keys: string[]; values: string[] } {
  const keys: string[] = [];
  const values: string[] = [];
  walk(view, (k, v) => {
    if ((SECRET_SHARE_FIELD_NAMES as readonly string[]).includes(k)) keys.push(k);
    if (typeof v === 'string' && SECRET_VALUES.includes(v)) values.push(v);
  });
  return { keys, values };
}

// ── The whole point: no secrets by default ───────────────────────────────────
const sealed = sanitizeGameForShare(game());
const leak = secretsIn(sealed);
check('no server-secret FIELD NAME appears anywhere in the sealed view', leak.keys.length === 0, leak.keys.join(','));
check('no server-secret VALUE appears anywhere in the sealed view', leak.values.length === 0, leak.values.join(','));
check('the owner uid is not disclosed', !JSON.stringify(sealed).includes('owner-secret-uid'));
check('answersRevealed is false on a sealed view', sealed.answersRevealed === false);

// ── ...but everything a reviewer needs IS there ──────────────────────────────
const st = sealed.stages[0];
const tk = st.tasks[0];
check('the game title survives', sealed.title === 'Old City Treasure Hunt');
check('the description survives', sealed.description === 'A walk through history');
check('stage + task counts are computed', sealed.stageCount === 1 && sealed.taskCount === 1);
check('the stage title survives', st.title === 'Stage one');
check('the stage narrative survives', st.narrative?.intro?.title === 'Chapter 1');
check('requiredTaskCount survives', st.requiredTaskCount === 1);
check('the mission title survives', tk.title === 'Find the fountain');
check('the mission description survives', !!tk.description);
check('the mission type survives', tk.type === 'quiz');
check('the authored map point survives (the builder view needs a map)',
  tk.coordinates?.lat === 31.77 && tk.coordinates?.lng === 35.21);
check('a HIDDEN mission still carries its point for the author-side view', tk.hideLocation === true && !!tk.coordinates);
check('the location clue survives', tk.locationClue === 'Where water sings');
check('quiz CHOICES survive (they are not an answer key)', tk.choices?.length === 2);
check('the hint EXISTENCE is reported without the text', tk.hasHint === true && tk.hint === undefined);
check('the hint COST survives', tk.hintPenalty === 25);
check('sequence step prompts survive', tk.steps?.[0].prompt === 'Count the arches');
check('sequence step ANSWERS do not', tk.steps?.[0].answer === undefined);
check('media survives', tk.media?.[0].url.endsWith('x.jpg'));
check('the safe zone survives', sealed.safeZone?.radiusMeters === 800);
check('the instructions survive', sealed.instructions?.title === 'How to play');
check('tags survive', sealed.tags[0] === 'family');

// ── revealAnswers: the deliberate, per-link opt-in ───────────────────────────
const open = sanitizeGameForShare(game(), true);
const openTask = open.stages[0].tasks[0];
check('revealed view says so', open.answersRevealed === true);
check('revealed view carries the answer key', openTask.answers?.[0] === 'THE-QUIZ-ANSWER');
check('revealed view carries the numeric answer', openTask.numericAnswer === 42);
check('revealed view carries the hint text', openTask.hint === 'THE-HINT-TEXT');
check('revealed view carries the station code', openTask.secretCode === 'THE-STATION-CODE');
check('revealed view carries the step answer', openTask.steps?.[0].answer === 'THE-STEP-ANSWER');
check('revealed view carries the authored order', openTask.orderItems?.[0] === 'first');
// Even a revealed link never ships the owner's private integration secret or uid:
// those are not answer keys, they are account secrets.
check('a revealed view still hides the webhook secret',
  !JSON.stringify(open).includes('hooks.slack.com'));
check('a revealed view still hides the owner uid', !JSON.stringify(open).includes('owner-secret-uid'));
check('a revealed view still hides the admin notes', !JSON.stringify(open).includes('admin-only-note'));

// ── Totality: junk in, no throw ──────────────────────────────────────────────
function survives(fn: () => unknown): boolean {
  try { fn(); return true; } catch { return false; }
}
check('a game with no stages array does not throw',
  survives(() => sanitizeGameForShare({ ...game(), stages: undefined as unknown as Stage[] })));
check('a stage with no tasks array does not throw',
  survives(() => sanitizeGameForShare(game({ stages: [{ id: 's', order: 0, title: 't' } as Stage] }))));
check('a task with no coordinates does not throw and omits the point',
  sanitizeTaskForShare(task({ coordinates: undefined as unknown as Task['coordinates'] })).coordinates === undefined);
check('a task with a non-numeric coordinate omits the point',
  sanitizeTaskForShare(task({ coordinates: { lat: 'x', lng: 3 } as unknown as Task['coordinates'] })).coordinates === undefined);
check('a blank hint does not report hasHint', sanitizeTaskForShare(task({ hint: '   ' })).hasHint === false);
check('media entries without a url are dropped',
  sanitizeTaskForShare(task({ media: [{ id: 'm' } as never] })).media === undefined);
check('an explicitly cleared safe zone is omitted, not sent as null',
  sanitizeGameForShare(game({ safeZone: null })).safeZone === undefined);

// ── Serializability: the view crosses a callable boundary ────────────────────
// `undefined` is fine over the wire; a function or a cycle is not. This asserts
// the projection is a plain data value.
check('the view round-trips through JSON unchanged',
  JSON.stringify(JSON.parse(JSON.stringify(sealed))) === JSON.stringify(sealed));

// ── The allowlist guard: a NEW Task field must be considered ─────────────────
// Read the Task interface out of the type source and require every field to be
// either projected by name, or listed here as deliberately withheld. This is the
// same posture as ALLOWED_TASK_KEYS in scripts/e2e-verify.mjs.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const typesSrc = readFileSync(path.join(HERE, '..', 'packages', 'shared', 'src', 'types', 'index.ts'), 'utf8');
const viewSrc = readFileSync(path.join(HERE, '..', 'packages', 'shared', 'src', 'sharedGameView.ts'), 'utf8');
const taskBlock = typesSrc.slice(typesSrc.indexOf('export interface Task {'));
const taskBody = taskBlock.slice(0, taskBlock.indexOf('\n}'));
const taskFields = [...taskBody.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
// Only the BODY of sanitizeTaskForShare counts as "projected" — the interface
// declarations above it name the same fields, so searching the whole file would
// let a declared-but-never-copied field pass.
const projectSrc = viewSrc.slice(
  viewSrc.indexOf('export function sanitizeTaskForShare'),
  viewSrc.indexOf('export function sanitizeStageForShare'),
);

/** Task fields the share view deliberately does NOT project, each with a reason. */
const WITHHELD_TASK_FIELDS: Record<string, string> = {
  status: 'a live per-run operator override, not part of the authored template',
  currentTeamCount: 'a runtime counter maintained per run, meaningless on a template',
  maxDurationMinutes: 'staff-console warning threshold; no meaning outside a live run',
  smart: 'carries secretCode + adminNotes — the code is projected on its own under revealAnswers',
  answers: 'answer key — projected only under revealAnswers',
  numericAnswer: 'answer key — projected only under revealAnswers',
  orderItems: 'the authored ORDER is the answer key — projected only under revealAnswers',
  hint: 'paid-hint text — projected only under revealAnswers (hasHint reports existence)',
  steps: 'projected, but prompt-only: the step answer is an answer key',
  hintAutoRevealMinutes: 'a live-run hint-escalation threshold; nothing to review on a template',
  hintAutoRevealAttempts: 'a live-run hint-escalation threshold; nothing to review on a template',
};

const missing = taskFields.filter((f) => {
  if (f in WITHHELD_TASK_FIELDS) return false;
  return !new RegExp(`\\bput\\(t, '${f}'|\\bt\\.${f}\\s*=|^\\s{4}${f}:`, 'm').test(projectSrc);
});
check(`every Task field is projected or declared withheld (${taskFields.length} fields examined)`,
  missing.length === 0, `unconsidered: ${missing.join(', ')}`);
check('the withheld list has no stale entries',
  Object.keys(WITHHELD_TASK_FIELDS).every((f) => taskFields.includes(f)),
  Object.keys(WITHHELD_TASK_FIELDS).filter((f) => !taskFields.includes(f)).join(','));
check('the Task interface was actually found (denominator is not zero)', taskFields.length > 20,
  `${taskFields.length} fields`);

console.log(`\n${failures === 0 ? 'ALL SHARED-GAME-VIEW TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

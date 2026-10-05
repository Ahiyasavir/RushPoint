// The deploy test game (scripts/lib/deployTestGame.mjs) must be a game the server accepts AND a
// game that launches once its one pin is placed, or the deploy hands Ahiya a broken game.
// Checked with the same pure validators importGameFile and launchRun use, at go-live strictness.
//   npx tsx scripts/test-deploy-test-game.ts
// @ts-expect-error: plain .mjs module without types
import { buildDeployTestGame, LOCATED_TASK_ID } from './lib/deployTestGame.mjs';
import { parseGameFile } from '../packages/shared/src/gameFile';
import { gameStructureProblems } from '../packages/shared/src/validation';
import { taskCompletabilityError } from '../packages/shared/src/taskCompletability';
import { answerOutcomesProblem } from '../packages/shared/src/answerOutcomes';
import { timeLimitProblem } from '../packages/shared/src/taskTimeLimit';
import { computeGameReadiness } from '../apps/creator-web/src/lib/gameReadiness';
import { quickSetupSteps } from '../apps/creator-web/src/lib/quickSetup';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || detail === undefined ? '' : `  → ${JSON.stringify(detail)}`}`);
  if (!cond) failures++;
}

const file = buildDeployTestGame('2026-10-05');
ok('the title is "deploy" and the date', file.game.title === 'deploy 2026-10-05', file.game.title);
let threw = false;
try { buildDeployTestGame('5.10.2026'); } catch { threw = true; }
ok('a date that is not YYYY-MM-DD is refused', threw);

const { game, errors } = parseGameFile(JSON.parse(JSON.stringify(file)));
ok('the game file parses with no errors (importGameFile layer 1+2)', errors.length === 0 && !!game, errors);
const stages = (game?.stages ?? []) as never[];
const preset = (game as { scoringPreset?: string } | null)?.scoringPreset;

// Launchable once the walking point is placed: place it, then run the go-live checks.
const placed = JSON.parse(JSON.stringify(stages)) as { tasks: { id: string; coordinates: { lat: number; lng: number } }[] }[];
for (const s of placed) for (const t of s.tasks) if (t.id === LOCATED_TASK_ID) t.coordinates = { lat: 32.0853, lng: 34.7818 };
const golive = gameStructureProblems(placed as never, { phase: 'golive' });
ok('go-live structure checks pass once the pin is placed (publish/launch)', golive.length === 0, golive);
const taskProblems: string[] = [];
for (const s of placed) for (const t of s.tasks as never[]) {
  const c = taskCompletabilityError(t); if (c) taskProblems.push(c);
  const o = answerOutcomesProblem(t, preset); if (o) taskProblems.push(`${(t as { id: string }).id}: ${JSON.stringify(o)}`);
  const l = timeLimitProblem(t); if (l) taskProblems.push(l);
}
ok('every mission is completable and its points by answer are valid (launchRun)', taskProblems.length === 0, taskProblems);

const readyBefore = computeGameReadiness({ ...(game as object), stages } as never);
const blockersBefore = readyBefore.map((i: { code?: string }) => i.code);
ok('before the pin: the only blocker is the unplaced walking mission', blockersBefore.length > 0 && blockersBefore.every((c: string | undefined) => c === 'taskNotPlaced'), blockersBefore);
const readyAfter = computeGameReadiness({ ...(game as object), stages: placed } as never);
const blockersAfter = readyAfter.map((i: { code?: string }) => i.code);
ok('after the pin: nothing blocks the launch', blockersAfter.length === 0, blockersAfter);

const steps = quickSetupSteps({ ...(game as object), stages } as never);
ok('Quick Setup asks for the walking point', steps.some((s: { taskId?: string; targetFieldPath?: string }) => s.taskId === LOCATED_TASK_ID && s.targetFieldPath === 'coordinates'), steps.map((s: { id: string }) => s.id));

const all = stages.flatMap((s: { tasks: { description?: string }[] }) => s.tasks);
ok(`every mission says what to do and what should happen (${all.length} missions)`,
  all.length >= 8 && all.every((t: { description?: string }) => /מה עושים:/.test(t.description ?? '') && /מה אמור לקרות:/.test(t.description ?? '')));

console.log(failures === 0 ? '\n✅ deploy test game: ALL PASS' : `\n❌ deploy test game: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

// Runs game.json through the same pure validators importGameFile and launchRun use.
//   npx tsx docs/events/2026-10-22-jerusalem-race/check-game.ts docs/events/2026-10-22-jerusalem-race/game.json
import { readFileSync } from 'node:fs';
import { parseGameFile } from '../../../packages/shared/src/gameFile';
import { gameStructureProblems } from '../../../packages/shared/src/validation';
import { taskCompletabilityError } from '../../../packages/shared/src/taskCompletability';
import { answerOutcomesProblem } from '../../../packages/shared/src/answerOutcomes';
import { timeLimitProblem } from '../../../packages/shared/src/taskTimeLimit';
import { requiredTaskCountProblem } from '../../../packages/shared/src/mutualExclusion';
import { computeGameReadiness } from '../../../apps/creator-web/src/lib/gameReadiness';
const file = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { game, errors } = parseGameFile(file);
console.log('parse errors:', JSON.stringify(errors));
const stages = (game as any).stages;
console.log('golive:', JSON.stringify(gameStructureProblems(stages, { phase: 'golive' } as any)));
for (const s of stages) {
  console.log('stage', s.id, 'tasks', s.tasks.length, 'required', s.requiredTaskCount, 'rtc problem', JSON.stringify(requiredTaskCountProblem(s)));
  for (const t of s.tasks) {
    const p = [taskCompletabilityError(t), answerOutcomesProblem(t, (game as any).scoringPreset), timeLimitProblem(t)].filter(Boolean);
    if (p.length) console.log('  task', t.id, JSON.stringify(p));
  }
}
console.log('readiness:', JSON.stringify(computeGameReadiness({ ...(game as any), stages } as any).map((i: any) => i.code + ':' + (i.taskId ?? ''))));

// Which strength signal routing should use (change: test-mode-hidden-scoring).
//
// Its own module rather than a branch inside `assignNextInActiveStage`, because
// TWO call sites need the identical decision (the assignment path and
// getRecommendedTasks) and a duplicated inline condition is how the recommended
// list drifts from what routing actually hands out.
import type { Game, RunTeam, RunTaskRecord } from '@rushpoint/shared';
import { sealsScoreFromParticipant, accuracySkillRatio } from '@rushpoint/shared';

/**
 * Resolve the skill ratio the adaptive-difficulty term should use for this team.
 *
 * Normal run ⇒ `paceSkillRatio` unchanged (what `computeSkillRatio` measured).
 *
 * Sealed run ⇒ ACCURACY instead. Test mode completes a task on a wrong answer, so
 * elapsed time stops measuring competence there: a participant guessing instantly
 * and wrongly looks fast, therefore strong, and the pace signal would route them
 * the HARDEST remaining questions. Replaced rather than blended — blending only
 * dilutes that inversion instead of removing it.
 *
 * Falls back to the pace ratio whenever accuracy has no evidence (nothing answered
 * yet, or no record carries a real verdict), so a team's first assignment behaves
 * exactly as it does today rather than being driven by an invented verdict.
 *
 * Total: routing runs on every assignment, so a malformed game or team degrades to
 * the pace ratio instead of throwing and stranding the run.
 */
export function resolveRoutingSkillRatio(
  game: Game | null | undefined,
  team: RunTeam | null | undefined,
  paceSkillRatio: number,
): number {
  const fallback = Number.isFinite(paceSkillRatio) ? paceSkillRatio : 0;
  if (!sealsScoreFromParticipant(game)) return fallback;

  const stages = Array.isArray(team?.stages) ? team!.stages : [];
  const records: RunTaskRecord[] = [];
  for (const stage of stages) {
    const tasks = Array.isArray(stage?.tasks) ? stage.tasks : [];
    for (const rec of tasks) records.push(rec);
  }

  const accuracy = accuracySkillRatio(records);
  return accuracy === null ? fallback : accuracy;
}

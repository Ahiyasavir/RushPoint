// What requestNextTask's claim transaction may do with the mission routing picked (see
// claimDecision.test.ts for the race this closes, 2026-10-07). Decided on the team document read
// INSIDE the transaction, never on the earlier routing read:
//   existing — another assignment already put a mission in flight in this stage: hand it back;
//   claim    — the stage is still active and the mission still unassigned: take it;
//   stale    — anything else (the stage closed, the mission was completed or skipped meanwhile, or
//              it is gone): claim nothing, so the caller releases its station reservation and the
//              phone's next poll routes from the real state.
// Pure and total.

type Rec = { taskId?: string; status?: string };
type StageLike = { status?: string; tasks?: Rec[] } | undefined;

export type ClaimDecision =
  | { kind: 'claim'; localIdx: number }
  | { kind: 'existing'; taskId: string }
  | { kind: 'stale' };

export function decideClaim(stages: ReadonlyArray<StageLike>, stageIdx: number, taskId: string): ClaimDecision {
  const stage = Array.isArray(stages) ? stages[stageIdx] : undefined;
  if (!stage || !Array.isArray(stage.tasks)) return { kind: 'stale' };
  if (stage.status !== 'active') return { kind: 'stale' };
  const inFlight = stage.tasks.find((t: Rec) => t && t.status === 'assigned');
  if (inFlight && typeof inFlight.taskId === 'string') return { kind: 'existing', taskId: inFlight.taskId };
  const localIdx = stage.tasks.findIndex((t: Rec) => t && t.taskId === taskId);
  if (localIdx < 0 || stage.tasks[localIdx].status !== 'unassigned') return { kind: 'stale' };
  return { kind: 'claim', localIdx };
}

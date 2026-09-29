// Which mission the phone shows (overnight 2026-09-29, found by playing route-team-to-mission).
//
// The mission assigned in the ACTIVE stage, or else one assigned in another stage: an operator may
// send a team to a mission there (a "visit", `forceAssignTask` with `otherStage` waived), and the
// server ships its content with the active stage's. Looking only in the active stage left the phone
// on "finding the next destination" with no mission, for a team sent somewhere on purpose. Pure, total.

type Rec = { taskId: string; status?: string };
type StageRec = { tasks?: Rec[] | null } | null | undefined;

export function currentAssignedRec<R extends Rec>(
  activeStage: { tasks?: R[] | null } | null | undefined,
  allStages: readonly StageRec[] | null | undefined,
): R | undefined {
  const inActive = (Array.isArray(activeStage?.tasks) ? activeStage!.tasks! : [] as R[]).find((t: R) => t?.status === 'assigned');
  if (inActive) return inActive;
  for (const s of Array.isArray(allStages) ? allStages : []) {
    const recs: Rec[] = Array.isArray(s?.tasks) ? s!.tasks! : [];
    const hit = recs.find((t) => t?.status === 'assigned');
    if (hit) return hit as R;
  }
  return undefined;
}

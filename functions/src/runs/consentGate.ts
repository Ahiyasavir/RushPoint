// Guardian-consent assignment gate (change: consent-gate-routing).
//
// A team is eligible to be ASSIGNED a task — which reserves a real-world station
// slot and writes an `activeTaskId` routing the device toward a map pin — ONLY
// once the host has LAUNCHED it, and `startTeams` launches a team only after the
// run's guardian-consent step is satisfied (`partitionTeamsByConsent`). The
// grading path already refuses an un-launched team (`team.launched !== true` in
// `completeTaskForTeam`); this predicate is its assignment twin, so a held minor's
// device cannot self-assign by calling `requestNextTask` (or any other
// assignment entry point) directly.
//
// TOTAL by design: `launched` arrives from a stored Firestore document and is
// treated as unknown. Anything that is not the literal boolean `true` — missing,
// null, `undefined`, a string, a truthy-but-not-`true` value, a garbage object —
// is NOT eligible. Never throws; safe to call on any input.
export function canReceiveTaskAssignment(team: { launched?: unknown } | null | undefined): boolean {
  return team?.launched === true;
}

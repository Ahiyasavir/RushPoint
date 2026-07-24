// Pure guards for auto-finalizing a hostless solo self-guided run (change:
// fix-solo-selfguided-finalize). Kept transport-free so it runs in the
// no-emulator vitest lane and is the single, testable source of the
// "may this run auto-finalize?" decision that maybeAutoFinalizeSoloRun enforces.
//
// A run built by `startInstantPlay` is `selfGuided: true, participantCount: 1`
// with NO organizer, so nothing ever calls the creator-auth `finalizeRun`. These
// predicates decide when the server may finalize such a run on its own — and,
// just as importantly, when it MUST NOT (any organizer/multi-team run).

type SoloRunShape = {
  selfGuided?: boolean;
  participantCount?: number;
  status?: string;
} | undefined;

// A run is a solo self-guided candidate ONLY when it is explicitly flagged
// `selfGuided` AND carries at most one participant. This is the cheap pre-check
// used on the completion hot path (from values already in scope) so a normal
// organizer/launched run — `selfGuided` falsy, or participantCount > 1 — pays
// zero extra reads and is NEVER a candidate. `participantCount` absent defaults
// to 1 (the instant-play shape); anything > 1 disqualifies.
export function isSoloSelfGuidedRun(run: SoloRunShape): boolean {
  if (!run) return false;
  if (run.selfGuided !== true) return false;
  if ((run.participantCount ?? 1) > 1) return false;
  return true;
}

// The full gate: proceed to finalize ONLY when the run is a solo self-guided
// candidate, is not already finished (idempotency backstop), and its SINGLE team
// has actually reached `status: 'finished'`. A run with any team count other than
// exactly 1, or whose sole team is not finished, is left alone.
export function soloRunReadyToAutoFinalize(
  run: SoloRunShape,
  teamCount: number,
  soleTeamStatus: string | undefined,
): boolean {
  if (!isSoloSelfGuidedRun(run)) return false;
  if (run!.status === 'finished') return false; // already finalized — no double-finalize
  if (teamCount !== 1) return false; // defensive: not the solo shape
  if (soleTeamStatus !== 'finished') return false; // the finish transition hasn't happened
  return true;
}

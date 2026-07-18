// Pure accumulation guard for a team's `bonusPenalty` (adjustTeamScore).
//
// A staff adjustment writes `bonusPenalty := prev - delta`. `Number.isFinite`
// on the INPUT delta alone isn't enough: two large finite deltas can accumulate
// to ±Infinity across calls, and a non-finite bonusPenalty later makes
// parseRunTeam reject the doc — bricking refreshLeaderboard/finalizeRun and
// poisoning run.leaderboard. So validate the POST-transaction result, not just
// the input, and clamp the magnitude so a single adjustment can't push the
// running total past a sane bound.
import * as functions from 'firebase-functions';

export const BONUS_PENALTY_BOUND = 1e9;

// Returns the next bonusPenalty (`prev - delta`), clamped to ±BONUS_PENALTY_BOUND.
// Throws `invalid-argument` if the raw result is non-finite (e.g. an accumulated
// overflow), so a poisoned value is never persisted.
export function nextBonusPenalty(prev: number, delta: number): number {
  const np = prev - delta;
  if (!Number.isFinite(np)) {
    throw new functions.https.HttpsError('invalid-argument', 'resulting score would be non-finite');
  }
  return Math.max(-BONUS_PENALTY_BOUND, Math.min(BONUS_PENALTY_BOUND, np));
}

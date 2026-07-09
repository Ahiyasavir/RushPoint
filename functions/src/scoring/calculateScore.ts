// ─── Penalty helpers ──────────────────────────────────────────────────────────

/**
 * Exponential transit penalty for arriving late at the park gate.
 * 50 * (e^(0.2 * minutesLate) - 1), capped at 500 pts.
 */
export function computeTransitPenalty(actualMinutes: number, targetMinutes: number): number {
  const late = actualMinutes - targetMinutes;
  if (late <= 0) return 0;
  return Math.min(500, Math.round(50 * (Math.exp(0.2 * late) - 1)));
}

/**
 * Exponential sprint penalty for arriving late to the final judge.
 * 10 * (e^(0.05 * secondsLate) - 1), capped at 300 pts.
 */
export function computeSprintPenalty(secondsLate: number): number {
  if (secondsLate <= 0) return 0;
  return Math.min(300, Math.round(10 * (Math.exp(0.05 * secondsLate) - 1)));
}


// ─── Dynamic difficulty-adjusted time bonus ───────────────────────────────────

/** Points awarded per minute a team beats its personal Route Target. */
export const TIME_BONUS_PER_MINUTE = 10;
/** Hard cap so the time bonus can never dominate product/judging score. */
export const TIME_BONUS_CAP = 200;

/**
 * Dynamic Time-Bonus (fairness across uneven route difficulty).
 *
 *   ΔT = T_expected − T_actual   (minutes)
 *   ΔT > 0  → beat the personalised target → +perMin · ΔT  (capped)
 *   ΔT ≤ 0  → delayed → 0 (a mild "cap at zero", never a negative bonus)
 *
 * `expectedMinutes` is the SUM of the team's 6 assigned slots'
 * `expectedDurationMinutes`, so a team given harder tasks gets a larger target
 * and is not penalised for the route they were dealt.
 *
 * Balance note: the bonus is intentionally small and capped (≤200) so that
 * staying the full 20-minute crafting window to maximise product collection
 * (hundreds of points) remains mathematically superior to rushing the judge.
 */
export function computeTimeBonus(
  expectedMinutes: number,
  actualMinutes: number,
  perMinute: number = TIME_BONUS_PER_MINUTE,
  cap: number = TIME_BONUS_CAP,
): number {
  if (!(expectedMinutes > 0) || !(actualMinutes > 0)) return 0;
  const deltaMinutes = expectedMinutes - actualMinutes;
  if (deltaMinutes <= 0) return 0;
  return Math.min(cap, Math.round(deltaMinutes * perMinute));
}


// ─── Z-Score normalization ────────────────────────────────────────────────────

/**
 * Applies a Z-Score bonus/deduction to a team's raw score based on how their
 * completion time compares to all finishers. Faster than average → bonus;
 * slower → deduction. 1σ difference = ±200 pts.
 */
export function applyZScoreBonus(
  rawScore: number,
  teamDurationMinutes: number,
  allDurationMinutes: number[],
): number {
  if (allDurationMinutes.length < 2) return rawScore;
  const mu = allDurationMinutes.reduce((a, b) => a + b, 0) / allDurationMinutes.length;
  const variance =
    allDurationMinutes.reduce((sum, d) => sum + (d - mu) ** 2, 0) / allDurationMinutes.length;
  const sigma = Math.sqrt(variance);
  if (sigma === 0) return rawScore;
  // Negative z means faster than average → positive bonus
  const z = (teamDurationMinutes - mu) / sigma;
  return Math.max(0, rawScore + Math.round(-z * 200));
}


// ─── Slot completion bonus ────────────────────────────────────────────────────

const COMPLETION_BONUS = 500;

/**
 * Adds a flat completion bonus when all 8 slots are terminal (completed or skipped).
 * The live score accumulates per-slot earnedScore during the event; this bonus is
 * applied on top when the team finishes.
 */
export function completionBonus(
  slots: Array<{ status: string }>,
): number {
  const allDone = slots.every((s) => s.status === 'completed' || s.status === 'skipped');
  return allDone ? COMPLETION_BONUS : 0;
}


// ─── Final-standings tie-breaker (Phase 3) ────────────────────────────────────
// When two teams finish with the SAME finalScore, rank by secondary metrics in a
// strict order: (1) fewest cumulative penalties, (2) fastest combined green-task
// time, (3) lowest total transit time between consecutive slots. Pure + testable.

interface TieSlot {
  type?: string;
  status?: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface TieMetrics {
  penalties: number;   // lower is better
  fieldTaskMs: number; // lower is better — combined time across green slots
  transitMs: number;   // lower is better — gaps between consecutive slots
}

/** Parse an ISO string to ms, returning null on anything unparseable. */
function ms(value?: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Derive the tie-break metrics for one team. Robust to missing/garbage
 * timestamps — a slot with incomplete timing simply contributes 0 to that sum.
 */
export function computeTieMetrics(slots: TieSlot[], bonusPenalty: number): TieMetrics {
  let fieldTaskMs = 0;
  for (const s of slots) {
    if (s.type !== 'green') continue;
    const start = ms(s.startedAt);
    const end = ms(s.completedAt);
    if (start != null && end != null && end > start) fieldTaskMs += end - start;
  }

  // Transit = positive gaps between one slot completing and the next one starting.
  let transitMs = 0;
  const ordered = [...slots].sort((a, b) => (a as { index?: number }).index! - (b as { index?: number }).index!);
  for (let i = 0; i + 1 < ordered.length; i++) {
    const prevEnd = ms(ordered[i].completedAt);
    const nextStart = ms(ordered[i + 1].startedAt);
    if (prevEnd != null && nextStart != null && nextStart > prevEnd) transitMs += nextStart - prevEnd;
  }

  return { penalties: Math.max(0, bonusPenalty || 0), fieldTaskMs, transitMs };
}

export interface RankCandidate {
  finalScore: number;
  metrics: TieMetrics;
}

/**
 * Comparator for Array.sort — higher finalScore first; ties broken by penalties,
 * then field-task time, then transit time (all ascending = lower is better).
 */
export function compareForRanking(a: RankCandidate, b: RankCandidate): number {
  if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
  if (a.metrics.penalties !== b.metrics.penalties) return a.metrics.penalties - b.metrics.penalties;
  if (a.metrics.fieldTaskMs !== b.metrics.fieldTaskMs) return a.metrics.fieldTaskMs - b.metrics.fieldTaskMs;
  return a.metrics.transitMs - b.metrics.transitMs;
}

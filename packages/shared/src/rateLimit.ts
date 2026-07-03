// Pure per-key fixed-window rate limiter (change: callable-rate-limiting, Appendix B #19).
//
// A fixed window is trivially pure and deterministic: the clock is injected
// (`nowMs`), so boundaries are unit-testable without a real clock or emulator —
// exactly like the staffThrottle predicates. The server (rateLimitStore.ts)
// persists `WindowState` per (bucket, uid) and calls `rateLimit` inside a
// transaction so concurrent calls can't both slip under the cap.

export interface WindowState {
  /** Calls counted in the current window. */
  count: number;
  /** Epoch ms when the current window began. */
  windowStartMs: number;
}

export interface RateDecision {
  allowed: boolean;
  /** The state to persist after this call (whether allowed or not). */
  nextState: WindowState;
  /** When denied, ms until the window resets; 0 while allowed. */
  retryAfterMs: number;
}

/**
 * Fixed-window limiter. Allows up to `max` calls per `windowMs` for one key's
 * state, denies further calls until the window elapses, and resets once `nowMs`
 * passes `windowStartMs + windowMs`. Pure — `nowMs` is injected.
 */
export function rateLimit(
  state: WindowState | null | undefined,
  max: number,
  windowMs: number,
  nowMs: number,
): RateDecision {
  const inWindow = !!state && nowMs - state.windowStartMs < windowMs;
  const count = inWindow ? state!.count : 0;
  const windowStartMs = inWindow ? state!.windowStartMs : nowMs;

  if (count >= max) {
    return {
      allowed: false,
      nextState: { count, windowStartMs },
      retryAfterMs: windowMs - (nowMs - windowStartMs),
    };
  }
  return {
    allowed: true,
    nextState: { count: count + 1, windowStartMs },
    retryAfterMs: 0,
  };
}

export interface RateBudget {
  max: number;
  windowMs: number;
}

const MIN = 60_000;

// Generous per-callable budgets — normal play never trips these; abuse does.
// Bucket names double as the rate-limit doc key prefix.
export const RATE_LIMITS: Record<string, RateBudget> = {
  // Mutations / answer paths
  submitTaskAnswer: { max: 30, windowMs: MIN }, // per-task attemptLimit still applies on top
  submitSequenceStep: { max: 40, windowMs: MIN },
  verifyStationCode: { max: 30, windowMs: MIN },
  submitStationPhoto: { max: 20, windowMs: MIN },
  completeTask: { max: 60, windowMs: MIN },
  requestTaskHint: { max: 20, windowMs: MIN },
  claimDiscoveryPoi: { max: 30, windowMs: MIN },
  checkOutTask: { max: 60, windowMs: MIN },
  joinRun: { max: 10, windowMs: MIN },
  triggerSOS: { max: 5, windowMs: MIN },
  requestGuardianConsent: { max: 10, windowMs: MIN }, // writes a doc per call — bound token spam
  submitRunFeedback: { max: 3, windowMs: MIN }, // one real response per run; retries have headroom
  getRunFeedbackSummary: { max: 30, windowMs: MIN }, // owner poll of the feedback panel
  // Read / poll endpoints (generous — play-web polls these)
  getMyTeamState: { max: 240, windowMs: MIN }, // ~4/s ceiling; normal poll is ~0.2/s
  requestNextTask: { max: 60, windowMs: MIN },
  getRecommendedTasks: { max: 60, windowMs: MIN },
  getRunDiscoveryPois: { max: 60, windowMs: MIN }, // poll; reads a whole subcollection
  getJoinInfo: { max: 30, windowMs: MIN },
  updateLocation: { max: 120, windowMs: MIN }, // a live ping every few seconds is fine
};

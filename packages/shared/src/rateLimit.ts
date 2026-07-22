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
  // Hidden-location arrival probe (change: play-task-gating). Strictly TIGHTER
  // than completeTask — it evaluates the same proximity predicate, so it must
  // never become a cheaper grid-search oracle than the check-in it mirrors.
  reportArrival: { max: 30, windowMs: MIN },
  claimDiscoveryPoi: { max: 30, windowMs: MIN },
  checkOutTask: { max: 60, windowMs: MIN },
  joinRun: { max: 10, windowMs: MIN },
  triggerSOS: { max: 5, windowMs: MIN },
  sendTeamChatMessage: { max: 10, windowMs: MIN }, // per-sender uid; one spammer can't starve teammates/HQ
  requestGuardianConsent: { max: 10, windowMs: MIN }, // writes a doc per call — bound token spam
  submitRunFeedback: { max: 3, windowMs: MIN }, // one real response per run; retries have headroom
  reactToFeedItem: { max: 60, windowMs: MIN }, // taps on the live photo feed (live-photo-feed)
  // Lower than reactToFeedItem: a report is a moderation-weight action, not a
  // tap — but high enough a participant sweeping a busy feed isn't throttled
  // (change: feed-ugc-safety).
  reportFeedItem: { max: 20, windowMs: MIN },
  getRunFeedbackSummary: { max: 30, windowMs: MIN }, // owner poll of the feedback panel
  // Read / poll endpoints (generous — play-web polls these)
  getMyTeamState: { max: 240, windowMs: MIN }, // ~4/s ceiling; normal poll is ~0.2/s
  requestNextTask: { max: 60, windowMs: MIN },
  getRecommendedTasks: { max: 60, windowMs: MIN },
  getRunDiscoveryPois: { max: 60, windowMs: MIN }, // poll; reads a whole subcollection
  getJoinInfo: { max: 30, windowMs: MIN },
  updateLocation: { max: 120, windowMs: MIN }, // a live ping every few seconds is fine

  // Public, unauthenticated-audience reads. These are the only callables an
  // outsider can reach without joining a run, so they are the cheapest surface
  // to bill someone through — each one fans out to a multi-doc Firestore read.
  // Budgets are per-uid; an anonymous uid is free to mint, so treat these as a
  // brake on casual scripting, not a hard wall (App Check is the real fix).
  searchGallery: { max: 60, windowMs: MIN }, // browsing the gallery is bursty; reads ≤50 docs/call
  searchTaskLibrary: { max: 60, windowMs: MIN }, // same, reads ≤100 docs/call
  getPublicLeaderboard: { max: 60, windowMs: MIN }, // a shared board page polls this

  // Live-ops / creator-console reads and mutations that were enforcing against
  // an UNDEFINED bucket — i.e. silently fail-open (see rateLimitCoverage.test.ts).
  // Values follow the existing split: polls generous, doc-writing actions tight.
  listLiveRuns: { max: 60, windowMs: MIN }, // dashboard poll
  getMyProfile: { max: 60, windowMs: MIN },
  getRunHeatmap: { max: 30, windowMs: MIN }, // aggregates every location ping in a run
  getRunSurveyResults: { max: 30, windowMs: MIN },
  getRunTrackables: { max: 60, windowMs: MIN }, // poll
  getRunZones: { max: 60, windowMs: MIN }, // poll
  startInstantPlay: { max: 10, windowMs: MIN }, // provisions a whole run — keep tight
  createTrackable: { max: 20, windowMs: MIN }, // writes a doc per call
  createZone: { max: 20, windowMs: MIN }, // writes a doc per call
  deleteZone: { max: 20, windowMs: MIN },
  captureZone: { max: 30, windowMs: MIN }, // in-play action, contested by design
  joinTeamAsDevice: { max: 10, windowMs: MIN }, // matches joinRun — same "get onto a team" weight
  transferController: { max: 20, windowMs: MIN },
  claimController: { max: 20, windowMs: MIN },
};

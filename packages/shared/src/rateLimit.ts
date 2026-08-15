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
  // Public-content likes (change: gallery-popularity-ranking). Tighter than the
  // 60/min browse budgets because a like is a WRITE that moves a public ranking,
  // generous enough that a creator liking their way down a gallery page is never
  // throttled. Same residual gap as the reads above: an anonymous uid is free to
  // mint, so this is a brake on casual scripting — App Check is the real fix.
  setPublicLike: { max: 30, windowMs: MIN },

  // Live-ops / creator-console reads and mutations that were enforcing against
  // an UNDEFINED bucket — i.e. silently fail-open (see rateLimitCoverage.test.ts).
  // Values follow the existing split: polls generous, doc-writing actions tight.
  listLiveRuns: { max: 60, windowMs: MIN }, // dashboard poll
  getMyProfile: { max: 60, windowMs: MIN },
  // Time on site flush (change: admin-engagement-and-outreach). The client flushes on a
  // multi-minute cadence and on tab hide, so a legitimate session sends only a handful an
  // hour; 20/min is far above that and still bounds a client stuck in a write loop. Each
  // call is one small increment, and the VALUE is clamped separately
  // (clampEngagementDelta), so the budget bounds cost while the clamp bounds the number.
  recordEngagement: { max: 20, windowMs: MIN },
  // Admin roster read: expensive (2 Firestore reads per creator) and used by one person
  // clicking refresh, so it never needs a generous budget.
  listPlatformUsers: { max: 20, windowMs: MIN },
  // One small doc write per save, driven by a human typing. Generous enough for rapid
  // edits across several creators, tight enough to bound a stuck client.
  setUserNote: { max: 30, windowMs: MIN },
  // Admin-managed game templates (change: admin-manage-game-templates). Same
  // posture as setUserNote/listPlatformUsers: an infrequent, human-driven admin
  // action vs. a generous browse-poll budget for the creator-facing picker.
  setGameTemplateFlag: { max: 30, windowMs: MIN },
  listGameTemplates: { max: 60, windowMs: MIN },
  createGameFromTemplate: { max: 20, windowMs: MIN }, // writes a whole new game per call
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

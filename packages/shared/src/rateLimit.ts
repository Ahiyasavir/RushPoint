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
  // Rehearsal answer reveal (change: test-drive-rehearsal-control). Only ever
  // reachable on a run whose `isTestDrive` is true, so this is not an oracle a
  // real participant can touch — but it IS an answer-key read, so it is capped
  // roughly like the submit path it feeds rather than left open.
  revealTaskAnswer: { max: 30, windowMs: MIN },
  // Hidden-location arrival probe (change: play-task-gating). Strictly TIGHTER
  // than completeTask — it evaluates the same proximity predicate, so it must
  // never become a cheaper grid-search oracle than the check-in it mirrors.
  reportArrival: { max: 30, windowMs: MIN },
  claimDiscoveryPoi: { max: 30, windowMs: MIN },
  checkOutTask: { max: 60, windowMs: MIN },
  joinRun: { max: 10, windowMs: MIN },
  // Marketing site contact form (change: marketing-site). The ONLY write endpoint
  // a caller with no account at all can reach, and it is keyed on the connection
  // rather than a uid because there is no uid.
  //
  // TWO budgets, on purpose, because they defend against different things and a
  // single one cannot be both.
  //
  //   submitContactMessage — charged only for a message that PASSED validation,
  //   i.e. one that is about to be stored and announced. Tight, because that is
  //   the resource worth protecting and a person asking a question sends one,
  //   maybe two if they think the first failed.
  //
  //   submitContactMessageAttempt — charged for every call including refused
  //   ones. Wide, because the failure mode of a tight limit here is a person who
  //   mistypes their own email address three times being locked out of the
  //   contact form for ten minutes, unable to comply and with nowhere else to go.
  //   A rejected payload is never stored and never mailed, so it costs a few
  //   string comparisons; it is worth bounding, but not at that price.
  submitContactMessage: { max: 5, windowMs: 10 * MIN },
  submitContactMessageAttempt: { max: 120, windowMs: 10 * MIN },
  // Share links for an unpublished game (change: game-share-link). `getSharedGame`
  // is the second unauthenticated callable on the platform, keyed on the
  // connection for the same reason the contact form is: there is no uid.
  //
  // Generous, because the honest caller is a person READING a game — they open
  // the link, walk the stages, reload, come back tomorrow — and a limit that
  // interrupts that is a broken link as far as they can tell. The token is 128
  // random bits, so this budget is not what stands between a stranger and the
  // game; it bounds the COST of someone hammering the endpoint, nothing more.
  getSharedGame: { max: 120, windowMs: 10 * MIN },
  // Minting a link is an owner action (keyed by uid) and writes an audit row, so
  // it is bounded rather than free — but a creator legitimately makes one per
  // person they are sending it to.
  createGameShareLink: { max: 30, windowMs: 10 * MIN },
  triggerSOS: { max: 5, windowMs: MIN },
  sendTeamChatMessage: { max: 10, windowMs: MIN }, // per-sender uid; one spammer can't starve teammates/HQ
  // Staff↔admin channel (staff-console-field-ops). Roomier than team chat: this is
  // the operational back-channel during an incident, when a marshal legitimately
  // fires several short lines in a row, and every sender is already an authorized
  // staffer or the owner — not an anonymous participant.
  sendStaffChannelMessage: { max: 20, windowMs: MIN },
  // Staff team-management actions (staff-console-field-ops). Bounded because each
  // writes an audit row, but high enough for a marshal working a queue of teams.
  setTeamHold: { max: 30, windowMs: MIN },
  forceAssignTask: { max: 30, windowMs: MIN },
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
  // Run history + the post-run report (change: post-run-player-report). Neither
  // polls: a human opens the history, picks a run, and reads it. Both are
  // MULTI-DOCUMENT reads (every run the owner has; every team of one run), so the
  // budgets are deliberately below the browse-poll tier — generous for a creator
  // clicking between several runs, tight enough to bound a stuck client re-fetching
  // an entire run's teams in a loop.
  listMyRuns: { max: 30, windowMs: MIN },
  getRunPlayerReport: { max: 30, windowMs: MIN },
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
  listAdminTemplates: { max: 60, windowMs: MIN }, // admin console poll of its own template list
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

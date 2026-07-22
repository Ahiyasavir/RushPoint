// Live photo feed visibility gate — security (hidden-location secrecy).
//
// A completed task's photo + title are broadcast into the RUN-WIDE live photo
// feed (FeedPanel), which every team in the run sees. For a HIDDEN-LOCATION
// task (`task.hideLocation === true`) that is a secrecy leak: teams STILL
// hunting the spot would see both its title AND a photo taken AT the spot — a
// strictly bigger giveaway than the title alone. The wave-D gating
// (getMyTeamState omission, buildRecommendations `locationHidden`, the
// sanitizeTask sealed stub) exists precisely to withhold a hidden task's
// identity + coordinates until a team physically arrives; the feed must not
// reopen that hole (sweep finding wave-f S1).
//
// DECISION — full exclusion, not merely a title scrub. Scrubbing the title
// alone would still broadcast the photograph, and a photo of the secret
// location is the more revealing leak. The only choice that actually preserves
// the guarantee is to keep a hidden-location task out of the feed ENTIRELY.
//
// This is the single source of truth shared by BOTH feed-write sites
// (submitStationPhoto autoApprove + reviewStationSubmission approve) so they
// cannot diverge.
export interface FeedTaskVisibilityInput {
  hideLocation?: boolean;
}

/**
 * Whether a just-completed task may enter the run-wide live photo feed.
 *
 * Fail-closed: `undefined` (the task could not be resolved from the game doc)
 * returns `false`. A task that completed yet is absent from its own game
 * document is a data anomaly, not a normal task, and we cannot confirm it is
 * safe to broadcast — so we suppress it rather than risk leaking a hidden spot.
 * Only the literal boolean `true` marks a task hidden; everything else feeds.
 */
export function shouldFeedTask(task: FeedTaskVisibilityInput | undefined): boolean {
  if (!task) return false;
  return task.hideLocation !== true;
}

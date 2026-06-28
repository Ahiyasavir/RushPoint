// Live emoji reactions (change: live-emoji-reactions). Pure throttle predicate +
// the closed emoji set, shared by the reaction bar on the leaderboard / TV screen.
// The realtime transport (RTDB push/onChildAdded) + floating renderer are the
// deferred UI half; this is the testable core. No Firestore, no DOM.

/** The only emoji a viewer may send — no free text. */
export const REACTION_EMOJI = ['🔥', '👏', '😮', '❤️', '😂', '🚀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

/** True when an emoji value is part of the allowed closed set. */
export function isAllowedReaction(emoji: string): emoji is ReactionEmoji {
  return (REACTION_EMOJI as readonly string[]).includes(emoji);
}

/**
 * Whether a tap should be throttled (dropped). Allowed when there is no prior
 * reaction (`lastAtMs` null) or at least `minGapMs` has elapsed; throttled when a
 * tap arrives within `minGapMs` of the last one.
 */
export function shouldThrottleReaction(
  lastAtMs: number | null | undefined,
  nowMs: number,
  minGapMs: number,
): boolean {
  if (lastAtMs == null) return false;
  return nowMs - lastAtMs < minGapMs;
}

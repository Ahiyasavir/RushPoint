// Live photo feed reactions (change: live-photo-feed). Pure reducer applied by
// the reactToFeedItem callable inside a transaction, and unit-tested without an
// emulator (scripts/test-feed-reactions.ts). The feed's closed emoji set is
// deliberately tiny — reactions are a tap, not a vocabulary.

/** The only emoji a participant may react with on a feed item — no free text. */
export const FEED_EMOJIS = ['👍', '😂', '🔥', '😮'] as const;
export type FeedEmoji = (typeof FEED_EMOJIS)[number];

export interface FeedReactionState {
  /** emoji → count, zero-count keys are dropped. */
  reactions: Record<string, number>;
  /** uid → emoji: the dedup/switch source of truth (one reaction per uid). */
  reactedBy: Record<string, string>;
}

export interface FeedReactionResult extends FeedReactionState {
  /** False when the tap was a repeat of the same emoji (nothing to persist). */
  changed: boolean;
}

/**
 * Apply one uid's reaction tap to a feed item's reaction state.
 * - Throws on an emoji outside FEED_EMOJIS (server validates before writing).
 * - First reaction: increments `reactions[emoji]` and records `reactedBy[uid]`.
 * - Same emoji again: no-op (`changed: false`) — idempotent, never double-counts.
 * - Different emoji: decrements the old count (floored at 0; zero keys deleted)
 *   and increments the new one.
 * Pure — never mutates its input.
 */
export function applyReaction(
  item: FeedReactionState,
  uid: string,
  emoji: string,
): FeedReactionResult {
  if (!(FEED_EMOJIS as readonly string[]).includes(emoji)) {
    throw new Error(`Invalid feed reaction emoji: ${JSON.stringify(emoji)}`);
  }
  const reactions: Record<string, number> = { ...(item.reactions ?? {}) };
  const reactedBy: Record<string, string> = { ...(item.reactedBy ?? {}) };

  const previous = reactedBy[uid];
  if (previous === emoji) {
    return { reactions, reactedBy, changed: false };
  }
  if (previous !== undefined) {
    const next = (reactions[previous] ?? 0) - 1;
    if (next > 0) reactions[previous] = next;
    else delete reactions[previous];
  }
  reactions[emoji] = (reactions[emoji] ?? 0) + 1;
  reactedBy[uid] = emoji;
  return { reactions, reactedBy, changed: true };
}

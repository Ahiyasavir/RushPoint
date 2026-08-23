// Gallery like-button state (change: gallery-popularity-ranking).
//
// The server is already idempotent — setPublicLike states the desired end state,
// so a retry or a double-fire cannot double-count. The CLIENT is where a double
// tap turns into a visibly wrong number, so the optimistic arithmetic lives here
// as pure functions instead of inline in the component, where it could not be
// tested (creator-web has no component test runner).
//
// Invariants held by every function below:
//   • the count never goes negative and is never NaN;
//   • repeating a tap in the SAME direction is a no-op;
//   • the server's answer always wins over the optimistic guess.

export interface LikeView {
  liked: boolean;
  likeCount: number;
}

/** Gallery documents carry these two optionally (older docs have neither). */
export interface LikeableItem {
  id: string;
  likeCount?: number;
}

function safeCount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Initial render state, straight from a gallery search response. `likedIds` is
 * the caller's OWN likes as reported by the server, so another creator's like
 * shows in the count but never as our own state.
 */
export function deriveLikeView(item: LikeableItem, likedIds: string[] | undefined): LikeView {
  return {
    liked: Array.isArray(likedIds) && likedIds.includes(item.id),
    likeCount: safeCount(item.likeCount),
  };
}

/**
 * Optimistic result of asking for `nextLiked`. Returns the SAME view unchanged
 * when we are already in that state, so a double tap moves the number by at most
 * one, mirroring the server's own no-op.
 */
export function applyOptimisticLike(current: LikeView, nextLiked: boolean): LikeView {
  if (current.liked === nextLiked) return current;
  const delta = nextLiked ? 1 : -1;
  return { liked: nextLiked, likeCount: Math.max(0, safeCount(current.likeCount) + delta) };
}

/** Adopt the server's authoritative answer, defensively normalized. */
export function reconcileLike(server: { liked?: boolean; likeCount?: number }): LikeView {
  return { liked: server.liked === true, likeCount: safeCount(server.likeCount) };
}

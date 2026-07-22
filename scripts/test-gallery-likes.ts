// Pure-logic tests for the gallery like button's optimistic state
// (change: gallery-popularity-ranking). Run by scripts/run-unit-tests.mjs via `npm test`.
//
// The server is already idempotent (setPublicLike is a desired-end-state setter),
// but the CLIENT is where a double-tap turns into a visibly wrong number. These
// helpers exist so that behaviour is testable without a component runner.
import {
  deriveLikeView,
  applyOptimisticLike,
  reconcileLike,
  type LikeView,
} from '../apps/creator-web/src/lib/likeState';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}
const eq = (a: LikeView, b: LikeView) => a.liked === b.liked && a.likeCount === b.likeCount;

// ── deriveLikeView: initial render straight from the search response ──────────
ok(eq(deriveLikeView({ id: 'g1', likeCount: 4 }, ['g1']), { liked: true, likeCount: 4 }),
  'deriveLikeView marks an item present in likedIds');
ok(eq(deriveLikeView({ id: 'g1', likeCount: 4 }, ['g2']), { liked: false, likeCount: 4 }),
  "another user's like does not mark the item as ours");
ok(eq(deriveLikeView({ id: 'g1' }, []), { liked: false, likeCount: 0 }),
  'a legacy item with no likeCount renders as zero, not NaN');
ok(eq(deriveLikeView({ id: 'g1', likeCount: -3 }, []), { liked: false, likeCount: 0 }),
  'a corrupt negative count is clamped to zero');
ok(eq(deriveLikeView({ id: 'g1', likeCount: 2 }, undefined), { liked: false, likeCount: 2 }),
  'a missing likedIds list is treated as "liked nothing"');

// ── applyOptimisticLike: a tap moves the count by exactly one ─────────────────
const start: LikeView = { liked: false, likeCount: 7 };
const likedOnce = applyOptimisticLike(start, true);
ok(eq(likedOnce, { liked: true, likeCount: 8 }), 'liking bumps the count by one');
ok(eq(applyOptimisticLike(likedOnce, true), likedOnce),
  'repeating the SAME direction is a no-op (a double-tap cannot double-count)');
ok(eq(applyOptimisticLike(likedOnce, false), { liked: false, likeCount: 7 }),
  'unliking returns to the starting count');
ok(eq(applyOptimisticLike(applyOptimisticLike(start, true), false), start),
  'like then unlike round-trips exactly');
ok(eq(applyOptimisticLike({ liked: false, likeCount: 0 }, false), { liked: false, likeCount: 0 }),
  'unliking something never liked cannot go negative');
ok(eq(applyOptimisticLike({ liked: true, likeCount: 0 }, false), { liked: false, likeCount: 0 }),
  'an inconsistent count of 0 while liked still clamps at zero');
ok(start.likeCount === 7 && start.liked === false, 'applyOptimisticLike does not mutate its input');

// ── reconcileLike: the server is always the authority ────────────────────────
ok(eq(reconcileLike({ liked: true, likeCount: 99 }), { liked: true, likeCount: 99 }),
  'the server response replaces the optimistic guess');
ok(eq(reconcileLike({ liked: false, likeCount: -1 }), { liked: false, likeCount: 0 }),
  'a nonsensical server count is still clamped');
ok(eq(reconcileLike({ liked: true, likeCount: Number.NaN }), { liked: true, likeCount: 0 }),
  'a non-finite server count never reaches the DOM as NaN');
ok(eq(reconcileLike({ liked: undefined, likeCount: undefined }), { liked: false, likeCount: 0 }),
  'a truncated server response degrades to a safe view');

console.log(`\ngallery-likes: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

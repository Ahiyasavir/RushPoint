// Touch-interaction primitives for the participant + staff app
// (change: play-touch-rtl-a11y).
//
// play-web has no component test runner, so anything here that is a real
// DECISION lives as a pure function and is covered by
// scripts/test-touch-a11y.ts. No React, no Firebase.

// ── Touch targets ────────────────────────────────────────────────────────────
// 44px is the platform minimum for a control operated with a thumb. These are
// deliberately plain literals, not a helper that builds a class string: Tailwind
// only sees STATIC class strings (CLAUDE.md), so an interpolated class compiles
// to no CSS at all and a "44px" target silently renders at its old size.

/** For a control that already has a box (an icon button, a glyph button). */
export const TAP_TARGET = 'min-w-[44px] min-h-[44px]';

/** For an inline glyph inside flowing content: grows the hit area WITHOUT
 *  changing the surrounding layout (the negative margin cancels the padding). */
export const TAP_PAD = 'p-2 -m-2';

/** TAP_PAD only reaches ~32px around a `text-xs` glyph, which is still under the
 *  44px minimum. This one gets the real 44x44 box AND keeps the row height it sits
 *  in: `-m-2` lets the box overflow its slot by 8px on every side, so a 44px
 *  control contributes only 28px of layout — less than a padded text row already
 *  is. Use it for a dismiss/close glyph inside a banner (change:
 *  play-web-accessibility). */
export const TAP_INLINE = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] -m-2';

// ── Attempt-limited answers ──────────────────────────────────────────────────

export interface AttemptGuard {
  /** Ask the player to confirm before this choice is submitted. */
  needsConfirm: boolean;
  /** Upper bound on the attempts still available. Always a non-negative integer. */
  remaining: number;
}

/**
 * Should tapping a multiple-choice answer be confirmed first, and how many
 * attempts are left?
 *
 * WHY THIS EXISTS: a wrong answer normally costs a team nothing — the server's
 * `!correct` branch only bumps `taskAttempts`. But when the creator set
 * `task.smart.attemptLimit`, `submitTaskAnswer` refuses at the cap with
 * `resource-exhausted` ("No attempts left for this task"), and `QuizEntry`
 * submits on the choice button's own onClick with no staged selection. On an
 * attempt-limited task, one misclick therefore burns a finite attempt and can
 * permanently lock the task.
 *
 * So the confirmation is scoped EXACTLY to the case that can lose something:
 * a finite, positive limit. Everything else fails OPEN and submits on the first
 * tap, because a blanket confirmation would tax the common (free) case for no
 * protection at all.
 *
 * `wrongSoFar` is a CLIENT-side, this-session count: the participant payload
 * carries `smart.attemptLimit` (sanitizeTask.ts) but never the team's
 * `taskAttempts`, and shipping that would be a server-payload change. After a
 * reload the count restarts at 0, so `remaining` can OVERSTATE what is left and
 * never understate it — which is why the copy words it as an upper bound. The
 * server stays the only authority; it still refuses at the real cap.
 *
 * Total by construction: it runs inside an onClick, where a throw would swallow
 * the player's tap.
 */
export function quizAttemptGuard(
  attemptLimit: number | undefined,
  wrongSoFar: number,
): AttemptGuard {
  const limit = typeof attemptLimit === 'number' ? attemptLimit : Number.NaN;
  // Number.isFinite rejects NaN AND Infinity in one test: an "infinite" limit is
  // not a limit, and neither is a missing, zero or negative one.
  if (!Number.isFinite(limit) || limit <= 0) return { needsConfirm: false, remaining: 0 };

  const used = typeof wrongSoFar === 'number' && Number.isFinite(wrongSoFar)
    ? Math.max(0, wrongSoFar) // a nonsense negative count must not INFLATE the bound
    : 0;
  return { needsConfirm: true, remaining: Math.max(0, Math.floor(limit - used)) };
}

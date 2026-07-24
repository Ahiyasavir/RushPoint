## Why

> "After I press something, the wait should feel like you're ADVANCING, not staying in place."
> — the user, repeatedly.

Today, when a player answers a task **correctly**, the current task card sits static on screen until
the parent swaps it for the routing wait: the success paths in
`apps/play-web/src/components/TaskRunner.tsx` call `onChanged()` synchronously with no visual motion
of the task *leaving* (`submitCheckIn` at `:472`, `verify` at `:546`, the `res.correct` branch of
`answer()` at `:640` and of `submitOrdered()` at `:657`, `geofenceArrive` at `:697`). The screen
freezes between "graded" and "next mission loads" — the exact "parked, not advancing" feeling the
user called out.

The sibling change `play-working-feedback` (specced and being implemented now) adds the branded
`<Working>` panel for the routing gap plus a success sound/haptic beat. This change is the **visual
complement**: on a server-confirmed correct answer, animate the current task card **out** (a quick,
on-brand slide toward the reading end + fade) the instant success is confirmed, so the screen shows
MOTION at 0 ms of the transition to the next mission, right before `<Working>`/the next card mounts.
It is additive, decorative motion only — no progression logic changes.

## What Changes

- **An optimistic card-out on confirmed success.** On a server-confirmed task success (and only then),
  the current task card plays a brief (~220 ms) exit animation — a slide toward the inline-end plus a
  fade — and then the existing `onChanged()` progression proceeds. The animation plays on the outgoing
  card; the next phase (routing `<Working>` or the next card) mounts immediately after.
- **A tiny pure decision helper** — `resolveCardExit(reducedMotion)` in
  `apps/play-web/src/lib/cardExit.ts` returns `{ animate, delayMs }`: a bounded delay
  (`CARD_EXIT_MS`, ~220 ms) when motion is allowed, and `{ animate: false, delayMs: 0 }` under
  reduced motion. Unit-testable RED-first. This is the single place that guarantees the delay is
  bounded and that progression never waits on an animation event.
- **A CSS-only exit keyframe** (`@keyframes rp-card-exit` in `apps/play-web/src/index.css`, beside the
  existing `rp-working`/`rp-shimmer`) driving the outgoing card's slide+fade, RTL-safe (exits toward
  the reading end in both LTR and RTL), and neutralized by the file's existing
  `prefers-reduced-motion` block.

## What explicitly does NOT change

- **Progression logic is untouched, and never depends on the animation.** `onChanged()` is still the
  one call that advances the run; it is merely deferred by a **bounded JS timer** (never an
  `animationend` listener). A failed, janky or interrupted animation cannot strand the player — the
  timer always fires, and under reduced motion `onChanged()` runs immediately with no animation.
- **Fires only on server-confirmed success — never on a wrong answer, never for a viewer/readonly
  device.** The card-out hooks the same `res.correct` / success branches that already gate
  `onChanged()`; wrong-answer paths (`applyAnswerCost`) and `readOnly` viewers are unaffected.
- **Every existing behavior is preserved** — the score pop, the `play-working-feedback` working
  indicator and success sound/haptic beat, the sequence-step `✓` progress, the retry slot, and all
  aria-live announcements render exactly as before. This change is additive visual motion only.
- **No new dependency** (CSS/inline animation only — `bundle:budget` stays green), **no new callable,
  no server change, no rules change, no scoring/routing change.**
- **No i18n.** The card-out adds no copy; nothing new routes through `t.*`.

## Overlap / sequencing

This change edits the **same success region** of `TaskRunner.tsx` that `play-working-feedback` edits
(the `onChanged()` success calls and the routing card). The implementer MUST sequence **after**
`play-working-feedback` lands and re-read that region by content — the line anchors above may drift.
The two are complementary: `play-working-feedback` owns the incoming wait (`<Working>` + success
beat), this change owns the outgoing card motion.

## Impact

- **Affected specs:** new capability `optimistic-card-out`.
- **Affected code:** `apps/play-web/src/lib/cardExit.ts` (new, pure), `scripts/test-card-exit.ts`
  (new), `apps/play-web/src/index.css` (one keyframe), `apps/play-web/src/components/TaskRunner.tsx`
  (success branches + the card container's `exiting` class). No backend, no shared, no creator-web,
  no i18n.

## Why

> "After I press something, the wait is confusing and boring. Make it INTERESTING in a CREATIVE
> way — it should feel like you're ADVANCING, not staying in place. Inviting, not boring."
> — the user, three times.

Today the single most-hit wait in play-web — the between-mission grading/routing pause after every
task — lands the player on a bare chasing ring plus one unchanging sentence
(`apps/play-web/src/components/TaskRunner.tsx:424-441`, copy `t.task.routing` at `i18n.ts:118`/`:685`).
On a slow route it can sit ~12 s before even a retry appears, and up to the callable deadline.
Nothing moves forward; it reads as "stuck." Worse, the emotional payoff — a **correct answer** —
currently swaps the card **silently** (`TaskRunner.tsx` success paths call `onChanged()` with no
sound, haptic or acknowledgement, `:472 :546 :640 :697`), so the one moment that should feel like
"you're advancing" is the quietest event in the app.

A loading-feedback audit (findings memo) proposes fixing this systemically with a reusable branded
"we're on it" primitive rather than 20 one-off spinners. This change delivers that primitive and
applies it to the top wait, plus the success beat — the heart of the complaint.

## What Changes

- **New reusable `<Working>` primitive** (`apps/play-web/src/components/Working.tsx`) — a drop-in
  replacement for a bare `animate-spin` label during a multi-second wait. It cycles through 2-4
  short, branded HE/EN status messages on a timer *and* shows an **advancing** left-to-right filling
  bar (the existing `from-rp-fire to-rp-amber` gradient, logical inset so it fills start→end in RTL
  and LTR), so the wait talks to the player in RushPoint's voice and reads as forward motion. Pure
  presentational, CSS/inline animation only (no new dependency), RTL-safe, `aria-live` preserved,
  and it honors `prefers-reduced-motion` (falls back to a static first message + a static/determinate
  bar, no rotation). A tiny **pure** helper `workingMessageIndex(tick, count)` decides which message
  shows at tick N — unit-testable RED-first.
- **Apply `<Working>` to the routing/grading wait** (`TaskRunner.tsx:424-441`) — the most-hit wait,
  cycling `checking your answer → locating your next mission → prepping your mission`, keeping the
  existing 12 s retry slot and `role="status"` aria-live.
- **A success beat on a confirmed-correct resolve** — fire the existing mute-gated
  `feedback('task')` cue (sound + success haptic, `apps/play-web/src/lib/sound.ts`) once on a
  server-confirmed task success, so a correct answer lands with an on-brand cue instead of silence,
  immediately before `<Working>` mounts for the routing gap.
- **i18n** — new branded status/success keys in **both** play-web dictionaries (HE natural, EN, no
  em-dash), routed through `t.*`. No hardcoded UI strings.

## What explicitly does NOT change

- **No new dependency and bundle-safe.** `<Working>` is CSS/inline-SVG animation only (no
  lottie/framer); `bundle:budget` stays green.
- **`Button loading` / `useAsyncAction` are untouched.** The existing in-flight button spinner and
  single-flight guard keep working exactly as today; `<Working>` is only for the full-panel wait.
- **No new callable, no server change, no rules change, no routing/scoring change.** The success beat
  reuses the existing `feedback()` cue; the routing wait's retry/aria-live logic is preserved.
- **No `sound.ts` edit.** `feedback('task')` is called, not modified.

## Explicitly out of scope (named follow-up changes)

To keep this change small and cohesive, these audit findings are deferred to their own changes:

- **`play-toast-port`** — port creator's toast singleton to play-web (`playToast` + a `celebrate`
  variant) as the shared success/confirmation sink (audit Finding 5). play-web has **no** toast today.
- **`play-boot-working`** — apply `<Working>` to the PlayScreen boot / join→game landing and the
  GamePromo handoff (audit Findings 2 & 9).
- **`optimistic-card-out`** — animate the current task card out the instant a correct submit
  resolves, so the next phase shows motion at 0 ms (audit "optimistic exit" rule).
- **`creator-launch-liftoff`** — the creator-side waits (launch, RunConsole first load, finalize,
  publish; audit Findings 4/6/7/8).

## Impact

- **Affected specs:** new capability `play-working-feedback`.
- **Affected code:** `apps/play-web/src/components/Working.tsx` (new), a pure helper (new, e.g.
  `apps/play-web/src/lib/working.ts`), `apps/play-web/src/components/TaskRunner.tsx` (routing card +
  success beat), `apps/play-web/src/i18n.ts` (new keys, HE+EN). No backend, no shared, no creator-web.

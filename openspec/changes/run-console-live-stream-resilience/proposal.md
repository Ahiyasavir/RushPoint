# Proposal — run-console-live-stream-resilience

## Why

The creator Run Console is the operator's live picture of an event in progress. Three of its live
channels can degrade **silently**, so the console keeps looking healthy while it has actually gone
blind or deaf. At a live event that is the worst failure mode: the operator trusts a frozen or mute
console and misses the field.

1. **The teams poll has no error handling and no stale signal (BUG, top).** `loadTeams`
   (`RunConsolePage.tsx:159-169`) calls the `listRunTeams` callable every 5s as `void loadTeams()`
   with **no try/catch**. `listRunTeams` is the single source for the teams table, every team score
   (`rankedScoreById` fallback at `:460-462`), the entire attention verdict
   (`buildAttentionContext` / `classifyTeamAttention` at `:469-475`), the "what needs you right now"
   signal chips (`:546-562`), the overdue-photo count (`:502-504`) and the section-rail badges. On
   any poll rejection (an auth-token refresh blip, a transient network drop, a function cold-start
   timeout) the promise rejects unhandled and `teams` keeps its last value. The whole board, the
   attention badges and the signal chips keep rendering last-known state **with zero indication they
   are stale**. Every other panel that loads data surfaces failure (`photoLoadError` at `:215`,
   `surveyError` at `:292`, the analytics/summary/heatmap panels), but the most important live stream
   on the page has neither an error surface nor a "last updated" signal.

2. **The SOS / alerts listener swallows its own error (ROBUSTNESS).** The unacknowledged-alerts
   `onSnapshot` (`:124-145`) has a bare `() => undefined` error handler at `:144`. That listener is
   the delivery path for a raised SOS. A realtime listener auto-retries a transient blip, but a
   persistent failure (permissions, a torn-down-and-not-reestablished listener, an offline stretch
   longer than the SDK retry) leaves the alerts array frozen at its last snapshot with **no "alerts
   unavailable" indicator**. The creator reads "no SOS" when the truth is "we cannot tell" — the one
   stream where silence is most dangerous is the exception to the console's own visible-failure rule.

3. **The SOS audio cue can be permanently inaudible on an already-live console (ROBUSTNESS).**
   `playAlert()` only makes noise if the shared `AudioContext` was unlocked by a prior user gesture
   (browser autoplay policy). The console calls `unlockAudio()` in exactly two handlers: "Start all
   teams" (`:356`) and "Invite staff" (`:386`). A creator who opens the console of an **already-live**
   run — a refresh, a co-organizer already started the teams, a mid-event reopen — and then neither
   starts teams nor invites staff never unlocks audio, so every subsequent SOS cue silently drops at
   `lib/sound.ts:47` (`if (!ctx || ctx.state !== 'running') return`). The tab-title flash still fires,
   but that is invisible precisely when the operator is looking at the console. Result: a raised SOS
   with no audible alert, on the operator whose job is to catch it.

## What Changes

Make all three live channels **fail visibly, never silently**. This is one cohesive change: the
creator's live picture must never freeze silently, go silently deaf to SOS, or lose its audible cue.

- **Teams poll**: wrap the `listRunTeams` call in try/catch. On success, stamp a `lastTeamsSyncAt`
  timestamp and clear a `teamsStale` flag; on failure, set `teamsStale`. Render a small, unobtrusive
  "reconnecting / last updated N s ago" line on the teams panel header when the board is stale (the
  flag is set, or the last good sync is older than roughly two poll intervals). The verdict is a pure
  helper, `apps/creator-web/src/lib/streamFreshness.ts`, so it is unit-testable.
- **Alerts listener**: replace `() => undefined` with a handler that sets an `alertsStreamError` flag
  (logged like the photo listener at `:227`) and clears it on the next good snapshot (mirroring
  `setPhotoLoadError(false)` at `:221`). Surface a one-line "alerts feed interrupted, reconnecting"
  notice in the **pinned zone** so it is visible even in the dead-stream-at-zero-alerts case (the
  alerts panel only renders when `alertCount > 0`).
- **Audio unlock**: unlock audio on the creator's **first interaction** with the console, whatever
  control it is — a one-time `pointerdown` + `keydown` listener on the page root that calls
  `unlockAudio()` once and then detaches. `unlockAudio()` is already idempotent and a silent no-op
  where Web Audio is unavailable (`sound.ts:24-33`), so this is safe and the existing gesture-based
  unlocks stay.

## What does NOT change

- **The 5s poll cadence and the data shape are unchanged.** No switch to a listener (the teams
  projection is computed server-side on purpose). Every consumer of `teams` reads the same rows.
- **Last-known data stays on screen.** A failed poll or a dead alerts stream never blanks the board
  or the alerts — the last-known values keep rendering, only marked stale.
- **The audio cue, the tab-title flash and the alerts panel rendering are unchanged.** The audio fix
  adds an unlock path; it does not touch `sound.ts` or the cue envelope.
- **Layout is data.** These are state + handler + one pinned-notice addition; the `runConsoleLayout.ts`
  section/lane model is untouched. The stale line is a panel-local indicator on the existing teams
  panel; the alerts notice reuses the existing pinned zone.
- **No backend, no callable, no `savePayload`, no shared types, no rules, no play-web.**

## Non-goals

- No change to how often the console polls, nor to `listRunTeams` itself.
- No new panel, no rail-section change, no change to the attention/photo/leaderboard verdicts.
- No change to `apps/play-web` (its `lib/sound.ts` is a separate file; see design §5 for the overlap
  note).

## Impact

- Affected specs: `run-console-live-streams` (new)
- Affected code: `apps/creator-web/src/pages/RunConsolePage.tsx` (three additive state/handler
  changes + two indicators), `apps/creator-web/src/lib/streamFreshness.ts` (new pure helper),
  `apps/creator-web/src/i18n.ts` (additive: two new `runConsole` strings, HE + EN),
  `scripts/test-run-console-freshness.ts` (new unit suite)
- Surfaces touched: **creator-web only**. No shared types, no callable, no rules, no play-web.

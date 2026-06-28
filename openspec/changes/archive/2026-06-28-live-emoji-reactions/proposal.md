# Proposal — Live emoji reactions

## Why

A live race feels social when there's a sense of an audience. Letting participants and spectators
fire quick emoji reactions (❤️🔥😱👏) at the live leaderboard / TV screen creates that crowd energy
cheaply — a steady stream of floating reactions makes the event feel alive and watched.

## What Changes

> Observable behavior. Ephemeral, high-frequency reactions over RTDB (per the cost convention).

- Anyone viewing the live leaderboard / TV screen can tap an emoji; a **floating reaction** animates
  up the screen for all current viewers in near-real-time.
- Reactions are **ephemeral** — written to Realtime Database (RTDB), throttled per viewer, and never
  persisted to Firestore (they have no scoring or audit meaning).
- A per-viewer **rate limit** (e.g. 1 reaction / 500 ms, max N/min) prevents spam; the aggregate
  count is shown as a subtle burst, not stored.

## Capabilities

### New Capabilities
- `live-emoji-reactions`: ephemeral, throttled emoji reactions broadcast over RTDB to all viewers of a
  live run's leaderboard / TV screen.

### Modified Capabilities
<!-- None -->

## Surfaces touched

- **RTDB:** `/runs/{runId}/reactions` ephemeral path (bandwidth-billed, auto-expiring). **Depends on
  the RTDB migration (Appendix B #2)** for the RTDB wiring; until then this change is dark.
- **play-web:** a reaction bar + floating-reaction renderer on the leaderboard / `?tv=` screen;
  subscribes to the RTDB path. Pure `shouldThrottleReaction(lastAtMs, nowMs, minGapMs)` helper.
- **Tests:** `scripts/test-reaction-throttle.ts` (throttle predicate).
- **No Firestore write, no scoring change.**

## Non-goals

- No persistence or history of reactions (ephemeral only).
- No moderation of the fixed emoji set (a closed, safe set — no free text).
- No reaction-driven scoring or rewards.

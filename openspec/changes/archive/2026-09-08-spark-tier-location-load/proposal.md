## Why

A 100–120 person location-heavy run cannot currently be played on the Firebase Spark (free) plan.
`updateLocation` costs **2 writes + 2 reads on every ping** — `teamLocations` set, `locationTrack`
append, a game-doc read for `safeZone`, and a team-doc read — and the participant app pings every
20 s from each controller device. For 120 participants over a 75-minute run that is roughly
**27,000 pings ⇒ ~54,000 writes and ~54,000 reads from location alone**, against daily ceilings of
20,000 writes and 50,000 reads. Location by itself exceeds *both* quotas before a single mission,
photo, chat message or leaderboard refresh is counted.

The 2026-08-26 exam run already hit `8 RESOURCE_EXHAUSTED` mid-play with 29 participants. At 120 the
run would exhaust the write quota in roughly 20–30 minutes and every callable would begin failing
mid-game. This change removes the largest single source of that load without buying Blaze and
without adding any new transport, protocol, or connection infrastructure.

## What Changes

- **A run's location pings stop costing a Firestore read.** The `safeZone` game-document lookup on
  the ping path is served from the existing process-local document cache. The game template does not
  change during a run, so re-reading it once per ping is pure waste.
- **A stationary participant stops writing.** The server skips the `teamLocations` write when the
  team has not meaningfully moved and its stored fix is still recent. The pin is refreshed on real
  movement or once the stored fix ages out, so the creator's live map never shows an
  indefinitely-stale position.
- **The GPS history track is sampled rather than exhaustive.** `locationTrack` exists only to feed
  the post-run movement heatmap, which bins points onto a ~55 m grid; retaining every 20 s fix is far
  finer than the consumer's own resolution.
- **Firestore operations become measurable.** An opt-in, off-by-default counter attributes reads and
  writes to the callable that caused them, so quota headroom is a measured number rather than an
  estimate — and a future regression that reintroduces per-ping load is detectable.
- **Safe-zone breach detection is unchanged.** The dedupe decision governs only whether a *write*
  happens. The boundary evaluation still runs on every ping, so a stationary team sitting just
  outside the play area is still detected and still raises an alert.

No callable is added or removed. `updateLocation` keeps its existing signature and return shape, so
no client wrapper changes and no participant app release is required for the saving to take effect.

## Capabilities

### New Capabilities
- `firestore-quota-budget`: Attributable Firestore read/write accounting and a stated per-run
  operation budget, so the platform can assert it fits inside a fixed daily quota rather than hoping
  it does. Covers the opt-in counter, its attribution to a callable, and its absence of effect when
  disabled.
- `location-ping-economy`: The rules governing what a participant location ping costs — when a
  position write is required versus suppressible, when a history point is retained, and the
  freshness guarantee the live map is owed regardless of suppression.

### Modified Capabilities
- `run-analytics`: The movement heatmap's input becomes a sampled track rather than every retained
  fix. Adds the requirement that heatmap density remains faithful at the aggregator's own grid
  resolution, so sampling cannot silently degrade the post-run picture.

## Impact

**Surfaces touched**

| Surface | Change |
|---|---|
| `packages/shared` | New pure modules for the ping-write verdict and the track-sampling decision (clock injected, total, never throwing — the `safeZone.ts` / `stuckGuards.ts` pattern). New op-counter accounting logic. |
| `functions/` | `updateLocation` (`functions/src/index.ts:335-427`) consumes the verdict; the `safeZone` read routes through `cachedGetDoc`. Counter hook added to the existing Proxy in `functions/src/docCache.ts` — reads are not currently intercepted there and need a counting path. |
| `firestore.rules` | Untouched. |
| `apps/play-web` | Untouched — the 20 s ping cadence and the callable contract stay as they are. |
| `apps/creator-web` | Untouched. Live-map freshness is preserved by the verdict's staleness ceiling rather than by a client change. |

**Risk concentrated in one place:** the dedupe verdict is the only component that can cause a
position to go unrecorded. It is therefore pure and exhaustively unit-tested ahead of the callable
change, and the safe-zone evaluation is deliberately kept upstream of it so no suppression path can
reach the safety logic.

**Data model:** `teamLocations` documents gain no new fields; the last-stored fix already carries
`lat`, `lng` and `updatedAt`, which is everything the verdict needs. No migration, no backfill.

## Non-goals

- **No new transport.** No WebSocket, SSE, long-poll or push channel. Server-to-client fanout
  (feed, chat, announcements, the team-doc listener and the 12 s `getMyTeamState` poll) remains on
  Firestore listeners and is explicitly out of scope for this change.
- **No change to scoring, task completion, routing, or `finalizeRun`.** These are low-frequency and
  durability-critical.
- **No client-side changes.** Not the ping interval, not the listener set, not the poll cadence.
- **No move to the Blaze plan** and no change to what is hosted on the VPS.
- **Not a claim that 120 players now fit.** This change removes the largest single source of load and
  makes the remainder *measurable*; whether the full run fits is a question the new counter is built
  to answer, and closing any remaining gap is follow-on work.

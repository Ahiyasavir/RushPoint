## Why

`spark-tier-location-load` bounded the movement-history track's Firestore cost by retaining
one point per ~100 m travelled instead of one per ping — a real saving, but a sampling
compromise that exists *only* because a Firestore write costs quota. The self-hosted VPS
already stores participant-uploaded media on local disk when running outside Firebase Storage
(`functions/src/storageUtil.ts`), in the same process that runs every callable. A disk write
there costs nothing against the Spark ceilings.

Moving the track there removes both the remaining write cost AND the sampling compromise at
once: once the write is free, there is no reason left to sample it. This is a genuine quality
improvement, not merely a cost saving — the post-run movement heatmap becomes exact rather
than approximate, for every run played on the self-hosted deployment.

## What Changes

- **The GPS movement track is stored on the VPS's local disk**, one append-only file per run,
  instead of as Firestore documents — gated by a new environment variable so the behavior is
  opt-in and, when unset, byte-for-byte identical to today.
- **Full fidelity when disk storage is enabled.** The distance-based sampling introduced by
  `spark-tier-location-load` is bypassed entirely in this mode: every ping's position is
  retained, because retaining it no longer costs anything.
- **`getRunHeatmap` prefers the disk file, falling back to Firestore** when none exists — so a
  run recorded before this change, or one played under the Functions emulator or real Cloud
  Functions (neither of which offers a stable local disk), still produces a heatmap exactly as
  it does today.
- **The 90-day PII prune deletes the disk file too**, alongside the existing Firestore bulk
  delete, so the retention guarantee holds regardless of which mode recorded the run.

No callable's signature changes. `updateLocation` and `getRunHeatmap` keep their existing
request/response shapes — this is a storage-location change, not an API change, so no client
wrapper in either app needs updating.

## Capabilities

### New Capabilities
- `vps-disk-track-storage`: where and how a run's GPS movement track is persisted when the API
  runs on the self-hosted VPS — an append-only, path-safe, concurrency-safe local file per run,
  with retention (prune) parity with the Firestore path it replaces.

### Modified Capabilities
- `run-analytics`: the movement heatmap gains a full-fidelity source when disk storage is
  active — every retained point contributes, rather than a distance-sampled subset. The
  requirement `spark-tier-location-load` is adding to this same spec (not yet archived) —
  that a *sampled* track stays representative at the aggregate level — continues to govern
  the Firestore path, which remains the fallback and the only path under the emulator/Cloud
  Functions.

## Impact

**Surfaces touched**

| Surface | Change |
|---|---|
| `functions/src` | New `trackStore.ts`. `index.ts` `updateLocation`'s track-retention branch gains a disk path. `runs/index.ts` `getRunHeatmap` gains a disk-read-first path. `maintenance/index.ts` `pruneRunPII` gains a disk-delete step. |
| `packages/shared` | None — `buildMovementDensity` (movementHeatmap.ts) already takes a plain point array regardless of source; no change needed. |
| `firestore.rules` | Untouched. |
| `apps/creator-web`, `apps/play-web` | Untouched — no callable shape changes. |
| Deployment | A new optional env var on the VPS (`docker-compose.api.yml` / `api.env`). Unset anywhere else (emulator, Cloud Functions, local dev) — those keep today's Firestore behavior with no change in code path. |

**Data model:** no Firestore schema change. The disk file's shape is internal to
`trackStore.ts` and never crosses a callable boundary.

**Risk concentrated in one place:** concurrent writers. Many teams ping the same run's file at
once; `trackStore.ts` owns the only place that can corrupt or lose a point, and is where the
tests concentrate.

## Non-goals

- **Not moving `teamLocations` (live position pins) anywhere.** That is tracked separately
  against the project's own planned roadmap item, "Appendix B #2 — RTDB live-telemetry
  migration" (`functions/src/__planned__/v21-data-and-scalability.todo.test.ts:30-35`), which
  needs a new Firebase product (Realtime Database), new security rules, and changes to both
  `LiveTeamMap.tsx` and `StaffTeamMap.tsx` — a materially bigger and riskier change than this
  one, scoped on its own.
- **No change to `Task.locationless`-style client behavior**, ping cadence, or anything in
  `apps/play-web`.
- **No change to the Firestore-mode sampling behavior** (`shouldRetainTrackPoint` in
  `packages/shared/src/locationPingEconomy.ts`) — it still governs the fallback path exactly
  as `spark-tier-location-load` left it.
- **Not a multi-process or horizontally-scaled design.** Like `docCache.ts`, `rateLimitStore.ts`
  and `lastFixStore.ts`, this assumes exactly one API process; it does not attempt to solve
  disk storage for a scaled-out topology.

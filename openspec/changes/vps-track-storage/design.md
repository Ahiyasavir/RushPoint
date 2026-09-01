## Context

`spark-tier-location-load` distance-samples the movement track (one point per ~100 m) to bound
its Firestore write cost. That sampling exists *only* because a Firestore write costs quota —
it is a compromise, not a feature. The self-hosted VPS already writes participant media to
local disk in exactly this situation (`functions/src/storageUtil.ts` `UPLOAD_DIR`), from the
same process that runs `updateLocation`, since `server.js` mounts the built `functions/lib`
directly rather than proxying to it over HTTP.

Four existing modules already document the same precondition this design extends —
`docCache.ts`, `rateLimitStore.ts`, `lastFixStore.ts`, `runs/locationFreshnessCache.ts`: the API
runs as exactly ONE Node process, no `cluster`. Each carries a header naming what breaks if that
stops being true. `trackStore.ts` is the fifth.

## Goals / Non-Goals

**Goals:**
- Move the track's Firestore cost to zero when the VPS deployment opts in.
- Retain every ping (not a sampled subset) once the write no longer costs quota — genuinely
  better data, not merely cheaper.
- Never lose a point to concurrent-write corruption.
- Fall back to exactly today's Firestore behavior wherever disk storage is unavailable or
  unconfigured (emulator, Cloud Functions, dev, or a run recorded before this shipped).

**Non-Goals:**
- Moving `teamLocations` anywhere — separately scoped against the project's own RTDB roadmap
  item.
- A multi-process or horizontally-scaled disk design.
- Any change to `updateLocation`'s or `getRunHeatmap`'s external signature.

## Decisions

### D1 — One append-only JSONL file per run, keyed by validated path segments

`{TRACK_DIR}/{ownerUid}/{gameId}/{runId}.jsonl`, one point per line as compact JSON. JSONL
(not a JSON array) is chosen specifically because it is *appendable*: writing a new point never
requires reading or rewriting the file, unlike a JSON array which would need its closing
bracket rewritten on every point.

Path segments come only from the validated `ownerUid`/`gameId`/`runId` already flowing through
`updateLocation` — the same identifiers `resolveCallerTeam` and the Firestore path already
trust. Resolution goes through a `safeUploadPath`-style guard (`storageUtil.ts` pattern):
resolve the absolute path, refuse if it does not sit under the configured root. This is a
second, independent instance of that guard rather than a shared import, because the two guard
different roots (`UPLOAD_DIR` for media, a new `RUSHPOINT_TRACK_DIR` for tracks) and conflating
them would let a media-path bug reach the track root or vice versa.

### D2 — Concurrency: an in-process write queue, one per run, not raw `fs.appendFile`

Many teams ping the same run's file concurrently. `fs.appendFile` on most POSIX filesystems is
atomic for writes below `PIPE_BUF` (a JSONL line comfortably qualifies), but relying on a kernel
implementation detail for correctness, rather than expressing the invariant directly, is exactly
the kind of narrower-than-assumed foundation this platform's own incident history warns against
(the array-coercion and doc-cache footguns in CLAUDE.md are all versions of the same lesson).

Instead: a `Map<runKey, Promise<void>>` chains each run's writes — `append()` sets
`queue.set(key, current.then(() => doAppend()))` — so writes to the SAME run serialize through
one promise chain while writes to DIFFERENT runs proceed independently. This is the same shape
`docCache.ts`'s per-path invalidation and `lastFixStore.ts`'s per-key map already use: keyed
isolation over a single process-wide lock, so one busy run's queue never blocks another's.

- **Rejected — raw concurrent `fs.appendFile` calls:** correct only by accident, and silently
  wrong if the record ever exceeds `PIPE_BUF` (a future field addition, e.g. `heading`, could
  cross that line without anyone noticing).
- **Rejected — a file lock (`proper-lockfile` or similar):** solves a *cross-process* problem
  this platform does not have (single process, by precondition) at the cost of a new dependency
  and real failure modes (stale locks after a crash) for no benefit here.

### D3 — Every operation is best-effort and never throws

Mirrors the existing comment already in `updateLocation` (the track is best-effort; never fail
the location update). `appendTrackPoint`, `readTrackPoints`, and `deleteRunTrack` all catch
internally and log via `functions.logger.warn`, matching `storageUtil.ts`'s
`deleteLocalUploadPrefix` pattern. A location ping must never fail because a disk write failed.

### D4 — `readTrackPoints` returns `null` for "no file", `[]` for "empty file", never conflates them

This is the fallback contract `getRunHeatmap` depends on: `null` means "check Firestore
instead"; `[]` means "disk storage was active for this run and genuinely recorded nothing yet."
Conflating them (e.g. both returning `[]`) would make a fresh disk-mode run with zero pings so
far indistinguishable from a run that predates disk storage entirely, silently hiding real
Firestore data that a naive "disk returned nothing, still fall back" rule would then incorrectly
surface as duplicate or stale.

### D5 — Full fidelity on WRITE, distance sampling on READ

**Corrected during implementation.** The first version of this decision simply skipped
`shouldRetainTrackPoint` in disk mode and fed every ping to the heatmap. A smoke run against
the emulator with disk storage enabled caught what that actually does: `pointCount` went 3 → 6
while the team stood still, i.e. it reproduced the exact defect the distance rule exists to
prevent. `buildMovementDensity` counts points per grid cell, so a per-ping track makes the
places teams STOOD STILL the hottest cells and a movement heatmap reports the opposite of
movement. More data is better raw material and worse input to this particular aggregator.

So the two concerns are separated:
- **Write** (disk mode): every ping is stored. The raw track is the valuable artefact and a
  local append costs nothing against the Spark ceilings.
- **Read** (`getRunHeatmap`): `sampleTrackByDistance` applies the same distance rule, per team,
  before the points reach `buildMovementDensity`.

Both modes therefore hand the aggregator the same shape, which is what makes their heatmaps
comparable rather than merely both non-empty. The Firestore path still samples on write, because
there a write costs quota and the raw data cannot be afforded in the first place.

Sampling is **per team**: two teams standing 5 m apart have not travelled between each other's
fixes, so one team's point must never satisfy another's distance rule. The disk file interleaves
all teams, so the read-time sampler groups by `teamId` before applying the rule — a distinction
the write-time path got for free from `lastFixStore` being keyed by team.

### D5-original (superseded) — Full fidelity as a plain mode switch

When `trackStorageEnabled()` is true, `updateLocation`'s track branch skips
`shouldRetainTrackPoint` entirely — every ping's point is appended. This is not "a looser
sampling threshold"; it is the deliberate removal of a compromise that no longer serves a
purpose once the write is free. `shouldRetainTrackPoint` and its distance-sampling tests are
untouched and still govern the Firestore fallback path exactly as `spark-tier-location-load`
left them.

### D6 — `getRunHeatmap` tries disk first, Firestore second, never both

One `readTrackPoints()` call; if it returns non-null, use it and skip the Firestore read
entirely, avoiding a wasted read on the now-common path. If `null`, read Firestore exactly as
today. No merge-of-both-sources case exists, because a single run is recorded in exactly one
mode for its whole lifetime — the env var does not change mid-run.

### D7 — Pruning deletes the disk file unconditionally, alongside the existing Firestore delete

`pruneRunPII` already iterates `PII_BULK_SUBCOLLECTIONS` (which still includes `locationTrack`,
unchanged — Firestore-mode runs and any run's leftover Firestore docs still need it purged
there). A new, separate `deleteRunTrack()` call runs alongside it, unconditionally and
best-effort: cheap to call even for a Firestore-mode run (resolves to "no file, no-op").

## Risks / Trade-offs

- **Disk is not backed up the way Firestore is** → The track is diagnostic/analytics data (a
  post-run heatmap), not scoring or completion data; losing it degrades a nice-to-have view,
  never a game outcome. Acceptable, and explicitly the same risk class `UPLOAD_DIR` media
  already carries.
- **VPS disk fills up on a very long-running deployment** → Bounded by the existing 90-day
  prune (D7) and by the fact that a JSONL line is tiny (~40 bytes); a worst-case single day's
  worth of 120-participant, 75-minute runs is a few MB, not a capacity concern at the VPS's
  measured 72 GB free (per the event-readiness measurement).
- **A future field addition to a track point could grow a line past `PIPE_BUF`** → Moot under
  D2's serialized-queue design; named here only so a reviewer doesn't reach for "well, appends
  are atomic anyway" as a reason to remove the queue later.
- **The env var is a new deployment knob** → Off by default everywhere it is not explicitly
  set, matching `RUSHPOINT_DOC_CACHE`'s and `UPLOAD_DIR`'s own opt-in convention; no environment
  changes behavior without an explicit operator action.

## Migration Plan

No data migration. Existing Firestore-recorded tracks are read exactly as today via the
fallback (D4/D6) — nothing needs to move. Enabling disk storage on the VPS is a config change
(set `RUSHPOINT_TRACK_DIR`, mount a volume) that takes effect for runs recorded *after* it is
set; no run straddles both modes.

Rollback is unsetting the env var — every code path reverts to its Firestore-only behavior with
no further change needed.

## Test strategy

**Pure lane (`npm test`, no emulator)** — `scripts/test-track-store.ts`, using a real temp
directory (`node:fs`, `node:os.tmpdir()`) exactly as `scripts/test-emulator-gate-isolation.ts`
already does for its own filesystem assertions:
- Append/read round-trip, ordering preserved, two runs never share a file.
- Concurrent appends (many promises racing on the same run key) all land intact and
  independently parseable — the D2 assertion that matters most.
- Path-traversal refusal: a run reference engineered to resolve outside the root is refused.
- `readTrackPoints` returns `null` for "never written," `[]` for "written but empty" — the D4
  contract, asserted directly.
- Every operation tolerates a broken root (e.g. root is actually a file, or unwritable) without
  throwing — the D3 contract.
- `deleteRunTrack` on a file that was never created succeeds silently.
- The disabled state (`RUSHPOINT_TRACK_DIR` unset) is injected via the factory, not
  `process.env`, matching the project's clock/config-injection convention for unit tests.

**Emulator lane (`npm run e2e`)** — new assertions in `scripts/e2e-verify.mjs`:
- `getRunHeatmap` for a disk-mode run reflects a point recorded on every ping, not a sampled
  subset — proves D5 wired correctly, not just the module in isolation.
- `getRunHeatmap` for a Firestore-mode run is unchanged from today.
- `pruneRunPII` removes a disk-mode run's on-disk file — best done as a direct call against
  `trackStore.ts` inside the e2e process, since the emulator has no VPS disk topology to point
  a real HTTP-driven prune at; the callable-level assertions stay on the Firestore path, which
  the emulator can actually exercise end-to-end.

**Gates:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
`npm run play:build`, `npm run e2e`. No UI touched, so no `i18n:check` finding is expected, but
`npm run verify` still runs it.

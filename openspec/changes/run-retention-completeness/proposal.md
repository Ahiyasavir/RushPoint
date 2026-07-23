## Why

The Privacy Policy makes an unconditional promise to participants. `LegalPage.tsx:384-385` (EN) and
`:150-151` (HE):

> Raw GPS location data: auto-deleted 90 days after run completion
> Uploaded photos: auto-deleted 90 days after run completion

The code that keeps that promise is `sweepExpiredRuns` (`functions/src/maintenance/index.ts:154-162`):

```js
db.collectionGroup('runs')
  .where('status', '==', 'finished')
  .where('finishedAt', '<', cutoff)
```

`status: 'finished'` is written in exactly one place — `finalizeRun`
(`functions/src/runs/index.ts:1537-1539`, `{ status: 'finished', finishedAt: now, … }`). Finalizing is
a **deliberate creator action** from the run console. Nothing else ever writes that status, and there
is no timeout, no trigger, no fallback.

So the retention promise is conditional on a button being pressed. A run that is simply **abandoned**
— the group goes home, the creator closes the tab and never finalizes — is matched by neither
predicate and is therefore **retained forever**: `teamLocations` + `locationTrack` (raw GPS pings),
`feedItems` (participant photos + team names), `alerts` (SOS docs carrying raw lat/lng), `chat`
(free-typed messages), guardian-consent names, and every uploaded photo/audio object under
`runs/{runId}/` in Storage. Abandonment is not an edge case; it is the ordinary way a field game ends
when the creator is a parent at a bar mitzvah rather than an operator watching a console.

This is not a product decision, a policy question or a hardening idea. It is a **defect**: the
system's behavior contradicts a promise the product already publishes in its own legal copy. That is
the entire scope of this change.

## What Changes

**The retention sweep stops depending on a button being pressed.**

- A run becomes eligible for the PII prune when it is unambiguously over **and** past the retention
  window, whether or not it was ever finalized.
- "Unambiguously over" for a non-finalized run means **every** timestamp the run carries — when it
  was created, when it was launched, when it was last written — is older than the full retention
  window. A run that anything touched recently is never eligible, regardless of how old its other
  timestamps are.
- Finalized runs keep exactly today's rule (`finishedAt` + 90 days). This change adds a second door;
  it does not move the existing one.

**The eligibility decision becomes a pure, total function.**

- `evaluateRunPrune(run, now, days) -> { prune, reason, … }` — no I/O, no clock read, exhaustively
  unit-tested including the ±1 ms boundary, absent/NaN timestamps, and clock skew.
- The Firestore queries become a cheap *necessary-condition* filter; the pure predicate is the
  **authority** that decides whether anything is destroyed. This is the same shape as the game-trash
  purge, where `isPurgeDue` re-checks every candidate the query returned.
- Every ambiguity biases toward **keep**. A run with no parseable timestamp is never pruned; a run
  whose newest timestamp is in the future (clock skew) is never pruned.

**The sweep is bounded.**

- Runs are deduplicated across the two queries, the document path is shape-checked before any id is
  used to build a Storage delete prefix, and the number of runs pruned per invocation is capped so
  one sweep cannot run past the function's timeout. Progress is monotone (`piiPrunedAt` is a
  tombstone), so a capped sweep resumes on the next run.

### Non-goals

- **No change to what a prune destroys.** `pruneRunPII` is untouched: same subcollections, same
  photo-URL clearing, same Storage prefix (still via `runPhotoPrefix`, which throws on a blank id).
  This change decides *which runs* are pruned, never *what* pruning does.
- **No change to `hideFeedItem`.** Investigated as part of this work and deliberately rejected — see
  design D5. The Terms already say hide is reversible, the behavior matches, and making hide destroy
  the Storage object would hand a participant-triggerable irreversible-deletion primitive to any two
  rival teams via the report auto-hide threshold.
- **No change to the ceremony feed on the public leaderboard.** Designed behavior, gated on
  `published`; whether a shared board carries participant photos is a product call, not a defect.
- **No signed/expiring URLs, no authorizing proxy, no token rotation.** Different change entirely.
- **No legal or privacy copy changes.** Gaps are reported, never rewritten.
- **No UI, no i18n, no shared types, no Firestore rules.**

## Capabilities

### New Capabilities

- `run-data-retention`: participant PII captured during a run is destroyed once the retention window
  has elapsed, for **every** run that is over — whether it was finalized by its creator or simply
  abandoned — with the eligibility decision made by a pure, total, fail-closed predicate that can
  never select a run with any sign of recent activity.

## Impact

- **Files:** `functions/src/maintenance/runRetention.ts` (new — pure predicate),
  `functions/src/maintenance/runRetention.test.ts` (new — vitest),
  `functions/src/maintenance/index.ts` (`sweepExpiredRuns` only), `firestore.indexes.json` (one new
  composite index), `scripts/e2e-verify.mjs` (assertions added, see below).
- **⚠ Deploy ordering:** the new abandoned-run query needs a `runs` COLLECTION_GROUP composite index
  on `(status ASC, createdAt ASC)`. **`firebase deploy --only firestore:indexes` MUST land, and the
  index MUST finish building, BEFORE the functions deploy.** If functions ship first, the scheduled
  sweep throws `FAILED_PRECONDITION` on its second query — the *existing* finished-run prune still
  happens (it runs first and is a separate query), but the new abandoned path silently does nothing
  until the index exists.
- **Data risk:** this code deletes participant data. Mitigated by making the decision pure and total,
  by biasing every ambiguity to keep, by anchoring non-finalized runs on the **maximum** of all known
  timestamps rather than any single one, and by the invariants the tests assert (a run with any
  timestamp inside the window is never pruned; an unparseable/absent timestamp is never pruned; the
  boundary is exact at ±1 ms).
- **Testing:** pure-logic lane (vitest, no emulator). E2E assertions for the callable behavior are
  **written but deliberately NOT run** — a live playtest stack is serving from this tree and
  `npm run e2e` would contend with it. That is stated, not assumed.

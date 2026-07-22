# Wave-J Retention Fix — J3: prune the `alerts` subcollection

## Proposal (what & why)

`pruneRunPII` (`functions/src/maintenance/index.ts`) honours the 90-day retention policy by
purging raw participant PII from finished/aged runs: `teamLocations`, `locationTrack`, trackable
logs, `zones`, `feedItems`, photo URLs and consent PII. **It never touches the `alerts`
subcollection.**

`alerts` docs carry raw GPS coordinates:
- `triggerSOS` writes `{ type:'sos', lat, lng, ... }` (`functions/src/index.ts:405-414`)
- safe-zone breach writes `{ type:'safe_zone_breach', lat, lng, ... }` (`functions/src/index.ts:364-368`)

These are exactly the "GPS location pings" the policy header (`maintenance/index.ts:3-6`) promises
to purge. Today they persist indefinitely past the retention window — a privacy/compliance gap that
matters because the product targets youth events with minors (finding J3, `docs/wave-j/privacy-lifecycle.md`).

## Design (how + test strategy)

**Fix:** add `${runPath}/alerts` to the same batched/paginated bulk delete `pruneRunPII` already
runs for `teamLocations`/`locationTrack`/`zones`/`feedItems` (via `deleteDocsInChunks`). We fully
delete the alert docs (not just null lat/lng) — the ack fact is operational, not aggregate results,
and consistency with how the other location subcollections are purged wins.

**No over-deletion / idempotent:** the fix lives entirely inside `pruneRunPII`, which only ever runs
against runs `sweepExpiredRuns` selects (`status=='finished'` AND `finishedAt < cutoff`, skipping
already-`piiPrunedAt`). `deleteDocsInChunks` on an empty snapshot is a no-op, so a re-run (or a run
that never had alerts) deletes nothing extra. Same targeting, same batch pattern.

**Refactor for testability:** the "what to delete" was previously an inline list of subcollection
names with no seam. Extract a pure `PII_BULK_SUBCOLLECTIONS: readonly string[]` naming the
run-level subcollections whose docs are bulk-deleted, and have `pruneRunPII` iterate it. This makes
the delete-set unit-testable without an emulator.

**Test strategy:**
1. **Unit (RED-first):** `scripts/test-retention-prune.ts` asserts `PII_BULK_SUBCOLLECTIONS`
   contains `alerts` (plus the pre-existing location subcollections). RED before the fix (helper
   absent / list missing `alerts`), GREEN after. Runs via `npm test` (no emulator).
2. **E2E (staged for parent — do NOT edit `scripts/e2e-verify.mjs`, another agent holds it):**
   In a retention/prune scenario: create a run, `triggerSOS` (writes an `alerts` doc with lat/lng),
   finish + age the run, call `pruneRunNow`/`pruneExpiredRunDataNow`, then assert the run's `alerts`
   subcollection is empty. A separate **live** run with an SOS alert must keep its alerts untouched
   (sweep only targets finished/aged runs). See "Staged e2e assertion" below.

## Tasks (RED → GREEN → REFACTOR)

1. **RED** — add `scripts/test-retention-prune.ts` asserting `PII_BULK_SUBCOLLECTIONS` includes
   `alerts`. Fails (helper not exported).
2. **GREEN** — export `PII_BULK_SUBCOLLECTIONS` (incl. `alerts`) from `maintenance/index.ts` and
   have `pruneRunPII` build its bulk-delete snapshots by iterating it.
3. **REFACTOR** — confirm the loop still deletes trackable logs / consentTokens as before; typecheck.

## Staged e2e assertion (for the parent to add to scripts/e2e-verify.mjs)

```js
// Retention prune purges location-bearing alerts from finished/aged runs (wave-J / J3).
// After finishing + ageing a run that has an SOS alert (lat/lng), pruneRunNow must
// leave its alerts subcollection empty; a live run's alerts must be untouched.
await triggerSOS({ ownerUid, gameId, runId, lat: 31.77, lng: 35.23, message: 'help' });
// ...finish the run + backdate finishedAt past RUN_DATA_RETENTION_DAYS (or use pruneRunNow directly)...
await callAdmin('pruneRunNow', { ownerUid, gameId, runId });
const alertsAfter = await admin.firestore()
  .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/alerts`).get();
assert(alertsAfter.empty, 'J3: alerts (lat/lng) must be purged by retention prune');
// Control: a DIFFERENT live run's alerts remain (sweep only targets finished/aged runs).
```

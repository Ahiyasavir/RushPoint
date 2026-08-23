# Proposal — fold-slot-release-into-txn

## Why

A station slot is a reservation: `assignTask` increments `run.taskCounts[taskId]` when a task is
handed to a team, and it must be decremented (released) exactly when that team stops holding the
task. If a slot stays incremented with no team holding it, later teams routing to that station
dead-end at `stationsFull` — the documented **station-slot-leak** class (CLAUDE.md; the
`station-slot-leak-fix` and `fix-station-slot-same-team-race` history).

`completeTaskForTeam` was already hardened against this: the **"WO Fix 1"** pattern
(`functions/src/runs/index.ts:751-756`) folds the `taskCounts` decrement **into the same
transaction** that rewrites the team's task records. It reads the run doc inside the txn
(`tx.get(runRef)`, `functions/src/runs/index.ts:781`, all reads before any write) and decrements
each held slot guarded by `counts[id] > 0` in that same commit
(`functions/src/runs/index.ts:1082-1089`). Completion and release therefore commit atomically —
there is no window in which the team is advanced but the slot stays reserved.

**Three other callables still release the slot POST-COMMIT**, through a separate `releaseTask` loop
that runs AFTER the team-doc transaction has already committed:

- `checkOutTask` — team-doc txn returns a `held` boolean, then
  `if (held) await releaseTask(...)` (`functions/src/runs/index.ts:4462-4464`).
- `skipStage` — team-doc txn collects `skippedHeldTaskIds`, then a post-commit
  `for (const id of skippedHeldTaskIds) await releaseTask(...)` (`functions/src/runs/index.ts:1200-1203`).
- `skipTaskForTeam` — team-doc txn collects `releaseIds`, then a post-commit deduped
  `for (const id of [...new Set(releaseIds)]) await releaseTask(...)` (`functions/src/runs/index.ts:1368-1372`).

`releaseTask` (`functions/src/routing/assignNextTask.ts:417-433`) runs its own
`withLockRetry(() => db.runTransaction(...))`. `withLockRetry`
(`functions/src/routing/assignNextTask.ts:265-296`) retries only on contention (code 10 ABORTED / 4 /
13 / 14) with a jittered backoff of `75·(i+1) + rand·300` ms across `attempts = 8`, and on exhaustion
throws a retriable `HttpsError('unavailable')`.

### The concrete lock-storm scenario

1. A run is under sustained run-doc lock contention — e.g. ~20 synchronized teams completing tasks
   at once, the exact burst `withLockRetry` exists to absorb (documented at
   `functions/src/routing/assignNextTask.ts:283-286`; reproduced by `simulate-run.mjs --teams=16`).
2. An operator/checkout path fires: `checkOutTask`, `skipStage`, or `skipTaskForTeam`. Its team-doc
   transaction commits — the team is reverted to `unassigned` / the task is `skipped`.
3. The follow-on `releaseTask` now queues on the same contended run doc. Under the storm its 8
   attempts exhaust and it throws `HttpsError('unavailable')` — **after the team record was already
   reverted/skipped**.
4. `run.taskCounts[taskId]` stays incremented with **no team holding it**. That leaked slot
   permanently dead-ends later teams at `stationsFull`.

This is a genuine instance of the station-slot-leak class, reachable only under a pathological lock
storm on these low-frequency operator/checkout paths — so **P2, plausible, not hot-path**. The exact
same failure mode was designed out of `completeTaskForTeam` by WO Fix 1; these three were left on the
old post-commit shape.

## What Changes

Apply the WO Fix 1 pattern to all three callables:

- Read `runRef` inside each callable's **existing** team-doc `runTransaction` (before any write, per
  the Firestore all-reads-first rule), exactly as `completeTaskForTeam` does at
  `functions/src/runs/index.ts:781`.
- Decrement `taskCounts` for each held slot **inside that same commit**, guarded by
  `counts[id] > 0`, mirroring `functions/src/runs/index.ts:1082-1089`.
- **Delete the post-commit `releaseTask` loop** from each of the three.

Net effect: the release becomes atomic with the team-doc change. There is no window where the team is
reverted/skipped but the slot stays reserved, and no separately-abortable `releaseTask` that can throw
after the fact. The success path is behaviorally identical — the **same slots** are released; only the
failure atomicity improves.

## What does NOT change

- **Identical success-path release semantics.** Each callable releases exactly the slot set it
  releases today: `checkOutTask` → the one assigned slot the team held; `skipStage` → every
  assigned-held slot in the active stage; `skipTaskForTeam` → the skipped task's held slot plus any
  auto-skipped siblings' held slots, deduped. No slot is released that was not released before, and
  none is dropped.
- **No scoring change, no gameplay change.** These paths already write the team's stages/score in
  their transaction; only *when/how* the counter decrement is issued moves (post-commit →
  in-commit). The counter is server-only occupancy accounting, not a scored value.
- **No new callable, no new field, no client/rules change.** `run.taskCounts` already exists and is
  server-write-only; the callables keep their signatures and auth.
- **`completeTaskForTeam` is already done** — this change closes the **last** post-commit-release
  vector in the family; after it, no callable releases a station slot outside the transaction that
  moves the team.

## Impact

- Affected specs: `station-slot-assignment-integrity` (delta authored by this change — same
  capability the sibling `fix-station-slot-same-team-race` change extends).
- Affected code (implementation lane, NOT this authoring lane):
  - `functions/src/runs/index.ts` — `checkOutTask` (`~4442-4464`), `skipStage` (`~1152-1203`),
    `skipTaskForTeam` (`~1279-1372`): read `runRef` in the existing txn, decrement held slots in the
    same commit, delete the post-commit `releaseTask` loop.
- Surfaces touched: functions only. No shared types, no client, no rules.

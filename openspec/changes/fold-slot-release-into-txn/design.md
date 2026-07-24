# Design — fold-slot-release-into-txn

## The decision: mirror WO Fix 1 in all three callables

`completeTaskForTeam` proves the shape. Inside its `withLockRetry(() => db.runTransaction(...))`:

- it reads the run doc alongside the team doc — `const runSnapTx = await tx.get(runRef)` at
  `functions/src/runs/index.ts:781`, with `const counts = runTx?.taskCounts ?? {}` at
  `functions/src/runs/index.ts:796` — all reads before any write, per the Firestore transaction rule;
- after `tx.update(teamRef, ...)`, it decrements the held slots **in the same commit**
  (`functions/src/runs/index.ts:1082-1089`):

```ts
if (heldSlot && (counts[taskId] ?? 0) > 0) {
  tx.update(runRef, { [`taskCounts.${taskId}`]: admin.firestore.FieldValue.increment(-1) });
}
for (const id of skippedHeldTaskIds) {
  if ((counts[id] ?? 0) > 0) {
    tx.update(runRef, { [`taskCounts.${id}`]: admin.firestore.FieldValue.increment(-1) });
  }
}
```

The guard (`counts[id] > 0`) is the identical no-go-negative check `releaseTask` itself uses
(`functions/src/routing/assignNextTask.ts:429`). `FieldValue.increment(-1)` is commutative under
Firestore's serialized conflict resolution, so folding it in loses nothing the standalone
`releaseTask` provided — except the separate, separately-abortable transaction.

The three callables below each already run a team-doc transaction and already compute the exact set of
slots to release. The change is mechanical: read `runRef` in that txn, decrement the same set in the
same commit, delete the post-commit loop.

## Per-callable change

### 1. checkOutTask (`functions/src/runs/index.ts:4428-4466`)

- **Current post-commit release.** The txn returns a boolean `held`
  (`functions/src/runs/index.ts:4442-4462`); after commit, `if (held) await releaseTask(taskId, ctx.ownerUid, ctx.gameId, ctx.runId)`
  (`functions/src/runs/index.ts:4464`).
- **Slot set released:** exactly one — the single in-flight slot `taskId`, released only when the
  team actually held it (`inFlight = team.activeTaskId === taskId || rec?.status === 'assigned'`,
  `functions/src/runs/index.ts:4453`).
- **New in-transaction decrement.** Add `const runRef = db.doc(runPath(ctx.ownerUid, ctx.gameId, ctx.runId))`,
  read it inside the txn (`const counts = (await tx.get(runRef)).data()?.taskCounts ?? {}`, before the
  `tx.update(teamRef, ...)`), and in the `inFlight` branch add
  `if ((counts[taskId] ?? 0) > 0) tx.update(runRef, { [`taskCounts.${taskId}`]: FieldValue.increment(-1) })`.
  Delete the post-commit `if (held) await releaseTask(...)`. (The boolean return may stay or go; the
  release no longer depends on it.)

### 2. skipStage (`functions/src/runs/index.ts:1135-1209`)

- **Current post-commit release.** The txn fills `skippedHeldTaskIds` with every task that was
  `assigned` when the stage was skipped (`functions/src/runs/index.ts:1168`); after commit,
  `for (const id of skippedHeldTaskIds) await releaseTask(id, uid, gameId, runId)`
  (`functions/src/runs/index.ts:1200-1203`).
- **Slot set released:** all assigned-held slots in the active stage.
- **New in-transaction decrement.** Add `const runRef = db.doc(runPath(uid, gameId, runId))`, read it
  at the top of the txn (`const counts = (await tx.get(runRef)).data()?.taskCounts ?? {}`, before the
  `tx.update(teamRef, ...)`), and after that update, loop
  `for (const id of skippedHeldTaskIds) { if ((counts[id] ?? 0) > 0) tx.update(runRef, { [`taskCounts.${id}`]: FieldValue.increment(-1) }); }`.
  Delete the post-commit release loop. Keep the per-attempt `skippedHeldTaskIds = []` reset that
  already opens the txn body (`functions/src/runs/index.ts:1155`) so a transaction retry never
  double-counts.

### 3. skipTaskForTeam (`functions/src/runs/index.ts:1237-1372`)

- **Current post-commit release.** The txn fills `releaseIds` = the skipped `targetId` when
  `plan.heldSlot` (`functions/src/runs/index.ts:1341`) plus `applyStageCompletion`'s
  `heldAssignedTaskIds` (auto-skipped siblings, `functions/src/runs/index.ts:1349-1350`); after
  commit, `for (const id of [...new Set(releaseIds)]) await releaseTask(id, ownerUid, ids.gameId, ids.runId)`
  (`functions/src/runs/index.ts:1370-1372`).
- **Slot set released:** the skipped task's held slot + any auto-skipped siblings' held slots,
  **deduped** (a task that was both the skip target and an auto-skip must release once).
- **New in-transaction decrement.** Add `const runRef = db.doc(runPath(ownerUid, ids.gameId, ids.runId))`,
  read it at the top of the txn (`const counts = (await tx.get(runRef)).data()?.taskCounts ?? {}`,
  before the `tx.update(teamRef, ...)`), and after that update, loop over the deduped ids:
  `for (const id of [...new Set(releaseIds)]) { if ((counts[id] ?? 0) > 0) tx.update(runRef, { [`taskCounts.${id}`]: FieldValue.increment(-1) }); }`.
  Delete the post-commit release loop. Keep the per-attempt `releaseIds = []` reset already at
  `functions/src/runs/index.ts:1288`.

### Read ordering note (Firestore rule)

Each of the three txns currently reads only `teamRef`. Adding a `tx.get(runRef)` is a second read; it
MUST precede every `tx.update` in that txn — the same ordering `completeTaskForTeam` observes
(`functions/src/runs/index.ts:778-781`, both gets before any write). None of the three writes the run
doc before this change, so no reordering of existing writes is needed — only the new `tx.get(runRef)`
must sit with the existing `tx.get(teamRef)`.

## Test strategy (TDD)

These are transactional callables, so the authoritative gate is the emulator-backed **e2e** suite
plus the **simulate** station-counter audit — not a unit test (a `runTransaction` cannot be exercised
in the pure lane).

- **(a) e2e counter-returns-to-0 for checkout and skip.** The existing e2e already asserts the
  success-path counter drains for two of the three:
  - `checkOutTask decremented the station counter to 0` (`scripts/e2e-verify.mjs:6952`);
  - `skip-task: the skipped mission gave its station slot back` (`scripts/e2e-verify.mjs:8550-8552`),
    and the refused-repeat guard `scripts/e2e-verify.mjs:8564-8566`.
  These already pin the success-path release *set* — after the change they must stay green
  (proving the in-transaction decrement releases the same slots). **Add** the missing leg: a
  `skipStage` scenario that reserves a slot (a team holding an `assigned` task in the active stage),
  calls `skipStage`, and asserts `run.taskCounts[held]` returns to 0 — the skipStage path currently
  has an authz-matrix entry (`scripts/e2e-verify.mjs:6561`) but no counter-drain assertion. This
  closes the coverage gap for the third callable.
- **(b) Pure helper (only if cleanly extractable).** If the "collect the held slots to release for a
  skip" logic is worth lifting out of a transaction body (e.g. a `heldSlotsToRelease(stages, ...)`
  pure function), co-locate a `*.test.ts` for it. This is optional and secondary — the slot-set logic
  is already small and inline; do NOT restructure the callables just to create a unit seam. The
  atomicity guarantee is not testable in the pure lane regardless (see (c)).
- **(c) Atomicity is proven structurally, not by fault injection.** `withLockRetry` exhaustion cannot
  be deterministically injected in e2e — the retry loop only aborts under real lock contention, which
  is non-deterministic. The guarantee "the release cannot be dropped after the team is moved" is
  therefore established **structurally** (the decrement is in the same commit as the team update — a
  code-review/read invariant, mirrored on `completeTaskForTeam`) and **empirically** by the
  counter-returns-to-0 audits: `scripts/simulate-run.mjs` asserts every station counter returns to 0
  after N teams play a real game, and the e2e invariant tails assert `taskCounts` drains
  (`scripts/e2e-verify.mjs:5714-5715`, `scripts/e2e-verify.mjs:5592-5593`). No fault-injection test is
  authored, by design.
- **Callable-coverage guard stays green.** All three callables remain invoked by the e2e lifecycle
  and the authz denial matrix (`skipStage` `scripts/e2e-verify.mjs:6561`; `skipTaskForTeam`
  `scripts/e2e-verify.mjs:6627-6629`; `checkOutTask` scenarios at `scripts/e2e-verify.mjs:6228`,
  `scripts/e2e-verify.mjs:6949`), so the coverage guard needs no new EXEMPT entry and no new callable
  is introduced.

## Alternatives considered

- **Retry `releaseTask` harder / forever.** Rejected: it does not remove the window — a process
  death or a still-contended run doc after the team commit still leaks the slot. WO Fix 1 removes the
  window entirely by making the two writes one commit.
- **A sweep/reconciler that recomputes `taskCounts` from team docs.** Rejected as heavier than needed
  for a P2 and out of family with the established idiom; the atomic fold is the minimal, precedented
  change.

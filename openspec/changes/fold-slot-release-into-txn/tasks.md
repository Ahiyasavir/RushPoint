# Tasks — fold-slot-release-into-txn

## 1. RED — pin the success-path release for the third callable

- [ ] 1.1 Add a `skipStage` e2e scenario in `scripts/e2e-verify.mjs`: launch a run, have a team hold
  an `assigned` task in its active stage (assert `run.taskCounts[held] === 1`), call `skipStage`, then
  assert `run.taskCounts[held]` returns to 0 — mirroring the existing checkout assertion at
  `scripts/e2e-verify.mjs:6952` and the skip-task assertion at `scripts/e2e-verify.mjs:8550-8552`.
  This is the coverage leg the third callable currently lacks (it has only the authz-matrix entry at
  `scripts/e2e-verify.mjs:6561`). RED before the change only if the scenario also stresses release
  under contention; otherwise it is the regression guard that must stay green through the change.
- [ ] 1.2 Confirm the existing success-path counter-drain assertions for `checkOutTask`
  (`scripts/e2e-verify.mjs:6952`) and `skipTaskForTeam` (`scripts/e2e-verify.mjs:8550-8552`,
  `:8564-8566`) are present and green — they are the regression guards that prove the folded
  in-transaction decrement releases the identical slot set.

## 2. GREEN — fold the decrement into each callable's transaction

- [ ] 2.1 `checkOutTask` (`functions/src/runs/index.ts:4442-4464`): add `const runRef = db.doc(runPath(ctx.ownerUid, ctx.gameId, ctx.runId))`,
  read `const counts = (await tx.get(runRef)).data()?.taskCounts ?? {}` inside the txn BEFORE the
  `tx.update(teamRef, ...)`, and in the `inFlight` branch add
  `if ((counts[taskId] ?? 0) > 0) tx.update(runRef, { [`taskCounts.${taskId}`]: FieldValue.increment(-1) })`.
  Delete the post-commit `if (held) await releaseTask(...)` at `functions/src/runs/index.ts:4464`.
- [ ] 2.2 `skipStage` (`functions/src/runs/index.ts:1154-1203`): add `const runRef = db.doc(runPath(uid, gameId, runId))`,
  read `counts` at the top of the txn (before the `tx.update(teamRef, ...)`), and after that update
  loop `for (const id of skippedHeldTaskIds) { if ((counts[id] ?? 0) > 0) tx.update(runRef, { [`taskCounts.${id}`]: FieldValue.increment(-1) }); }`.
  Delete the post-commit release loop at `functions/src/runs/index.ts:1200-1203`. Keep the
  `skippedHeldTaskIds = []` per-attempt reset (`functions/src/runs/index.ts:1155`).
- [ ] 2.3 `skipTaskForTeam` (`functions/src/runs/index.ts:1287-1372`): add `const runRef = db.doc(runPath(ownerUid, ids.gameId, ids.runId))`,
  read `counts` at the top of the txn (before the `tx.update(teamRef, ...)`), and after that update
  loop over the deduped ids `for (const id of [...new Set(releaseIds)]) { if ((counts[id] ?? 0) > 0) tx.update(runRef, { [`taskCounts.${id}`]: FieldValue.increment(-1) }); }`.
  Delete the post-commit release loop at `functions/src/runs/index.ts:1370-1372`. Keep the
  `releaseIds = []` per-attempt reset (`functions/src/runs/index.ts:1288`).
- [ ] 2.4 Verify each new `tx.get(runRef)` precedes every `tx.update` in its txn (Firestore
  all-reads-first rule), matching `completeTaskForTeam` (`functions/src/runs/index.ts:778-781`).
- [ ] 2.5 (Optional, only if cleanly extractable) lift a pure `heldSlotsToRelease(...)` helper and
  co-locate a `*.test.ts`; do NOT restructure the callables solely to create a unit seam.

## 3. REFACTOR / verify

- [ ] 3.1 Confirm `releaseTask` (`functions/src/routing/assignNextTask.ts:417-433`) is no longer
  called from any of the three folded paths, and that its remaining callers (if any) are unaffected.
- [ ] 3.2 Update the "released AFTER the transaction" comments on the three callables
  (`functions/src/runs/index.ts:1150-1152`, `:1277-1279`, `:4438-4441`) to describe the new
  in-transaction release, citing WO Fix 1 for symmetry with `completeTaskForTeam`.
- [ ] 3.3 Gates (implementation lane, NOT this authoring lane): `npm run typecheck` · `npm run lint` ·
  `npm test` · `npm run creator:build` · `npm run play:build` · `npm run bundle:budget` ·
  `npm run i18n:check:strict` (no UI change) — green. Then `npm run e2e` under the emulator to
  confirm the checkout/skip counter-drain assertions (incl. the new skipStage leg) pass, and
  `npm run simulate` / `verify:emulator` to confirm every station counter returns to 0.

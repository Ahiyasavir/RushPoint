> **Retroactive artifacts.** The implementation of this change landed before its OpenSpec artifacts
> were written. Tasks 1–4 are checked because the code and tests they describe exist in the tree and
> were run; task 5 is checked as *authored* with its execution status stated inline; task 6 is
> **open** because the gate set has not been run for this change yet. Nothing below is checked on
> the strength of intent.

## 1. RED — the decision rule as failing tests

- [x] 1.1 Create `packages/shared/src/publicTaskBackfill.test.ts` covering *which documents need
      repairing*: a doc with no `coordinates` ⇒ `null` (skipped, so the sweep is idempotent); a doc
      with `coordinates` ⇒ a repair; an **unparseable** `coordinates` value still counts as present
      and is still repaired.
- [x] 1.2 In the same file, cover *what replaces the exact point*: an ordinary placed task ⇒ the
      coarsened cell centre and **not equal** to the authored point (so a pass-through implementation
      fails); `hideLocation` ⇒ `{}`; `locationless`, `(0, 0)` and absent coordinates ⇒ `{}`.
- [x] 1.3 In the same file, cover the **fail-closed** branch — `sourceTask` `null` *and* `undefined`
      ⇒ `{}` — and the stale-area branch: a doc carrying both a legacy point and an `approxLocation`
      whose task is now `hideLocation` ⇒ `{}` with no `approxLocation` key.
- [x] 1.4 Run **only** this test file. Confirm it fails because the module does not exist — not
      because of a typo or an unrelated red already in the tree.

## 2. GREEN — the shared decision rule

- [x] 2.1 Create `packages/shared/src/publicTaskBackfill.ts` exporting `repairPublicTask` plus the
      `BackfillSourceTask` / `BackfillPublicTaskDoc` / `PublicTaskRepair` types, delegating the
      actual location decision to the existing `publicTaskLocation` so the sweep can never drift
      from `publishGame`. Header comment states **why the source task is required** (a `publicTasks`
      doc carries no `hideLocation` / `locationless`) and **why it fails closed**.
- [x] 2.2 Re-export from `packages/shared/src/index.ts`.
- [x] 2.3 Re-run the same test file. Confirm green.

## 3. The sweep (I/O)

- [x] 3.1 Create `functions/src/maintenance/publicTaskBackfill.ts` exporting
      `backfillPublicTaskCoordinates({ limit, startAfter, dryRun })` → `{ scanned, repaired, cleared,
      orphaned, cursor, done }`. Page with `orderBy('__name__')` + `limit` + `startAfter`; header
      comment records **why a scan and not a query** (no field-exists filter in Firestore; the
      `orderBy` trick would need a dedicated index for a job that runs a few times ever; a scan also
      catches malformed values).
- [x] 3.2 Resolve each document's authored task: read `users/{ownerUid}/games/{sourceGameId}` via
      `FIRESTORE_PATHS.game`, **cache one read per game per page**, and recover the task id by
      stripping the `${sourceGameId}_` **prefix** (not `split('_')`, which breaks on task ids
      containing an underscore).
- [x] 3.3 Write with `batch.update(ref, { coordinates: FieldValue.delete(), approxLocation: area ??
      FieldValue.delete() })` — deleting, never nulling, so a repaired doc stops matching the repair
      test and the job converges. Commit nothing when `dryRun`.
- [x] 3.4 Add the admin callable `backfillPublicTaskCoordinatesNow` in
      `functions/src/maintenance/index.ts` behind the existing `assertAdmin` (no emulator bypass),
      passing `limit` / `startAfter` / `dryRun` straight through. Re-export it from
      `functions/src/index.ts`.

## 4. Confirm the rule is wired, not just written

- [x] 4.1 Re-run `packages/shared/src/publicTaskBackfill.test.ts`. Green.
- [x] 4.2 Read the sweep back and confirm every branch of `repairPublicTask` is reachable from it —
      in particular that `orphaned` is counted separately from `repaired`, so an operator can see how
      much of a run took the pessimistic branch.

## 5. e2e coverage for the new callable

- [x] 5.1 Add the `scripts/e2e-verify.mjs` scenario "publicTasks legacy-coordinate backfill (privacy
      sweep, admin-only)": publish a real game with one ordinary and one `hideLocation` task, inject
      the deprecated exact `coordinates` onto both documents with the Admin SDK, then assert —
      `dryRun` writes nothing · both legacy fields deleted · the ordinary task gains an
      `approxLocation` that is not the authored point and is within ~1 km of it · **the
      `hideLocation` task ends up with no location at all and is still listed** · a second sweep
      reports `repaired: 0`.
- [ ] 5.2 <!-- unticked: needs emulator/browser evidence --> Add `backfillPublicTaskCoordinatesNow` to the authz denial matrix so a non-admin caller is
      proven to be denied.
      **Status: authored by a parallel agent and present in the tree — NOT executed.** No emulator
      was started for this change. The suite's callable coverage guard means this scenario is also
      what keeps the new callable from shipping RED, so it is a gate item, not a nicety.

## 6. Gates — OPEN

- [ ] 6.1 `npm run typecheck` — all workspaces green. (`packages/shared` must be rebuilt first;
      consumers of the new export compile against `dist`.)
- [ ] 6.2 `npm run lint` — 0 errors.
- [ ] 6.3 `npm test` — the aggregator + vitest lane, including
      `packages/shared/src/publicTaskBackfill.test.ts`.
- [ ] 6.4 `npm run creator:build` and `npm run play:build`.
- [ ] 6.5 `npm run e2e` — the new scenario runs for the first time, and the **callable coverage
      guard** passes with `backfillPublicTaskCoordinatesNow` invoked.
- [ ] 6.6 `npm run i18n:check` — no UI is touched by this change, so this must be unchanged, not
      merely green.

## UNVERIFIED — must be true before archive

- The e2e scenario from §5 **has never been executed.** Everything it asserts about the callable,
  the batch write and idempotence is unproven against a real emulator.
- The full gate set in §6 has not been run for this change.
- **The sweep has not been run against production.** Shipping the callable closes nothing on its
  own; the exposure is only closed once an operator has walked `cursor` to `done: true` on the real
  project, `dryRun` first.

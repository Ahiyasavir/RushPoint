# Tasks: fix-getmyteamstate-hotpath-writes

## 1. RED
- [x] Add `functions/src/runs/advanceTeamStateOnPoll.test.ts` (vitest) with injected persist/release
      spies: (a) controller + due unlock → persist called once + team advanced; (b) non-controller +
      due unlock → persist NOT called + team still advanced; (c) rejecting persist → helper does not
      throw, onPersistError fires, team still advanced; (d) nothing due → no persist/release. Confirmed
      RED (4 fail — helper did not exist).

## 2. GREEN
- [x] Add `advanceTeamStateOnPoll(...)` to `functions/src/runs/index.ts` (exported) beside
      `computeStageUnlock`/`sweepExpiredInFlight`.
- [x] Rewrite `getMyTeamState` to call it (controller-only + best-effort persist), removing the two
      inline write blocks.
- [x] Unit test passes GREEN (4/4).

## 3. E2E
- [x] In `scripts/e2e-verify.mjs`, add a viewer-poll assertion (in the scheduled-release scenario): a
      viewer device polling across a stage boundary does not advance the persisted team doc, while the
      controller's poll does. Code landed; executed in the combined emulator pass.

## 4. REFACTOR / verify (gates)
- [x] `npm run typecheck` green.
- [x] `npm test` green.
- [x] `npm run lint` green.
- [x] `npm run creator:build` green.
- [x] `npm run play:build` green.
- [x] `npm run e2e` green (scheduled-release + viewer-only-persist assertions passed; 0 failures).

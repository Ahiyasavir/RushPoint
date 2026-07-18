# Tasks: fix-nonfinite-callable-payload

## 1. RED
- [x] Add `scripts/test-sanitize-finite.ts` asserting `sanitizeFinite` maps every non-finite number
      (Infinity/-Infinity/NaN) to `null` at top level, in arrays, and nested; preserves finite
      numbers/strings/bools/null/undefined and a `Date`; and the result `JSON.stringify`s. Confirmed
      RED (helper did not exist).
- [x] Add `functions/src/runs/buildRankings.test.ts` (vitest): a run with a finished team + a
      joined-but-not-started team yields entries whose `durationSeconds`/`totalMinutes` are never
      non-finite and that `JSON.stringify` without throwing. Confirmed RED (3 failures — Infinity leaked).

## 2. GREEN
- [x] Add `packages/shared/src/sanitizeFinite.ts`; export from `packages/shared/src/index.ts`.
- [x] `buildRankings`: gate `durationSeconds`/`totalMinutes` on a finite duration (omit otherwise).
- [x] `loggedCallable`: apply `sanitizeFinite` to the awaited handler result.
- [x] `npm run shared:build`; both tests pass GREEN (sanitize 17/17, buildRankings 7/7).

## 3. E2E
- [x] In `scripts/e2e-verify.mjs`, add a scenario: join a second team without starting it, then assert
      `refreshLeaderboard`, `getMyTeamState`, and `finalizeRun` resolve with no non-finite number
      (recursive `assertAllFinite` helper). Code landed; execution deferred to the batched emulator run.

## 4. REFACTOR / verify (gates)
- [x] `npm run typecheck` green.
- [x] `npm test` green.
- [x] `npm run lint` green.
- [x] `npm run creator:build` green.
- [x] `npm run play:build` green.
- [x] `npm run e2e` green (non-finite scenario passed; 0 failures, E2E_EXIT=0).

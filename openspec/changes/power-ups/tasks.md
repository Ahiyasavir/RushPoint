## 1. Shared roll — RED then GREEN (pure logic, TDD)

- [x] 1.1 RED: `functions/src/__property__/powerUps.property.test.ts` (vitest) asserting `powerUpHash` / `rollPowerUp`: ~6 pinned known vectors (literal triples → expected type/null — the anti-drift contract for the e2e copy); determinism over 1 000 seeded-random triples; award rate 25% ± 2pts over a 20 000 corpus with both types roughly balanced; changing any single input changes the hash. Confirm it fails (module missing).
- [x] 1.2 GREEN: implement `powerUpHash`, `rollPowerUp`, `POWER_UP_RATE`, `POWER_UP_BONUS`, `PowerUpType` in `packages/shared/src/powerUps.ts` (FNV-1a, no deps, no `Math.random`); export from `@rushpoint/shared`. `npm test` → 1.1 passes.

## 2. Shared types
- [x] 2.1 Add `Game.powerUpsEnabled?`, `RunTeam.powerUps?` (`TeamPowerUps`, `PowerUpLogEntry`) with doc comments (sign convention + single-slot rule). `npm run typecheck`.

## 3. Server (functions) — inside the EXISTING transaction only
- [x] 3.1 `updateGame` accepts `powerUpsEnabled` (mirror `allowInstantPlay`).
- [x] 3.2 `completeTaskForTeam` consumption: armed `double_points` doubles a >0 `earnedScore`, extends `scoreBreakdown` with `powerUpMultiplier: 2` (composes after hot-zone), stamps `consumedByTaskId`/`amount` on the log entry, clears `active`; a 0-point task leaves it armed. No new transaction, no new reads.
- [x] 3.3 `completeTaskForTeam` roll: when `powerUpsEnabled && preset !== 'time_only'`, apply `rollPowerUp(runId, teamId, taskId)` — `bonus_points` ⇒ `bonusPenalty -= POWER_UP_BONUS` in the same `tx.update`; `double_points` ⇒ arm the slot, or convert to `bonus_points` if already armed; append the log entry; write `powerUps` as a full object (whole-array log).
- [x] 3.4 `getMyTeamState` returns `powerUps` (verify any team sanitizer passes it through). `npm run typecheck`.

## 4. e2e — deterministic scenario (no new callable)
- [x] 4.1 New `power-ups` scenario in `scripts/e2e-verify.mjs`: embedded FNV roll copy (pinned by the 1.1 vectors); 12-task `fixed_points_speed` game with `powerUpsEnabled:true`; after join, predict the award sequence from `(runId, teamId, taskIds)`; complete all tasks and assert log matches prediction, `bonusPenalty` −15 per bonus, next-task `earnedScore` exactly doubled + `active` cleared per double, duplicate completion is a no-op, invariant oracle + live/final parity green.
- [x] 4.2 Negative controls in the same scenario: flag-absent game never grows `powerUps`; `time_only` game with the flag on never rolls.
- [x] 4.3 `npm run e2e` — green (coverage-guard list unchanged; batch gate).

## 5. creator-web — Builder toggle
- [x] 5.1 "Power-ups" settings checkbox in `BuilderPage.tsx` (default off) wired through the save payload.
- [x] 5.2 creator-web i18n keys (`powerUpsLabel`, `powerUpsHint`) EN + HE.

## 6. play-web — toast + chip
- [x] 6.1 `PlayScreen.tsx`: log-growth toast (ref-compare `powerUps.log.length` across `getMyTeamState` polls) for both award types; "×2 armed" chip near the score while `active === 'double_points'`.
- [x] 6.2 play-web i18n keys (`powerUpDoubleToast`, `powerUpBonusToast`, `powerUpArmedChip`) EN + HE.

## 7. Gates
- [x] 7.1 `npm run typecheck`
- [x] 7.2 `npm run lint`
- [x] 7.3 `npm test`
- [x] 7.4 `npm run creator:build` + `npm run play:build`
- [ ] 7.5 `npm run e2e` (NOT run per instruction — emulator e2e skipped; scenario authored)
- [x] 7.6 `npm run i18n:check` (clean)

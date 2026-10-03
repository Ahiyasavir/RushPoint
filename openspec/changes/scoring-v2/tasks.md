## 1. RED
- [x] 1.1 `scripts/test-scoring-v2.ts` against not-yet-existing `smartMultiplier`, `fieldPaceRatios`,
  `pacePct`, `composeLeaderboardScore`, completed-only `teamExpectedRouteMinutes`. Confirm red.
- [x] 1.2 Property block in `functions/src/__property__/invariants.property.test.ts` for the new curve
  and pace (bounded, finite, monotone); replace the retired `speedBonus` block.

## 2. GREEN — shared
- [x] 2.1 Implement D1/D2/D3 in `packages/shared/src/scoringPresets.ts`; retire the flat path.
- [x] 2.2 Update `scripts/test-scoring-presets.ts`, `scripts/test-task-duration-defaults.ts`,
  `packages/shared/src/scoringPresets.test.ts` to the new contract. Green.

## 3. GREEN — ranking
- [x] 3.1 `buildRankings`: points → completion % → field pace % (finished only) → −bonusPenalty.
- [x] 3.2 e2e: a scenario asserting completion is a percentage (not +500) and that two finishers
  with every estimate ×10 rank and score identically to the unscaled run.

## 4. Copy + gates
- [x] 4.1 Creator preset descriptions (HE/EN) and `PRESET_LABELS`.
- [x] 4.2 typecheck · lint · test · builds · i18n strict · e2e.

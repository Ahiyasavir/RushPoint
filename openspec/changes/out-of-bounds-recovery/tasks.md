## 1. RED — failing tests first

- [x] 1.1 Create `packages/shared/src/safeZoneStatus.test.ts` (vitest, in the house style of the
      existing `packages/shared/src/*.test.ts` files) importing `evaluateSafeZoneStatus` from
      `./safeZone`. Fixtures only — no emulator, no clock reads, no filesystem.
- [x] 1.2 Encode the position cases: centre, inside, well outside, exactly on the radius (inside),
      1 m beyond (outside), 1 m inside (inside) — the boundary offsets computed from the radius, not
      hand-tuned coordinates.
- [x] 1.3 Encode the confidence cases: outside by less than the reported accuracy → `low_confidence`;
      the same position with a tight accuracy → `outside`; accuracy above the trust ceiling → always
      `low_confidence`; zero / missing / negative / NaN accuracy → treated as no widening.
- [x] 1.4 Encode the absence cases: `undefined` fix, `null` fix, fix with absent `lat`/`lng` → `no_fix`;
      `NaN` / `Infinity` coordinates → `invalid_fix` **and no throw**. Assert alongside that
      `isOutsideSafeZone` still throws on NaN (its contract is unchanged).
- [x] 1.5 Encode the time cases: age just under / exactly at / just over `staleAfterMs` for a genuinely
      outside position → `outside` / `outside` / `stale_fix`; unknown age (`atMs` missing or NaN) →
      `stale_fix`; `atMs` in the server's future → `stalenessMs === 0` and the position verdict computed.
- [x] 1.6 Encode the override cases: `overrideUntilMs` in the future beats a fresh confident outside
      fix (`override`); exactly at `nowMs` and in the past do not.
- [x] 1.7 Encode the zone cases: no zone, zero radius, negative radius, NaN radius → `no_zone`
      regardless of position.
- [x] 1.8 Add a totality invariant asserted over a matrix of every fix shape × zone shape: never
      throws, `reason` is always one of the known set, and `outOfBounds === (reason === 'outside')`.
- [x] 1.9 Run `npx vitest run --root packages/shared src/safeZoneStatus.test.ts` and confirm it FAILS
      because `evaluateSafeZoneStatus` does not exist. Record the failure.

## 2. GREEN — the pure evaluator

- [x] 2.1 Add `SafeZoneFix`, `SafeZonePolicy`, `SafeZoneReason`, `SafeZoneStatus`,
      `DEFAULT_SAFE_ZONE_STALE_MS` (5 min), `DEFAULT_MAX_TRUSTED_ACCURACY_M` (200 m) and
      `DEFAULT_OUT_OF_BOUNDS_GRACE_MS` (30 min) to `packages/shared/src/safeZone.ts`. Leave
      `isOutsideSafeZone` and its throwing contract untouched.
- [x] 2.2 Implement `evaluateSafeZoneStatus` with the D2 precedence order — override, no zone, no fix,
      invalid fix, stale fix, low confidence, outside, inside — clamping negative ages to zero and
      requiring `distance - confidence > radius` for a breach.
- [x] 2.3 Re-run the vitest file and confirm GREEN.

## 3. GREEN — server: detection, latch re-evaluation, override

- [x] 3.1 `updateLocation` (`functions/src/index.ts`): accept an optional finite non-negative
      `accuracyMeters`, persist it on the `teamLocations` document, and replace the raw
      `isOutsideSafeZone` call with `evaluateSafeZoneStatus`, passing the team's
      `outOfBoundsOverrideUntil` as the override. Set `outOfBounds` + `outOfBoundsAt` only on a
      verified breach; clear on any non-breach verdict. Keep raising the `safe_zone_breach` alert on a
      genuine crossing even while an override is active.
- [x] 3.2 `requestNextTask` (`functions/src/runs/index.ts`): on the already-flagged path only, read the
      team's last known location and the game's safe zone, re-run `evaluateSafeZoneStatus`, and clear
      the latch + continue to assignment unless the verdict is a verified breach. Leave the happy path
      free of any added read, and leave the `isTestDrive` bypass in place.
- [x] 3.3 Add the `clearTeamOutOfBounds` callable (`functions/src/index.ts`): `assertStaffOrOwner`,
      clears `outOfBounds`, stamps `outOfBoundsOverrideUntil = now + DEFAULT_OUT_OF_BOUNDS_GRACE_MS`,
      writes an audit-log entry, and re-exports from `functions/src/index.ts`'s public surface.
- [x] 3.4 Add `outOfBounds`, `outOfBoundsAt` and `outOfBoundsOverrideUntil` to `RunTeam` in
      `packages/shared/src/types/index.ts` (the first already exists — add the two new optional fields)
      and project `outOfBounds` from `listRunTeams`.

## 4. GREEN — creator run console (the human escape hatch)

- [x] 4.1 Add the `clearTeamOutOfBounds` wrapper to `apps/creator-web/src/services/calls.ts` and
      `outOfBounds` to the `RunTeamRow` type.
- [x] 4.2 Classify `clearTeamOutOfBounds` as a `routine` action in
      `apps/creator-web/src/lib/runConsoleActions.ts` (releasing a stuck player is a safety action, not
      a destructive one) and extend its unit test.
- [x] 4.3 Render, in the teams panel of `RunConsolePage`, an out-of-bounds badge and a release button
      on flagged teams only — static Tailwind classes, logical `ms-*` spacing, an accessible name that
      includes the team name, and a reload of the team list afterwards.
- [x] 4.4 Add the Hebrew AND English strings (`outOfBoundsBadge`, `letBackIn`, `letBackInAria`) to both
      `t.runConsole` dictionaries in `apps/creator-web/src/i18n.ts`. No hardcoded UI text.

## 5. GREEN — participant app reports accuracy (no client authority)

- [x] 5.1 Widen the `updateLocation` wrapper in `apps/play-web/src/services/calls.ts` with an optional
      `accuracyMeters`, and pass `p.coords.accuracy` from the `watchPosition` handler in
      `apps/play-web/src/screens/PlayScreen.tsx`. Do not touch the GPS retry / help / offline code
      owned by the sibling lane, and make no bounds decision on the client.

## 6. RED (written, not run) — e2e

- [x] 6.1 Extend the safe-zone scenario in `scripts/e2e-verify.mjs`: a staff/owner
      `clearTeamOutOfBounds` releases a flagged team and `requestNextTask` assigns again; an out-of-zone
      report during the grace window does not re-latch; a participant calling it is denied. The
      callable-coverage guard requires the new callable to be exercised by some scenario.
- [x] 6.2 Explicitly record that `npm run e2e` was NOT run — a live playtest stack is serving from this
      tree and no emulator may be started. These assertions ship written-but-unrun.

## 7. REFACTOR & gates

- [x] 7.1 Review the evaluator for duplication with `isOutsideSafeZone` / `haversineKm`; reuse rather
      than re-derive, and keep every existing export intact.
- [x] 7.2 Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
      `npm run creator:build`, `npm run i18n:check` and `npm run i18n:check:strict`; all must pass with
      PART B at zero. Record output verbatim.
- [x] 7.3 Run `npx openspec validate out-of-bounds-recovery --strict`.
- [x] 7.4 Record what remains UNVERIFIED (e2e, emulator gates, browser verification of the run-console
      control) and why.

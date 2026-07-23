## 1. RED — failing tests first

- [x] 1.1 Create `scripts/test-enforced-settings.ts` in the house style of
      `scripts/test-game-presentation.ts` (`ok(cond, msg)`, `passed`/`failed`, `process.exit(1)`),
      importing `validateSafeZone`, `SAFE_ZONE_MAX_RADIUS_M`, `validateMinAge`,
      `validateConsentFlag` and `partitionTeamsByConsent` from `@rushpoint/shared`.
- [x] 1.2 Encode every `validateSafeZone` case from the design's Test Strategy, including NaN and
      `Infinity` coordinates, a zero and a negative radius, an absurdly large radius, a missing
      centre, non-object inputs, and the accepted boundary values (`±90`, `±180`, radius `1` and
      exactly `SAFE_ZONE_MAX_RADIUS_M`).
- [x] 1.3 Encode the `validateMinAge` and `validateConsentFlag` cases, including `undefined` meaning
      "no change" rather than an error.
- [x] 1.4 Encode the `partitionTeamsByConsent` cases plus the partition invariant asserted on every
      case (`ready ∪ held === input`, disjoint, order preserved).
- [x] 1.5 Run `npx tsx scripts/test-enforced-settings.ts` and confirm it FAILS for the right reason
      (the new exports do not exist yet). Record the failure verbatim.

## 2. GREEN — pure logic

- [x] 2.1 Add `SAFE_ZONE_MAX_RADIUS_M` and `validateSafeZone` to `packages/shared/src/safeZone.ts`.
      Total, never throws, normalizes an accepted zone to exactly `{ center: { lat, lng },
      radiusMeters }` so unknown keys cannot ride along into the enforcement path.
- [x] 2.2 Add `validateMinAge`, `validateConsentFlag` and `partitionTeamsByConsent` to
      `packages/shared/src/guardianConsent.ts`. `partitionTeamsByConsent` MUST delegate per team to
      the existing `isConsentSatisfied` rather than restating the rule.
- [x] 2.3 Re-run `npx tsx scripts/test-enforced-settings.ts` — all green.

## 3. GREEN — server

- [x] 3.1 `functions/src/games/index.ts` `updateGame`: validate `requiresGuardianConsent`, `minAge`
      and `safeZone` through the new validators before `ref.update(updates)`, throwing
      `invalid-argument` with the validator's error on a malformed value. `undefined` keeps meaning
      "field not sent"; `null` clears the safe zone.
- [x] 3.2 `functions/src/runs/index.ts` `startTeams`: derive the launch set through
      `partitionTeamsByConsent` and return `{ launched, heldForConsent }`. Additive only — `launched`
      keeps its exact current meaning.

## 4. GREEN — creator surface

- [x] 4.1 `apps/creator-web/src/services/calls.ts`: widen the `startTeams` result type with
      `heldForConsent?: number`.
- [x] 4.2 `apps/creator-web/src/pages/RunConsolePage.tsx`: when `heldForConsent > 0`, replace the
      unconditional success toast with a message naming the held count. All copy through `t.*` in
      Hebrew AND English, no em-dashes, no hardcoded strings.
- [x] 4.3 Run `npm run i18n:check:strict` and confirm zero new findings.

## 5. REPORT — e2e assertions for the owning lane (do NOT edit `scripts/e2e-verify.mjs`)

- [x] 5.1 Write up, for the lane that owns the e2e suite: (a) `updateGame` rejects
      `safeZone: { center: { lat: NaN, lng: 0 }, radiusMeters: 100 }` and
      `safeZone: { center: {...}, radiusMeters: 0 }` with `invalid-argument`; (b) `updateGame`
      rejects `minAge: 12.5` and `requiresGuardianConsent: 'yes'`; (c) `updateGame` accepts a valid
      zone and a `null` clear; (d) `startTeams` on a consent-required run returns
      `{ launched: 0, heldForConsent: <teamCount> }`, and after `grantGuardianConsent` a second
      `startTeams` returns `{ launched: 1, heldForConsent: 0 }`.

## 6. REFACTOR / gates

- [x] 6.1 `npm run typecheck`
- [x] 6.2 `npm run lint`
- [x] 6.3 `npm test`
- [x] 6.4 `npm run creator:build`
- [x] 6.5 `npm run play:build`
- [x] 6.6 `npm run i18n:check:strict`

## 7. ESCALATE (not code)

- [x] 7.1 Report to the product owner, plainly: a game with `requiresGuardianConsent` can be created
      today via `importGameFile`, and no participant-side path to satisfy the gate exists. State the
      options (build a consent flow / remove the flag / block the flag at the door) without choosing.
- [x] 7.2 Report that `minAge` is enforced nowhere and must be either enforced or deleted.

---

## 8. RED — wave 2, the derivation before the button

- [x] 8.1 Extend `scripts/test-enforced-settings.ts` with a `suggestSafeZone` section importing
      `suggestSafeZone`, `SAFE_ZONE_MIN_SUGGESTED_RADIUS_M` and `SAFE_ZONE_SUGGESTION_PADDING_M`.
- [x] 8.2 Encode: no stages · empty stages · a non-array · a stage with no tasks · a null stage · a
      task with no coordinates · a locationless task · null island · NaN / Infinity coordinates · an
      out-of-range latitude · a single placed stop (centred on it, at exactly the minimum radius) ·
      several stops across stages, with every stop verified inside the radius by an INDEPENDENT
      haversine · order independence · a continent-wide spread (clamped, `coversAllTasks: false`) ·
      totality over hostile input.
- [x] 8.3 Assert the invariant on every suggestion produced: `validateSafeZone` accepts it, so the
      control can never offer a boundary the server would refuse.
- [x] 8.4 Run `npx tsx scripts/test-enforced-settings.ts` and record the RED failure verbatim.
- [x] 8.5 Extend `scripts/test-game-presentation.ts`: `safeZone` is declared builder-editable,
      reaches the payload, a clear changes the serialization (marks the game dirty), and a clear is
      sent as `null` and never `undefined`. Strengthen the guard itself so the fixture game MUST
      populate every declared field. Record the RED failure verbatim.

## 9. GREEN — wave 2 pure logic

- [x] 9.1 Add `SAFE_ZONE_MIN_SUGGESTED_RADIUS_M`, `SAFE_ZONE_SUGGESTION_PADDING_M` and
      `suggestSafeZone` to `packages/shared/src/safeZone.ts`. Extent midpoint, walking padding,
      minimum floor, round UP, clamp at the maximum, `coversAllTasks` reported. Document why
      `hideLocation` stops are counted here but not by `publicTaskLocation`.
- [x] 9.2 Widen `Game.safeZone` to `SafeZone | null` so a clear has a value of its own.

## 10. GREEN — wave 2 server

- [x] 10.1 `updateGame`: write an explicit `FieldValue.delete()` on a clear. `ignoreUndefinedProperties`
      made the previous `= undefined` a silent no-op, so "remove the play area" left it in force.
- [x] 10.2 `importGameFile`: run `validateSafeZone` / `validateConsentFlag` / `validateMinAge` on the
      parsed file, and store the NORMALIZED boundary so no extra file key rides into the safety path.
- [x] 10.3 `importGameFile`: refuse `requiresGuardianConsent: true` with a message stating that
      consent cannot currently be collected and such a game's teams could never start.

## 11. GREEN — wave 2 creator surface

- [x] 11.1 Register `safeZone` in `BUILDER_EDITABLE_FIELDS` (`apps/creator-web/src/lib/savePayload.ts`).
- [x] 11.2 Add `SafeZoneField` to the Builder's Details step: enable-from-stops, radius input
      validated through the same `validateSafeZone`, refit, and clear (sending `null`).
- [x] 11.3 Bilingual copy through `t.*`, Hebrew and English, no em-dashes, `dir` handled.
- [x] 11.4 Convert `builder.safeZoneRadiusInvalid` and the pre-existing `runConsole.heldForConsent`
      from `{placeholder}` strings to function entries: the creator-web dictionary purity test reads a
      `{token}` inside a Hebrew string as an English word, and `heldForConsent` was already failing
      `npm test` at HEAD because of it.

## 12. REPORT — further e2e assertions for the owning lane (do NOT edit `scripts/e2e-verify.mjs`)

- [x] 12.1 In addition to §5: (e) `updateGame` with `safeZone: null` on a game that HAS a zone leaves
      the stored game with no `safeZone` field at all (the `FieldValue.delete()` path — an assertion
      that would have caught the silent no-op); (f) `importGameFile` refuses a file whose
      `game.safeZone` is `{ center: { lat: NaN, lng: 0 }, radiusMeters: 100 }` and one whose radius is
      `0`, with `invalid-argument`; (g) `importGameFile` refuses a file with
      `requiresGuardianConsent: true` with `failed-precondition`; (h) `importGameFile` of a file whose
      valid `safeZone` carries an extra key stores only `center` + `radiusMeters`.

## 13. Gates — wave 2

- [x] 13.1 `npm run typecheck`
- [x] 13.2 `npm run lint`
- [x] 13.3 `npm test`
- [x] 13.4 `npm run creator:build`
- [x] 13.5 `npm run play:build`
- [x] 13.6 `npm run bundle:budget`
- [x] 13.7 `npm run i18n:check:strict`

## 14. ESCALATE — wave 2

- [x] 14.1 State plainly whether a game with `requiresGuardianConsent` is genuinely unjoinable and
      what the options are, without choosing one.
- [x] 14.2 Recommend `Task.status` live-ops pause/close as the next change, with its shape (a new
      authorized callable, run-console UI, authz row, e2e coverage).

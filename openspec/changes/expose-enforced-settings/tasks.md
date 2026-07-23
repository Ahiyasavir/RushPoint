## 1. RED — failing tests first

- [ ] 1.1 Create `scripts/test-enforced-settings.ts` in the house style of
      `scripts/test-game-presentation.ts` (`ok(cond, msg)`, `passed`/`failed`, `process.exit(1)`),
      importing `validateSafeZone`, `SAFE_ZONE_MAX_RADIUS_M`, `validateMinAge`,
      `validateConsentFlag` and `partitionTeamsByConsent` from `@rushpoint/shared`.
- [ ] 1.2 Encode every `validateSafeZone` case from the design's Test Strategy, including NaN and
      `Infinity` coordinates, a zero and a negative radius, an absurdly large radius, a missing
      centre, non-object inputs, and the accepted boundary values (`±90`, `±180`, radius `1` and
      exactly `SAFE_ZONE_MAX_RADIUS_M`).
- [ ] 1.3 Encode the `validateMinAge` and `validateConsentFlag` cases, including `undefined` meaning
      "no change" rather than an error.
- [ ] 1.4 Encode the `partitionTeamsByConsent` cases plus the partition invariant asserted on every
      case (`ready ∪ held === input`, disjoint, order preserved).
- [ ] 1.5 Run `npx tsx scripts/test-enforced-settings.ts` and confirm it FAILS for the right reason
      (the new exports do not exist yet). Record the failure verbatim.

## 2. GREEN — pure logic

- [ ] 2.1 Add `SAFE_ZONE_MAX_RADIUS_M` and `validateSafeZone` to `packages/shared/src/safeZone.ts`.
      Total, never throws, normalizes an accepted zone to exactly `{ center: { lat, lng },
      radiusMeters }` so unknown keys cannot ride along into the enforcement path.
- [ ] 2.2 Add `validateMinAge`, `validateConsentFlag` and `partitionTeamsByConsent` to
      `packages/shared/src/guardianConsent.ts`. `partitionTeamsByConsent` MUST delegate per team to
      the existing `isConsentSatisfied` rather than restating the rule.
- [ ] 2.3 Re-run `npx tsx scripts/test-enforced-settings.ts` — all green.

## 3. GREEN — server

- [ ] 3.1 `functions/src/games/index.ts` `updateGame`: validate `requiresGuardianConsent`, `minAge`
      and `safeZone` through the new validators before `ref.update(updates)`, throwing
      `invalid-argument` with the validator's error on a malformed value. `undefined` keeps meaning
      "field not sent"; `null` clears the safe zone.
- [ ] 3.2 `functions/src/runs/index.ts` `startTeams`: derive the launch set through
      `partitionTeamsByConsent` and return `{ launched, heldForConsent }`. Additive only — `launched`
      keeps its exact current meaning.

## 4. GREEN — creator surface

- [ ] 4.1 `apps/creator-web/src/services/calls.ts`: widen the `startTeams` result type with
      `heldForConsent?: number`.
- [ ] 4.2 `apps/creator-web/src/pages/RunConsolePage.tsx`: when `heldForConsent > 0`, replace the
      unconditional success toast with a message naming the held count. All copy through `t.*` in
      Hebrew AND English, no em-dashes, no hardcoded strings.
- [ ] 4.3 Run `npm run i18n:check:strict` and confirm zero new findings.

## 5. REPORT — e2e assertions for the owning lane (do NOT edit `scripts/e2e-verify.mjs`)

- [ ] 5.1 Write up, for the lane that owns the e2e suite: (a) `updateGame` rejects
      `safeZone: { center: { lat: NaN, lng: 0 }, radiusMeters: 100 }` and
      `safeZone: { center: {...}, radiusMeters: 0 }` with `invalid-argument`; (b) `updateGame`
      rejects `minAge: 12.5` and `requiresGuardianConsent: 'yes'`; (c) `updateGame` accepts a valid
      zone and a `null` clear; (d) `startTeams` on a consent-required run returns
      `{ launched: 0, heldForConsent: <teamCount> }`, and after `grantGuardianConsent` a second
      `startTeams` returns `{ launched: 1, heldForConsent: 0 }`.

## 6. REFACTOR / gates

- [ ] 6.1 `npm run typecheck`
- [ ] 6.2 `npm run lint`
- [ ] 6.3 `npm test`
- [ ] 6.4 `npm run creator:build`
- [ ] 6.5 `npm run play:build`
- [ ] 6.6 `npm run i18n:check:strict`

## 7. ESCALATE (not code)

- [ ] 7.1 Report to the product owner, plainly: a game with `requiresGuardianConsent` can be created
      today via `importGameFile`, and no participant-side path to satisfy the gate exists. State the
      options (build a consent flow / remove the flag / block the flag at the door) without choosing.
- [ ] 7.2 Report that `minAge` is enforced nowhere and must be either enforced or deleted.

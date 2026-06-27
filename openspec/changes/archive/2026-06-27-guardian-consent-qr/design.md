# Design — Guardian consent via QR

## Current behavior

- `joinRun` registers a team (uid == teamId); `startTeams` launches them. No consent concept exists.
- The 90-day prune clears run PII after finish. Public client routes are query-param based.

## Approach

### Pure helper → `packages/shared/src` (the TDD lever)

```ts
isConsentSatisfied(
  team: { consent?: ConsentRecord },
  runConfig: { requiresGuardianConsent?: boolean }
): boolean
  // true if the run does not require consent, OR the team has a recorded guardian consent.
```

Tested in `scripts/test-guardian-consent.ts`: run not requiring consent → true; requiring + no record
→ false; requiring + record present → true.

### Callables

- `requestGuardianConsent(runId, teamId)` → mints a single-use consent token + link
  (`?consent=<token>`); stores a pending `ConsentRecord` on the team.
- `grantGuardianConsent(token, guardianName)` → validates the token, records
  `team.consent = { guardianName, grantedAt }` (server-side; the child cannot call it for themselves
  in a way that self-approves — the token is delivered out-of-band to the guardian's device).
- `startTeams` (and the play flow) call `isConsentSatisfied` before allowing play on a consent run.

### UI

- Minor on a consent-required run → consent screen with a QR + short link.
- Guardian opens `?consent=<token>` → event/organizer/data-use summary → approve (name + checkbox)
  → `grantGuardianConsent`. The child's screen advances when consent lands.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-guardian-consent.ts`: `isConsentSatisfied` cases.
- **e2e** → on a consent-required run, a team cannot start until `grantGuardianConsent` is called;
  an invalid/used token is refused; a non-consent run starts normally.
- **UI (preview):** consent screen shows QR/link; guardian page approves; child advances.

## Conventions

- Consent is server-enforced (server-write-only state). Tokens single-use. `FIRESTORE_PATHS`.
- `ConsentRecord` follows the 90-day prune (PII). New callables + re-export + wrappers.

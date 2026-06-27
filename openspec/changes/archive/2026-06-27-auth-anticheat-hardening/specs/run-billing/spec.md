# Run Billing

## ADDED Requirements

### Requirement: launchRun is atomic end-to-end
`launchRun` SHALL consume the event credit and write the run document plus its access code within a
single `runTransaction`, so a failure after the charge cannot leave a paid credit consumed with no
run created. `playCount` may remain a best-effort write outside the transaction.

#### Scenario: Post-billing failure rolls back the charge
- **WHEN** the run/accessCode write fails after the credit would be consumed
- **THEN** the transaction rolls back and `wallet.eventCredits` is left unchanged
- **AND** no orphaned run or access code is created

#### Scenario: Successful launch consumes exactly one credit
- **WHEN** `launchRun` completes successfully
- **THEN** one credit is consumed and the run + access code are written together

### Requirement: Referral grants are rate-limited per referrer
`claimReferral` SHALL cap the number of bonus-granting referrals a single referrer can receive within
a window, preventing unbounded free-run farming via throwaway accounts.

#### Scenario: Referral farming past the cap is rejected
- **WHEN** more than the allowed number of fresh accounts name the same referrer within the window
- **THEN** referrals past the cap are rejected and grant no bonus

### Requirement: Pro entitlement requires an unexpired subscription at launch
The `launchRun` Pro branch SHALL treat a creator as Pro only when `proExpiresAt` is null or in the
future, rather than trusting `plan === 'pro'` alone.

#### Scenario: Expired Pro falls through
- **WHEN** `launchRun` runs for a wallet with `{ plan: 'pro', proExpiresAt: <past> }`
- **THEN** the run is not launched as Pro
- **AND** it falls through to the free/credit path (or is refused if no credit)

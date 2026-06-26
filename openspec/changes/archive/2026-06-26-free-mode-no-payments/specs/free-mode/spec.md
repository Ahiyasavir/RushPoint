# Free Mode

## ADDED Requirements

### Requirement: A single flag makes the entire app free
A `PAYMENTS_ENABLED` flag (default false at launch) SHALL govern all billing. When it is false the
app MUST behave as fully free, and when it is true the existing credit/Pro behavior MUST be restored
with no other code change.

#### Scenario: Flag default is free at launch
- **WHEN** the app is built at launch defaults
- **THEN** `PAYMENTS_ENABLED` is false and all billing is off

#### Scenario: Flipping the flag restores billing
- **WHEN** `PAYMENTS_ENABLED` is set to true
- **THEN** the credit/Pro launch logic and Pro gates resume with no other code change

### Requirement: Launching a run is always free when payments are off
With payments off, `launchRun` SHALL never consume a credit, never require Pro, and never refuse for
billing reasons. `resolveLaunchBilling` MUST return a free launch with no wallet consumption.

#### Scenario: Zero-credit free-plan creator can launch
- **WHEN** a creator with 0 credits and a free plan launches a run while payments are off
- **THEN** the run launches successfully with `billingType: 'free'`
- **AND** no wallet read or decrement occurs

#### Scenario: Billing logic preserved when payments are on
- **WHEN** `resolveLaunchBilling` is evaluated with payments on
- **THEN** it returns the existing pro / free-run / credit / refuse outcome

### Requirement: Buying credits or a subscription is disabled when payments are off
`purchaseCredits` and `subscribePro` SHALL reject with a typed "payments disabled" error while
payments are off, and `stripeWebhook` MUST be inert. The billing code MUST remain present (dark), not
deleted.

#### Scenario: Purchase is refused while free
- **WHEN** `purchaseCredits` or `subscribePro` is called while payments are off
- **THEN** it fails with `failed-precondition` and a bilingual "payments disabled" message

#### Scenario: Billing code is retained
- **WHEN** the codebase is inspected
- **THEN** the wallet ledger, Stripe webhook, and billing callables still exist behind the flag

### Requirement: All payment surfaces are hidden when payments are off
While payments are off, the creator app SHALL NOT show the wallet/credits page, pricing, "buy
credits", "upgrade to Pro", or any cost copy, and the participant finish footer MUST drop the upsell.

#### Scenario: No payment UI is rendered
- **WHEN** a creator uses the app while payments are off
- **THEN** no wallet page, pricing, or upsell CTA is visible anywhere

#### Scenario: Finish footer has no upsell
- **WHEN** a participant reaches the finish screen while payments are off
- **THEN** the footer renders without any upgrade/upsell line

### Requirement: Pro-gated features are unlocked for everyone when payments are off
While payments are off, `isFeatureUnlocked` SHALL return true for all features (analytics,
white-label, replay), so every creator has full access with no upsell.

#### Scenario: Pro features open in free mode
- **WHEN** a non-Pro creator opens the analytics dashboard, white-label settings, or replay while payments are off
- **THEN** the feature is fully available with no upsell chip

#### Scenario: Pro gate restored when payments are on
- **WHEN** `isFeatureUnlocked` is evaluated with payments on for a non-Pro wallet
- **THEN** it returns false for Pro-gated features

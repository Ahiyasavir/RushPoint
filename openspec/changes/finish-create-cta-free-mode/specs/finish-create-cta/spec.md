## ADDED Requirements

### Requirement: The finish screen always invites the finisher to create their own game

The participant finish screen SHALL render an on-screen "build your own field game" call-to-action
that links to the creator app, regardless of whether payments are enabled. The CTA's visibility SHALL
NOT depend on `PAYMENTS_ENABLED`.

The CTA SHALL remain hidden only for a Pro (white-label) run (`run.billingType === 'pro'`).

The `?ref=<ownerUid>` referral-reward tag SHALL remain gated on `PAYMENTS_ENABLED`: it SHALL be
appended to the CTA link only when payments are enabled; when payments are off, the CTA SHALL link to
the plain creator URL with no referral tag.

All CTA copy SHALL be localized (Hebrew default) through the existing `final` dictionary keys, with no
new hardcoded UI string.

#### Scenario: A free-mode finisher sees the create CTA

- **WHEN** a participant finishes a run while payments are disabled and the run is not Pro
- **THEN** the "build your own field game" CTA is shown, linking to the creator app with no `?ref` tag

#### Scenario: A Pro run stays white-label

- **WHEN** a participant finishes a Pro (`billingType === 'pro'`) run
- **THEN** no branded create CTA is shown

#### Scenario: The referral reward stays payment-coupled

- **WHEN** a participant finishes a non-Pro run while payments are enabled
- **THEN** the CTA is shown and its link carries the `?ref=<ownerUid>` referral tag, exactly as before

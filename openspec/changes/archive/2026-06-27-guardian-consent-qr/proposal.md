# Proposal — Guardian consent via QR (minors gate)

## Why

A large share of RushPoint's audience is minors (bar-mitzvah groups, youth movements). Running games
for under-age participants without a guardian-consent step is a legal and trust liability (ties to
Appendix B #31 / §26.4). A **QR-based guardian consent** flow — the child scans, a guardian approves
on their own phone before the child can join — is the lowest-friction way to capture verifiable
consent at the event.

## What Changes

> Observable behavior. A consent gate in front of join for minors; new consent callables.

- A creator can mark a game/run as **requiring guardian consent** (with a minimum-age threshold).
- When a minor joins such a run, they reach a **consent-required** state: a QR / short link opens a
  **guardian consent page** on the guardian's device showing the event, organizer, and data-use
  summary; the guardian approves (name + acknowledgement).
- `grantGuardianConsent` records the consent server-side; only then can the child's team **start
  playing**. Consent is **server-enforced** — a client cannot self-approve.
- Consent records follow the existing **90-day PII retention** prune.

## Capabilities

### New Capabilities
- `guardian-consent`: a server-enforced guardian-consent gate (QR/link → guardian approves → child may
  play) for runs that require it, retention-aware.

### Modified Capabilities
<!-- joinRun routes minors on a consent-required run into a pending-consent state instead of active. -->

## Surfaces touched

- **Callables:** new `requestGuardianConsent(runId, teamId)` (issues a consent token/link) and
  `grantGuardianConsent(token, guardianName)` in `functions/src/runs/index.ts`; `joinRun` / `startTeams`
  check consent state when the run requires it.
- **shared:** `Game.requiresGuardianConsent` + `minAge`; `ConsentRecord` type; pure
  `isConsentSatisfied(team, runConfig)` helper — the TDD lever.
- **play-web:** consent-required screen (QR + link); a public `?consent=<token>` guardian page.
- **Tests:** `scripts/test-guardian-consent.ts` (consent-satisfied predicate); e2e for the gate.

## Non-goals

- No hard identity verification of the guardian (acknowledgement-based, as is standard for events).
- No payment/age-verification provider integration.
- No change to the broader minors policy beyond the consent gate (the rest stays with #31/§26.4).

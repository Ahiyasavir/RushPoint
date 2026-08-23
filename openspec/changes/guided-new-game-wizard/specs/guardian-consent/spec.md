## ADDED Requirements

### Requirement: Guardian consent can be enabled at game creation from the age answer

A creator SHALL be able to have guardian consent configured for them at game-creation time,
from the participant age they answer in the new-game wizard, rather than only by editing game
settings afterwards.

When the answered age is below the documented guardian-consent age threshold, the created
game SHALL be given `requiresGuardianConsent: true` together with a `minAge` reflecting the
answered age band. When the answered age is at or above that threshold, the created game
SHALL NOT have guardian consent enabled.

This changes only how the existing fields get set. The consent mechanism itself — the
single-use token minted by `requestGuardianConsent`, the server-side record written by
`grantGuardianConsent`, the pending-consent hold on a minor's team, and the 90-day PII prune
of consent records — is unchanged, and the creator can still change both fields in the
Builder like any other setting.

#### Scenario: A young age band turns consent on

- **WHEN** a creator answers an age band below the guardian-consent age threshold
- **THEN** the created game has `requiresGuardianConsent: true`
- **AND** its `minAge` reflects that band's lower bound

#### Scenario: An adult group does not get consent enabled

- **WHEN** a creator answers an age band at or above the guardian-consent age threshold
- **THEN** the created game does not have guardian consent enabled

#### Scenario: The creator can still override it afterwards

- **WHEN** guardian consent was enabled by the wizard
- **THEN** the creator can turn it off, or change `minAge`, in the Builder's settings

#### Scenario: An unanswered age leaves consent untouched

- **WHEN** the age question is skipped or its value fails `validateMinAge`
- **THEN** the created game is left with the template's own consent configuration, and
  creation still succeeds

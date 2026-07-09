# no-signup-demo Specification

## Purpose
TBD - created by archiving change no-signup-demo. Update Purpose after archive.
## Requirements
### Requirement: Logged-out visitors can build in demo mode
A logged-out visitor SHALL be able to open the Builder in demo mode, pick a template, and edit
stages/tasks fully. All edits MUST be held in local state (localStorage) with no account and no
Firestore write.

#### Scenario: Demo edits persist locally without auth
- **WHEN** a logged-out visitor edits a task in demo mode and refreshes the page
- **THEN** the draft is restored from localStorage and no Firestore write occurred

#### Scenario: Draft serialization round-trips
- **WHEN** `serializeDraft` then `deserializeDraft` is applied to a game
- **THEN** the result equals the original game shape
- **AND** a version-mismatched payload deserializes to null

### Requirement: The signup wall defers to the first save/launch
The first attempt to save, launch, or publish SHALL trigger the signup/login flow. On success the
in-progress demo draft MUST be claimed into the new account via `createGame` + `updateGame`, and the
local draft cleared.

#### Scenario: Save claims the draft into a new account
- **WHEN** a demo user taps Save and completes signup
- **THEN** a game is created and populated from the draft, and the local draft is cleared

#### Scenario: Only a valid draft is claimable
- **WHEN** `isDraftClaimable` is evaluated on an empty or malformed draft
- **THEN** it returns false and no claim is attempted

#### Scenario: Existing-draft import is offered on signup elsewhere
- **WHEN** a visitor signs up through a different entry and a claimable local draft exists
- **THEN** they are offered to import the pending draft


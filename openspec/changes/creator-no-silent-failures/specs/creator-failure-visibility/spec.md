## ADDED Requirements

### Requirement: Every creator-initiated mutation reports its outcome

The system SHALL make the outcome of every creator-initiated mutation perceivable to the creator.
This covers saving game content, launching or ending a run, adjusting a score, publishing standings,
moderating the feed, replying to a team, creating or deleting live-ops objects, and acknowledging an
alert.

A rejection SHALL NEVER be reported only by a console entry, only by the absence of a change on
screen, or not at all. A rejection SHALL NEVER be dropped by an empty catch or an ignoring
`.catch()`.

Background work the creator did not initiate — periodic polls, best-effort counters, local-storage
access — is exempt and SHALL remain silent, so that a failure the creator can act on is never
buried under noise they cannot.

#### Scenario: A rejected mutation is announced

- **WHEN** a mutation the creator started is rejected
- **THEN** the creator is shown a message naming what failed
- **AND** the original error is logged for diagnosis without being rendered

#### Scenario: A succeeded mutation is confirmed

- **WHEN** a mutation the creator started succeeds but produces no visible change of its own
- **THEN** the creator is shown a confirmation that it took effect

#### Scenario: Background work stays quiet

- **WHEN** a periodic refresh or a best-effort counter fails
- **THEN** no message interrupts the creator

### Requirement: Failure messages are actionable and localized

The message shown for a rejection SHALL be drawn from the interface-language dictionaries and SHALL
tell the creator what happened and what they can do about it.

The system SHALL NEVER render to a creator: a raw error message from the server or SDK, an error
code, a stack trace, or an untranslated string.

Every distinguishable failure outcome SHALL have copy in every supported interface language, and no
outcome SHALL fall through to an empty or missing message.

#### Scenario: A permission failure is explained, not coded

- **WHEN** a mutation is rejected because the creator is not permitted or no longer signed in
- **THEN** the message explains the session or permission problem and what to do
- **AND** the message contains no error code and no server text

#### Scenario: An unrecognised failure still says something useful

- **WHEN** a mutation is rejected with an error the system does not recognise
- **THEN** a general, actionable message is shown rather than nothing or a raw value

#### Scenario: Copy exists in every language

- **WHEN** any failure outcome is produced
- **THEN** a non-empty message exists for it in each supported interface language

### Requirement: Failure classification is total and code-based

The system SHALL classify an arbitrary thrown value into exactly one failure outcome, carrying a
message key, a severity, and whether retrying could plausibly succeed.

Classification SHALL be total: any input — an error object with a recognised code, with an
unrecognised code, with no code, a plain error, a string, a number, null, or nothing at all — SHALL
produce a defined outcome and SHALL NOT throw.

Classification SHALL read the error's code only. Free-form message text SHALL NOT influence the
outcome. A code carrying a namespace prefix SHALL classify identically to the same code without it.

Where an error carries no recognised code and the environment reports that the device is offline,
the outcome SHALL be the offline outcome. A recognised code SHALL always take precedence over that
environment hint.

#### Scenario: Prefixed and bare codes agree

- **WHEN** the same failure code is presented with and without its namespace prefix
- **THEN** both produce the same outcome

#### Scenario: Hostile input does not throw

- **WHEN** the classifier receives a string, a number, null, undefined, or an object of unknown shape
- **THEN** it returns a defined outcome without throwing

#### Scenario: Offline is inferred only in the absence of a code

- **WHEN** an error carries no recognised code and the device is reported offline
- **THEN** the outcome is the offline outcome
- **WHEN** an error carries a recognised code and the device is reported offline
- **THEN** the code decides the outcome

### Requirement: Retry is offered only where retrying can help

The classification SHALL mark an outcome retryable only when repeating the same action could
plausibly succeed without the creator changing something first.

A failure caused by missing permission, a lost session, or a request the server refused on its
merits SHALL NOT be marked retryable, and the system SHALL NOT offer a retry affordance for it.

#### Scenario: A transient failure offers retry

- **WHEN** a mutation fails for a transient reason such as an unreachable or overloaded backend
- **THEN** the outcome is marked retryable

#### Scenario: A refused request does not offer retry

- **WHEN** a mutation fails because it was refused on permission, session, or precondition grounds
- **THEN** the outcome is not marked retryable

### Requirement: A failed save of game content is distinct, persistent, and recoverable

The Builder SHALL distinguish, in both its indicator and its wording, between game content that is
waiting to be saved and game content whose save has failed. These two states SHALL NOT share an
indicator colour or a label.

When a save fails the Builder SHALL show a persistent notice that names the reason and SHALL keep
showing it until a save succeeds. The notice SHALL NOT auto-dismiss, because the loss it reports is
discovered late by nature.

When the failure is retryable the notice SHALL offer an explicit retry that re-attempts the save
directly, without requiring the creator to make a further edit to trigger it.

A successful save SHALL clear the notice and return the indicator to its saved state.

#### Scenario: Pending and failed are not confusable

- **WHEN** a save is pending
- **THEN** the indicator differs in colour and wording from the indicator shown after a failed save

#### Scenario: The reason persists until resolved

- **WHEN** a save fails
- **THEN** a notice naming the reason remains visible until a later save succeeds

#### Scenario: Retry without a further edit

- **WHEN** a save has failed for a retryable reason
- **THEN** the creator can re-attempt the save from the notice itself

#### Scenario: A non-retryable save failure offers no retry

- **WHEN** a save fails because the creator's session or permission is the problem
- **THEN** the notice explains that and offers no retry affordance

#### Scenario: Success clears the notice

- **WHEN** a save succeeds after an earlier failure
- **THEN** the notice is removed and the indicator returns to the saved state

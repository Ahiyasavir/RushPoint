# post-game-feedback Specification

## Purpose
A short, playful post-game survey each finished player fills on the finish screen, aggregated into a per-run summary for the creator with drill-down to individual responses.

## Requirements

### Requirement: Finished players get a playful, skippable survey
play-web SHALL present a survey card on the finish screen from the moment the team's own
`status` is `finished` — including while waiting for the host to finalize: one question at a time,
tap-only answers (emoji scales and chips) that auto-advance, a visible progress indicator, a
per-question skip, and a dismiss action for the whole card. The fixed question set covers overall
experience (1–5), content interest (1–5), team bonding (1–5), difficulty fit (1–3), technical
smoothness (1–3, with a multi-select of issue chips when below the top value), likelihood to
recommend (1–5), and one optional free-text field for suggestions/bugs — free text is the ONLY
typing in the flow and comes last. Every answer is optional; submitting sends whatever was
answered. After a successful submission (or a server "already submitted") the card SHALL show a
thank-you state and never re-prompt on that device for that run (persisted locally). All survey
text SHALL live in the HE and EN dictionaries via `t.*`.

#### Scenario: Survey fills the waiting-for-finalize window
- **WHEN** a team finishes but the host has not yet finalized the run
- **THEN** the finish screen shows the survey card alongside the waiting state
- **AND** the player can complete and submit it before the podium ever appears

#### Scenario: Tap-through without typing
- **WHEN** a player answers the six tap questions
- **THEN** each tap advances to the next question automatically with progress shown
- **AND** no keyboard is required unless the player chooses to write the optional comment

#### Scenario: Dismiss and never nag again
- **WHEN** a player dismisses the survey (or completes it) and later reloads the finish screen
- **THEN** the survey card does not reappear for that run on that device

#### Scenario: Hebrew and English both fully localized
- **WHEN** `npm run i18n:check` runs after the UI change
- **THEN** it reports no PART A errors and no new PART B findings

### Requirement: One response per player, written only by the server
A `submitRunFeedback` callable SHALL accept a response from ANY device attached to a team in the
run (controller and viewers alike — feedback is per person, not per team) and store it at the
run-scoped `feedback/{uid}` document (doc id = caller uid) including the caller's team id, team
name, member name when known, answered ratings, issue selections, optional comment, and language.
The callable MUST reject callers whose team (and run) is not finished with `failed-precondition`,
MUST reject payloads with unknown rating keys, out-of-range values, unknown issue codes, an
over-length comment, or no content at all with `invalid-argument`, and MUST treat a repeat
submission as a no-op acknowledged with `already: true` — the stored document never changes after
first write. Firestore rules SHALL deny all client writes to the `feedback` subcollection and
allow reads only to the run owner. The callable SHALL be rate-limited per uid.

#### Scenario: Two phones on one team both count
- **WHEN** the controller phone and an attached viewer phone each submit a response after finishing
- **THEN** two feedback documents exist for that team, keyed by each caller's uid

#### Scenario: Submitting before the finish is rejected
- **WHEN** a player calls `submitRunFeedback` while their team is still racing
- **THEN** the call fails with `failed-precondition` and nothing is stored

#### Scenario: Duplicate submission is a safe no-op
- **WHEN** a player who already submitted calls `submitRunFeedback` again with different answers
- **THEN** the call returns `already: true`
- **AND** the originally stored document is unchanged

#### Scenario: Invalid payloads are rejected
- **WHEN** a submission carries an out-of-range rating value or an unknown issue code
- **THEN** the call fails with `invalid-argument`

#### Scenario: Clients cannot touch the collection directly
- **WHEN** any authenticated client writes to `…/runs/{runId}/feedback/{docId}` or a non-owner reads it
- **THEN** the security rules deny the operation

### Requirement: The creator gets an aggregated summary with drill-down at run end
A `getRunFeedbackSummary` callable SHALL return, to the run owner ONLY (`permission-denied`
otherwise), both the individual responses and a computed summary: response count, participant
count and response rate, per-dimension average + answer count + distribution (averaging only
answered values — a dimension nobody answered is omitted, never NaN), a recommend score (share of
recommend answers of 4 or 5), issue-code counts, and comment count. The aggregation SHALL be a
pure, unit-tested function. The creator Run Console SHALL show a feedback panel that loads this
summary automatically once the run is finished: response rate, per-dimension tiles, difficulty
and smoothness breakdowns, issue chips, and the list of comments with respondent team/name —
selecting a respondent SHALL reveal their complete individual response. An empty state SHALL
explain that players see the survey on their finish screen. All panel text SHALL live in the HE
and EN dictionaries via `t.*`.

#### Scenario: Summary aggregates multiple responses
- **WHEN** two players submitted (overall 5 and overall 3) and the owner calls `getRunFeedbackSummary`
- **THEN** the summary reports `responseCount: 2` and an overall average of 4 with a count of 2
- **AND** both individual responses, with their team names, are in the payload

#### Scenario: Empty and partial data never produce broken math
- **WHEN** the summary is computed with zero responses, or responses that all skipped a dimension
- **THEN** rates and averages contain no NaN values and unanswered dimensions are omitted

#### Scenario: Non-owner is rejected
- **WHEN** a participant or another creator calls `getRunFeedbackSummary` for the run
- **THEN** the call fails with `permission-denied`

#### Scenario: Console shows the summary at game end
- **WHEN** the creator opens the Run Console of a finished run that has responses
- **THEN** the feedback panel loads without a manual trigger and shows response rate, dimension averages, issues, and comments
- **AND** clicking a respondent opens their full response

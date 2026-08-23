## ADDED Requirements

### Requirement: A template copy preserves every authored field

`createGameFromTemplate` SHALL carry the template's authored configuration onto the copy,
not just its stages. At minimum the copy MUST preserve `description`, `mode`,
`scoringPreset`, `scoringOptions`, `registrationFields`, `tags`, `instructions`,
`allowInstantPlay`, `powerUpsEnabled` and `manualLeaderboardReveal`, subject to the
personalization rules below overriding specific fields.

The copy MUST NOT inherit the template's own template markers: `isTemplate`,
`templateEmoji`, `templateOrder`, `templateGroupKey` and `templateLang` SHALL be absent from
the created game, so a creator's copy can never appear in the template picker.

The copy SHALL remain `visibility: 'private'` with `playCount: 0`, a fresh id, the calling
creator as owner, and fresh timestamps.

#### Scenario: Authored operator instructions survive the copy

- **WHEN** a template carrying `instructions` is instantiated
- **THEN** the created game carries the same `instructions`

#### Scenario: A manual leaderboard reveal survives the copy

- **WHEN** a template with `manualLeaderboardReveal: true` is instantiated
- **THEN** the created game also has `manualLeaderboardReveal: true`

#### Scenario: Custom registration fields survive the copy

- **WHEN** a template defines its own registration fields
- **THEN** the created game carries those fields rather than the platform defaults

#### Scenario: The copy is never itself a template

- **WHEN** any template is instantiated
- **THEN** the created game has no `isTemplate` flag and no template picker metadata
- **AND** it does not appear in the new-game template list

### Requirement: The description is a blend, not an appended block

The created game's description SHALL read as one coherent paragraph that weaves the
creator's answers into the template's authored description. It MUST NOT be the template's
description with a details block appended after it.

At least one answer-derived value SHALL appear within the opening sentence. The result SHALL
be a single paragraph containing no blank-line breaks, SHALL be bounded by a documented
maximum length, and SHALL be deterministic — identical answers always produce identical
text. The blended text SHALL be in the same language as the template variant it was built
from.

#### Scenario: Answers appear in the opening sentence

- **WHEN** a game is created from a template with a group size, duration and age answered
- **THEN** the opening sentence of the description contains at least one of those answers

#### Scenario: The template text is not merely prefixed

- **WHEN** the description is blended
- **THEN** the template's original description does not appear as an unmodified contiguous
  prefix followed only by appended detail text

#### Scenario: The blend is deterministic

- **WHEN** the same template and the same answers are blended twice
- **THEN** both results are byte-identical

#### Scenario: A template with no description still yields usable text

- **WHEN** a template carries an empty or missing description
- **THEN** a description is still produced from the answers alone, and nothing throws

### Requirement: Derived tags merge into the template's own tags

Tags derived from the age band and the duration band SHALL be merged with the template's
authored tags through the existing `normalizeTags` helper. The merge MUST preserve the
template's tags, MUST NOT introduce duplicates, and MUST respect the existing `MAX_TAGS`
clamp rather than rejecting the write.

#### Scenario: Template tags are kept and derived tags added

- **WHEN** a template carrying its own tags is personalized
- **THEN** the created game's tags include the template's tags plus the derived age and
  duration tags

#### Scenario: The tag ceiling is respected

- **WHEN** merging would exceed `MAX_TAGS`
- **THEN** the result is clamped to `MAX_TAGS` entries and the creation still succeeds

#### Scenario: Duplicate tags collapse

- **WHEN** a derived tag equals a tag the template already carries
- **THEN** it appears exactly once in the result

### Requirement: Group size changes real station capacity

The answered group size SHALL scale `Task.maxConcurrentTeams` across the copied tasks so
that capacity reflects how many teams will actually be playing, rather than the template
author's assumption.

The scaling SHALL be deterministic and MUST satisfy these invariants:
- a resulting capacity is never below 1;
- a resulting capacity never exceeds the estimated number of teams;
- a task the author marked effectively unlimited (at or above a documented unlimited
  threshold, as locationless and survey tasks are) is left untouched;
- when the estimated team count exceeds a task's authored capacity, the capacity increases
  rather than decreases, so a larger group queues less.

#### Scenario: A small group does not inherit oversized capacity

- **WHEN** the estimated team count is smaller than a task's authored capacity
- **THEN** that task's capacity is reduced, and never below 1

#### Scenario: A large group gets more room at each stop

- **WHEN** the estimated team count exceeds a task's authored capacity
- **THEN** that task's capacity increases, bounded by the estimated team count

#### Scenario: Unlimited tasks stay unlimited

- **WHEN** a task's authored capacity is at or above the unlimited threshold
- **THEN** its capacity is left exactly as authored

### Requirement: A very small group defaults to individual play

The created game's `mode` SHALL default to `individual` rather than `team` when the answered
group size is at or below a documented small-group threshold, because dividing a handful of
people into competing teams is not meaningful. The creator SHALL be able to change this
afterwards in the Builder like any other setting.

#### Scenario: A tiny group plays individually

- **WHEN** the answered group size is at or below the small-group threshold
- **THEN** the created game's mode is `individual`

#### Scenario: A normal group keeps the template's mode

- **WHEN** the answered group size is above the small-group threshold
- **THEN** the created game keeps the mode the template authored

### Requirement: Age sets the game's minimum age

The answered participant age SHALL populate the existing `Game.minAge` field on the created
game, validated by the existing `validateMinAge` helper. An age answer that fails validation
MUST NOT block creation — the field is simply left unset.

#### Scenario: The answered age reaches the game

- **WHEN** a creator answers an age band
- **THEN** the created game's `minAge` reflects that band's lower bound

#### Scenario: An invalid age never blocks creation

- **WHEN** an age value would fail `validateMinAge`
- **THEN** the game is still created, with `minAge` left unset

### Requirement: An over-long game is shortened mechanically, never re-authored

The created game SHALL be shortened by lowering `Stage.requiredTaskCount` on eligible stages
whenever the chosen template's estimated play time exceeds the requested duration. It MUST
NOT be shortened by deleting stages or tasks, and MUST NOT require a separately authored
short variant of the template.

The estimate SHALL be conservative: for each stage, the required number of tasks is counted
using the LONGEST completable tasks, and exclusive groups contribute at most one task each
(matching `maxCompletableTasks`). Task durations come from the existing
`effectiveExpectedDurationMinutes` helper.

A stage SHALL be eligible for trimming only if its author already declared it partial by
setting an explicit `requiredTaskCount`. A stage that leaves the count unset means "complete
every task here", and MUST NOT be trimmed — silently dropping one of its tasks could remove a
narrative template's climax, which the creator would have no way to discover.

Shortening SHALL be deterministic, SHALL repeatedly trim the eligible stage with the largest
current estimated contribution (ties broken by the highest stage order, so later stages are
trimmed before the opening), and SHALL respect these bounds:
- the final stage and the first stage are never trimmed;
- a stage's required count never falls below 1;
- the result always satisfies `requiredTaskCountProblem` — a stage never requires more than
  it can yield;
- a game already within the requested duration is never padded or lengthened.

If the game still overruns after every eligible stage has been trimmed, creation SHALL still
succeed and the creator SHALL be told the game may run longer than requested.

#### Scenario: An over-long game is trimmed to fit

- **WHEN** the template's conservative estimate exceeds the requested duration
- **THEN** required task counts are lowered on eligible stages until the estimate fits

#### Scenario: The opening and final stages are protected

- **WHEN** shortening runs
- **THEN** the first stage and the stage marked `isFinal` keep their required task counts

#### Scenario: A "do everything" stage is never trimmed

- **WHEN** a stage carries no explicit `requiredTaskCount`
- **THEN** shortening leaves it untouched, even if the game still overruns afterwards

#### Scenario: Shortening never makes a stage unwinnable

- **WHEN** shortening has completed
- **THEN** every stage's required task count is at least 1
- **AND** `requiredTaskCountProblem` reports no problem for any stage

#### Scenario: A short-enough game is left alone

- **WHEN** the estimate already fits the requested duration
- **THEN** no stage's required task count changes

#### Scenario: An unfittable game still gets created

- **WHEN** the estimate still exceeds the duration after all eligible trimming
- **THEN** the game is created anyway
- **AND** the creator is told it may run longer than the duration they asked for

### Requirement: Personalization never fails game creation

Every personalization rule SHALL be total: a malformed, missing or out-of-range answer
results in that rule being skipped, never in a thrown error or a refused creation. A creator
MUST always end the guided path holding a game.

#### Scenario: Garbage answers still produce a game

- **WHEN** the personalization inputs are missing, malformed or out of range
- **THEN** the affected rules are skipped
- **AND** a usable game is still created from the template

## ADDED Requirements

### Requirement: The review queue view is a pure, total function

The creator run console SHALL derive its pending photo/audio review queue from a **pure function** of
the submission rows, an injected current time, the set of finished team ids, and the current per-row
failure map. The function SHALL NOT read a clock, perform I/O, or throw for any input, and SHALL be
deterministic for a given current time.

Each returned item SHALL carry a stable key, the elapsed wait in milliseconds and whole minutes, an
urgency tier, whether the submitting team has already finished, and any recorded failure message for
that row.

A missing, empty, unparsable, `NaN`, non-finite or future submission timestamp SHALL resolve to an
unknown wait. An unknown wait SHALL NOT be reported as the most urgent tier, and SHALL NOT produce a
negative elapsed time.

#### Scenario: An empty queue is a legal input
- **WHEN** the view is built from no rows
- **THEN** it returns an empty list and does not throw

#### Scenario: A single pending row is measured
- **WHEN** one row was submitted a known number of minutes before the injected time
- **THEN** the item reports that elapsed wait in whole minutes and the tier that corresponds to it

#### Scenario: Unusable timestamps are quiet, not urgent
- **WHEN** a row carries no submission time, an empty string, an unparsable string, a `NaN` value, or a time in the future relative to the injected time
- **THEN** the view returns without throwing, the elapsed wait is reported as unknown, the elapsed wait is never negative, and the item is not in the most urgent tier

### Requirement: The queue is ordered by who is blocked, totally and stably

The queue SHALL order items so that teams that have not finished precede teams that have finished,
then by longest wait first, then by known wait before unknown wait, then by ascending stable key.

The ordering SHALL be **total and stable**: any two distinct items SHALL have a defined relative
order that does not depend on the order in which they were supplied.

#### Scenario: Equal submission times order deterministically
- **WHEN** two pending rows share the same submission time
- **THEN** they are ordered by their stable key, and the resulting order is identical regardless of the order the rows were supplied in

#### Scenario: Unknown waits sort last
- **WHEN** the queue contains both rows with a usable submission time and rows without one
- **THEN** every row with a usable time precedes every row without one

#### Scenario: A finished team never blocks a playing team
- **WHEN** a submission from a team that has already finished is older than a submission from a team that is still playing
- **THEN** the still-playing team's submission is ordered first, and the finished team's submission is still present in the queue and still reviewable

#### Scenario: Ordering is a fixed point
- **WHEN** the view is rebuilt from its own output, or from a shuffled copy of its input
- **THEN** the sequence of keys is identical

### Requirement: Reviewed and duplicate submissions cannot re-enter the actionable queue

The view SHALL de-duplicate items by their stable `teamId:taskId` key, keeping the first occurrence,
and SHALL exclude any row whose status is not pending.

#### Scenario: The same submission supplied twice yields one item
- **WHEN** the same team and task appear twice in the supplied rows
- **THEN** exactly one item is returned for that key

#### Scenario: An already reviewed submission is excluded
- **WHEN** a supplied row carries an approved or rejected status
- **THEN** it does not appear in the actionable queue

### Requirement: Review decisions are idempotent and refuse impossible transitions

The console SHALL gate every review through a pure decision function that reports whether the call
should be sent, the resulting status, and a machine-readable reason when it should not.

Approving an already approved submission SHALL NOT be sent. Rejecting an already approved submission
SHALL NOT be sent, because the server has no score clawback path. Rejecting an already rejected
submission SHALL NOT be sent.

Applying the same decision twice SHALL have the same result as applying it once, for every starting
status.

#### Scenario: Approving an approved submission sends nothing
- **WHEN** the reviewer approves a submission whose status is already approved
- **THEN** no call is sent and the reason identifies it as already approved

#### Scenario: An approved submission cannot be rejected
- **WHEN** the reviewer rejects a submission whose status is already approved
- **THEN** no call is sent and the reason identifies it as already approved

#### Scenario: Decisions are idempotent
- **WHEN** any decision is applied twice from any starting status
- **THEN** the resulting status equals the status after applying it once

### Requirement: The console surfaces wait time, priority and per-row failure

The pending queue SHALL display, per item, how long that submission has been waiting and an escalating
visual tier, in addition to the submission's wall-clock time. A submission from a team that has
already finished SHALL be labelled as such.

A review that fails SHALL record a **per-row** failure, identified by the team, rendered on that row,
with a retry affordance, and SHALL persist until that row is reviewed successfully. A failed review
SHALL NOT remove the row from the queue and SHALL NOT be reported as a success.

The number of submissions waiting SHALL remain visible while the review panel's group is collapsed.

#### Scenario: A long wait is visible without arithmetic
- **WHEN** a submission has been pending for longer than the overdue threshold
- **THEN** the row states the elapsed wait and is rendered in the most urgent tier

#### Scenario: A failed review is attributable
- **WHEN** a review call fails for one row
- **THEN** that row keeps its place in the queue, shows a failure naming the team, and offers a retry, while other rows are unaffected

### Requirement: The queue is operable from a keyboard without global hotkeys

The pending queue SHALL support moving a roving focus between items and deciding the focused item from
the keyboard. Keyboard handling SHALL be scoped to the queue, so that typing elsewhere in the console
can never trigger a review.

Focus movement SHALL be total: an empty queue, a focus key that no longer exists, and either end of
the list SHALL all resolve without throwing.

#### Scenario: A stale focus key resolves to the front of the queue
- **WHEN** focus movement is requested with a key that is not in the queue
- **THEN** the first item is focused

#### Scenario: Focus does not run off either end
- **WHEN** focus movement is requested past the last item or before the first
- **THEN** focus remains on the last or first item respectively

### Requirement: No batch approval and no unconfigured auto-approval

The console SHALL NOT provide any action that approves more than one submission per explicit human
decision, at any scope. The console SHALL NOT approve any submission that a creator did not configure
for automatic approval and a human did not explicitly act on.

Review authorization SHALL remain staff-or-owner and the server SHALL remain the sole authority on
status and scoring.

#### Scenario: There is no approve-all control
- **WHEN** the review panel is rendered with any number of pending submissions
- **THEN** no control approves more than the single submission it is attached to

### Requirement: The builder states the cost of manual photo review

The task builder SHALL state, at the point where automatic approval is configured, that leaving it off
means every team's submission waits for a person during the run.

#### Scenario: The consequence is visible at build time
- **WHEN** a creator configures a photo submission task
- **THEN** the automatic-approval control is accompanied by an explanation of what happens during the run when it is left off

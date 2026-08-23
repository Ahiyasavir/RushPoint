## ADDED Requirements

### Requirement: The retry lockout is decided by the server against the server clock

The system SHALL decide whether a team is still inside a wrong-answer retry lockout by comparing the
server's current time to a lockout state that the server itself wrote. A participant device's clock
SHALL NOT participate in that decision, and no value supplied by a client SHALL be able to shorten,
extend or skip a lockout.

The decision SHALL be made by a single pure function of `(server now, stored lockout state, policy)`
shared by the answer-submission gate, the participant task payload and the wrong-answer response, so
that the three cannot disagree.

#### Scenario: A skewed device cannot bypass the lockout

- **WHEN** a team whose device clock is hours ahead of the server submits an answer during a lockout
- **THEN** the submission is refused
- **AND** no attempt is recorded and no points are charged

#### Scenario: One decision, three consumers

- **WHEN** the submit gate, the participant task payload and a wrong-answer response are produced
  for the same team, task and instant
- **THEN** all three report the same locked/unlocked verdict and the same remaining time

### Requirement: The participant receives a remaining duration, never an absolute instant

Every value the system sends a participant describing a live retry lockout SHALL be a **remaining
duration**, computed server-side at the moment the response is produced. The client SHALL count that
duration down using only its own clock and SHALL NOT need to interpret a server instant.

The duration SHALL be non-negative and finite in every response.

#### Scenario: A device with a badly wrong clock still counts down correctly

- **WHEN** a team is 15 seconds into a lockout on a device whose clock is six hours behind the server
- **THEN** the participant sees a countdown of the true remaining time
- **AND** the answer controls re-enable when that duration elapses, not six hours later

#### Scenario: A device whose clock runs ahead does not see the lockout end early

- **WHEN** a team is inside a lockout on a device whose clock is six hours ahead of the server
- **THEN** the participant still sees the true remaining time counting down

#### Scenario: Reloading mid-lockout resumes the countdown

- **WHEN** a participant reloads the app while a lockout is running
- **THEN** the participant state carries the remaining duration
- **AND** the countdown resumes from that remaining time rather than restarting or clearing

### Requirement: A lockout is bounded by the policy that created it

The remaining time reported for a lockout SHALL never be negative and SHALL never exceed the maximum
lockout the governing strictness level can produce. A stored lockout state implying a longer wait
SHALL be treated as if it implied exactly that maximum.

The bound SHALL be applied when the lockout is read, so that a lockout state already recorded with
an out-of-range value stops being out of range without any migration step.

#### Scenario: A corrupt far-future lockout self-heals

- **WHEN** a team's stored lockout implies a wait of thirty days at a level whose maximum lockout is
  ninety seconds
- **THEN** the reported remaining time is at most ninety seconds
- **AND** the lockout expires normally instead of locking the team out of the task for the run

#### Scenario: An expired lockout never reports negative time

- **WHEN** a lockout expired long ago
- **THEN** the reported remaining time is zero and the team is not locked

### Requirement: The lockout decision is total and fails open

The lockout decision SHALL produce an explicit verdict for every possible stored state, including
absent, negative, non-finite and wrongly-typed values. Any state from which a lockout cannot be
determined SHALL resolve to **not locked**, because a defect in this decision must never be able to
prevent a team from playing.

The reported remaining time SHALL always be a finite number greater than or equal to zero.

#### Scenario: Malformed stored state does not lock a team out

- **WHEN** a team's stored lockout state is missing, negative, not a number, or infinite
- **THEN** the team is reported as not locked and may answer immediately

#### Scenario: A team with no failures is never locked

- **WHEN** a team has made no wrong attempts on a task
- **THEN** no lockout is reported and no lockout state is required to exist

#### Scenario: A free attempt starts no lockout

- **WHEN** a team gives a wrong answer that falls inside the level's free allowance
- **THEN** no lockout is started and the team may retry immediately

### Requirement: Lockout state written before this change keeps working

The system SHALL continue to honour lockout state recorded before this change, which carries only an
absolute expiry. Such state SHALL neither become permanently locked nor permanently unlocked: it
SHALL still count down and SHALL still expire at its recorded expiry, subject to the policy bound.

The system SHALL keep recording the absolute expiry alongside the new state so that a client running
an older cached bundle continues to behave as it did.

#### Scenario: A legacy lockout still counts down

- **WHEN** a team's stored lockout carries only an absolute expiry still in the future
- **THEN** the team is locked and the reported remaining time is the time until that expiry

#### Scenario: A legacy lockout still expires

- **WHEN** a team's stored lockout carries only an absolute expiry already in the past
- **THEN** the team is not locked

#### Scenario: An older client is not broken

- **WHEN** a participant is running a cached bundle from before this change
- **THEN** the fields that bundle reads are still present in the responses it receives

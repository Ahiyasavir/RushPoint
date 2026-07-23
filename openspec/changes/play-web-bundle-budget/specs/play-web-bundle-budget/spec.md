## ADDED Requirements

### Requirement: Participant entry payload stays within an explicit budget

The system SHALL check the participant app's built output against an explicit, documented byte
budget covering the entry JavaScript chunk (compressed and uncompressed) and the total initial
payload (entry JavaScript plus entry stylesheet, compressed).

A measured value equal to its limit SHALL pass. A measured value greater than its limit SHALL fail.

Compressed sizes SHALL be computed by the check itself with a fixed compression level, so the
result does not depend on a hosting provider's or build tool's default.

#### Scenario: Today's build passes

- **WHEN** the check runs against the current participant build output
- **THEN** every budget check passes and the command exits successfully

#### Scenario: Exactly at the limit

- **WHEN** an asset's measured size equals its budget
- **THEN** that check passes

#### Scenario: One byte over the limit

- **WHEN** an asset's measured size exceeds its budget by one byte
- **THEN** that check fails and the command exits non-zero

#### Scenario: A stylesheet-only increase can exhaust the initial-payload budget

- **WHEN** the entry JavaScript is within its own budget but the sum of entry JavaScript and entry
  stylesheet exceeds the initial-payload budget
- **THEN** the initial-payload check fails

### Requirement: Heavy dependencies are absent from the participant entry chunk

The system SHALL verify, independently of any byte budget, that a named set of heavy dependencies —
the map library, the QR-decoding library and the QR-generation library — does not appear in the
participant app's entry chunk.

A dependency found in the entry chunk SHALL fail the check even when every byte budget passes, and
every offending dependency SHALL be reported, not only the first.

#### Scenario: All heavy dependencies are deferred

- **WHEN** none of the named dependencies appears in the entry chunk
- **THEN** the marker checks pass

#### Scenario: A heavy dependency drifts into the entry chunk

- **WHEN** a named dependency appears in the entry chunk
- **THEN** the check fails, naming that dependency and the chunk it was found in

#### Scenario: Several dependencies drift at once

- **WHEN** more than one named dependency appears in the entry chunk
- **THEN** every one of them is named in the report

#### Scenario: A dependency that was never measured

- **WHEN** the input carries no result at all for a named dependency
- **THEN** that check fails as unmeasured rather than passing silently

### Requirement: The budget decision is a pure total function

The system SHALL decide pass/fail from a pure function of the emitted asset sizes, the dependency
findings and the budget policy — no filesystem access, no clock, no environment.

Every policy entry SHALL produce exactly one check result, and the overall result SHALL be
successful if and only if every check result is successful.

#### Scenario: Every policy entry is decided

- **WHEN** the decision function is given a policy and a set of assets
- **THEN** it returns exactly one check result per policy entry, and the overall outcome equals the
  conjunction of those results

#### Scenario: Decision is reproducible

- **WHEN** the decision function is called twice with the same input
- **THEN** it returns the same outcome and an identical report

### Requirement: An unmeasurable or ambiguous build fails

The system SHALL treat any state in which it cannot make a confident measurement as a failure, never
as a pass.

The system SHALL fail when no asset matches the entry pattern, when more than one asset matches it,
when an asset carries a missing, non-numeric or negative size, and when the built output directory
does not exist.

#### Scenario: No entry chunk emitted

- **WHEN** no asset matches the entry pattern
- **THEN** the check fails and reports which pattern matched nothing

#### Scenario: Ambiguous entry chunk

- **WHEN** more than one asset matches the entry pattern
- **THEN** the check fails and names every matching asset

#### Scenario: Unknown size

- **WHEN** an asset's compressed size is missing or not a valid non-negative number
- **THEN** that check fails as unknown, and the value is never treated as zero

#### Scenario: No build present

- **WHEN** the check runs and the participant app's build output directory does not exist
- **THEN** the command fails and states that the app must be built first

### Requirement: The check reports every measurement

The system SHALL emit a human-readable report listing every check with its name, its measured value,
its limit and the remaining headroom, marking failing checks distinctly, so a failure identifies the
asset, the number and the amount by which it went over without further investigation.

The report SHALL also include the creator app's corresponding measurements for comparison, and the
creator app's sizes SHALL NOT affect the command's exit status.

#### Scenario: Passing run reports headroom

- **WHEN** every check passes
- **THEN** the report lists each check with its measured value, its limit and its remaining headroom

#### Scenario: Failing run identifies the overage

- **WHEN** a budget check fails
- **THEN** the report marks that check as failed and states by how much the measured value exceeded
  the limit

#### Scenario: Creator app is informational only

- **WHEN** the creator app's entry chunk is larger than the participant app's budget
- **THEN** the command still exits successfully if every participant-app check passes

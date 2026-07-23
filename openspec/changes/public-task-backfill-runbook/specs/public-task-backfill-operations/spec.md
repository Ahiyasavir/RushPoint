## ADDED Requirements

### Requirement: The legacy-coordinate sweep is invocable by an operator

The system SHALL provide an operator entry point that runs the stored-public-task repair sweep to
completion from a single documented command, without requiring the operator to write code, use a
test harness, or reach the sweep through a product surface.

The entry point SHALL be reachable as a project script, so that discovering it does not depend on
knowing which file implements it.

#### Scenario: An operator runs the sweep

- **WHEN** an operator runs the documented command
- **THEN** the sweep runs against the declared target and reports what it did

#### Scenario: The sweep is discoverable

- **WHEN** an operator lists the project's scripts
- **THEN** the backfill entry point is among them

### Requirement: Reporting is the default; mutating is an explicit act

The entry point SHALL default to a mode that writes nothing and only reports what it would repair.
Writing SHALL happen only when the operator explicitly asks for it.

An invocation that both asks to write and asks not to write SHALL be rejected as an error, and SHALL
resolve to the non-writing mode rather than choosing between the two.

An invocation whose arguments are invalid for any reason SHALL NOT write, regardless of which
argument was invalid.

#### Scenario: No arguments writes nothing

- **WHEN** the entry point is invoked with no arguments
- **THEN** it runs in reporting mode and no document is written

#### Scenario: Writing requires the explicit flag

- **WHEN** the operator supplies the explicit execute argument
- **THEN** the sweep is allowed to write

#### Scenario: Contradictory arguments stay safe

- **WHEN** the operator asks both to execute and to only report
- **THEN** the invocation is reported as an error and the resolved mode is the non-writing one

#### Scenario: An invalid invocation cannot write

- **WHEN** any argument is invalid
- **THEN** the resolved configuration is the non-writing one

### Requirement: The target is declared before anything happens

The entry point SHALL state its target — whether it is the local emulator or a real project, and the
project identifier — prominently and before performing any work, so that the operator sees what is
about to be swept while it is still possible to abort.

#### Scenario: Target stated up front

- **WHEN** the entry point starts
- **THEN** it prints whether the target is the local emulator or a real project, together with the
  project identifier and the current mode

#### Scenario: A real project is visually distinct

- **WHEN** the target is a real project
- **THEN** the declaration is unmistakably different from the local-emulator declaration

### Requirement: Writing to a non-emulator target requires explicit confirmation of that target

The system SHALL refuse to write to a target that is not the local emulator unless the operator
separately and explicitly confirms that exact target — confirming a different target SHALL NOT
suffice, and omitting the confirmation SHALL NOT be interpreted as consent.

A refusal SHALL happen before any connection is made, and SHALL report a failing exit status.

Confirming a target SHALL NOT, by itself, select that target: selection and confirmation are separate
acts, so that a stray confirmation can never redirect the sweep away from the emulator.

A reporting-only invocation against a real project SHALL NOT require confirmation, because it writes
nothing.

#### Scenario: Unconfirmed write to a real project

- **WHEN** the operator asks to write to a real project without confirming that project
- **THEN** the invocation is refused before connecting, with a failing exit status, and the refusal
  names what would have been required

#### Scenario: Confirmation of a different project

- **WHEN** the operator confirms a project other than the one targeted
- **THEN** the invocation is refused

#### Scenario: Matching confirmation permits the write

- **WHEN** the operator confirms exactly the targeted project and asks to write
- **THEN** the sweep proceeds in writing mode

#### Scenario: A stray confirmation cannot select a target

- **WHEN** the operator supplies a confirmation but does not select a real project
- **THEN** the target remains the local emulator

#### Scenario: Reporting against a real project needs no confirmation

- **WHEN** the operator runs in reporting mode against a real project
- **THEN** the invocation is permitted

### Requirement: Progress is visible while the sweep runs

The entry point SHALL report progress as the sweep proceeds — at minimum, per page: how many
documents were scanned, how many were repaired, and how many were skipped as already conforming —
and SHALL print a final summary of those totals across all pages.

The per-page report SHALL include the position to resume from.

An operator SHALL NOT have to wait until the sweep finishes to know whether it is making progress.

#### Scenario: Per-page progress

- **WHEN** a page of the sweep completes
- **THEN** the scanned, repaired and skipped counts for that page are reported, along with the
  resume position

#### Scenario: Final summary

- **WHEN** the sweep finishes
- **THEN** the accumulated totals across every page are reported

### Requirement: The sweep is resumable and safe to repeat

The entry point SHALL accept a resume position so that an interrupted sweep can continue from where
it stopped rather than restarting.

Re-running the sweep from the beginning SHALL be safe, and a second complete pass over already-swept
data SHALL repair nothing.

When a page fails, the entry point SHALL report the position from which the operator can resume.

#### Scenario: Resuming after an interruption

- **WHEN** the operator supplies a resume position from an earlier invocation
- **THEN** the sweep continues from that position

#### Scenario: A second full pass is a no-op

- **WHEN** the sweep is run to completion twice against the same data
- **THEN** the second run reports zero documents repaired

#### Scenario: A failure tells the operator how to resume

- **WHEN** a page fails
- **THEN** the reported failure includes the position to resume from

### Requirement: The paging loop is bounded and fails loudly

The entry point SHALL treat each page's result as either an unambiguous instruction to continue from
a new position, an unambiguous completion, or a failure. It SHALL NOT infer intent from a malformed
result.

The loop SHALL terminate — and report failure — when the result is not a well-formed response, when
the response does not report success, when its counters are not finite numbers, when its completion
flag is not a boolean, when it is incomplete but supplies no position to continue from, when the
position does not advance, or when a configured maximum number of pages has been reached.

A failing sweep SHALL exit with a non-zero status so that automation can detect it.

#### Scenario: A malformed response aborts

- **WHEN** a page returns something that is not a well-formed successful response
- **THEN** the loop stops and reports failure

#### Scenario: A stalled position aborts

- **WHEN** a page returns the same continuation position as the previous page
- **THEN** the loop stops and reports failure

#### Scenario: An endless server is bounded

- **WHEN** the sweep keeps returning fresh continuation positions and never reports completion
- **THEN** the loop stops once the maximum page count is reached and reports failure

#### Scenario: Failure is detectable by automation

- **WHEN** the sweep fails for any reason
- **THEN** the process exits with a non-zero status

### Requirement: The privileged-access path is documented and minimal

The entry point SHALL obtain the elevated access the sweep requires using the same mechanism the
project's end-to-end suite uses, and SHALL NOT rely on any bypass of the sweep's authorization check.

Elevated access SHALL be scoped to the invocation — no persistent elevated role SHALL be granted to
any account as a side effect of running the sweep.

When the target is a real project, the additional credentials required SHALL be checked before the
sweep begins, and a missing credential SHALL produce an error naming exactly which one is missing.

#### Scenario: Emulator target needs no credentials

- **WHEN** the target is the local emulator
- **THEN** the entry point obtains elevated access without any externally supplied credential

#### Scenario: Missing real-project credential

- **WHEN** the target is a real project and a required credential is absent
- **THEN** the entry point reports which credential is missing and exits with a failing status before
  sweeping

#### Scenario: No persistent privilege

- **WHEN** the sweep completes
- **THEN** no account has been left holding an elevated role because of it

### Requirement: An operator runbook exists alongside the operational docs

The project SHALL document, where its other operational runbooks live, how to run the sweep: the
symptom indicating it is needed, the commands in order for both the local emulator and a real
project, the credentials required, how to resume after an interruption, and how to confirm success.

The success check SHALL state both how to confirm that no exact stored coordinate remains and how to
confirm that the coarse published areas are visible again.

#### Scenario: An operator finds the procedure

- **WHEN** an operator looks in the project's operational documentation
- **THEN** the backfill runbook is there, with the exact commands in order

#### Scenario: Verifying the outcome

- **WHEN** an operator has run the sweep
- **THEN** the runbook tells them how to confirm no exact coordinate remains and how to confirm the
  coarse areas are visible

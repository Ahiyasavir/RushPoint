## ADDED Requirements

### Requirement: The wizard footer weights the step-appropriate action as primary

The TaskWizard footer SHALL present exactly one visually primary action, and it SHALL be the action
appropriate to the current step. On a non-final step the "Next" (advance) control SHALL be the primary
action and the "Done" (finish and close) control SHALL be secondary. On the final step "Done" SHALL be
the primary action.

"Done" SHALL remain reachable and never disabled on every step, preserving the ability to finish a
valid task immediately from any step; only its visual weight changes on non-final steps. "Next" SHALL
keep its existing enablement (enabled only when the current step's required input is present) and its
advance behaviour.

#### Scenario: Non-final step leads with Next

- **WHEN** a creator is on a non-final wizard step
- **THEN** "Next" is the visually primary action and "Done" is shown as a secondary action
- **AND** "Done" is still clickable (revealing any blockers or closing) from that step

#### Scenario: Final step leads with Done

- **WHEN** a creator is on the final wizard step
- **THEN** "Done" is the visually primary action and no "Next" control is shown

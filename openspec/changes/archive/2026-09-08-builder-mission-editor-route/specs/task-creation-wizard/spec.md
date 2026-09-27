# task-creation-wizard Specification (delta)

## MODIFIED Requirements

### Requirement: Wizard opens at step 1 for every new or existing task

When a creator opens a task — by clicking a task tile or the "Add task" tile — the task editor SHALL
open with the wizard at step 1. If the same task is re-opened, the wizard SHALL reset to step 1.

Opening a task is a NAVIGATION, not the raising of a modal: the open task is addressed by the URL
(see the `builder-mission-editor-route` capability), so the platform back affordance dismisses the
editor, and a reload restores it at step 1. Below the `lg` breakpoint the editor presents
full-screen; at `lg` and above it presents as the inline side pane. The wizard's own step content,
step order, validation gating and finish behaviour are unchanged by how it is opened.

#### Scenario: New task opens at step 1

- **WHEN** a creator clicks the "Add task" tile in any stage
- **THEN** the task editor opens with step 1 visible and the wizard progress indicator showing step
  1 of 3

#### Scenario: Existing task re-opens at step 1

- **WHEN** a creator clicks an existing task tile to edit it
- **THEN** the task editor opens at step 1, regardless of the step the wizard was on the last time
  this task was edited

#### Scenario: A restored task also opens at step 1

- **WHEN** a creator reloads the page while a task editor is open
- **THEN** the same task's editor is open at step 1, not at the step it was on before the reload

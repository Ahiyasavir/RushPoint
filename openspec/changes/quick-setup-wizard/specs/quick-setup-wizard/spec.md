## ADDED Requirements

### Requirement: Template setup instructions are structured data, not player-facing content
A game SHALL be able to carry an ordered list of quick setup steps. Each step SHALL declare the
stage and mission it belongs to, the exact field it is about, the instruction the creator is to
follow, and whether that field is required before the game may be launched.

Template content SHALL hold strictly player-facing prose. An instruction addressed to the creator
SHALL NOT be stored in a mission title, description, answer key or any other field a participant can
read.

#### Scenario: A template ships no operator note in player-facing content
- **WHEN** the built-in templates are built
- **THEN** no seeded title, description, answer, survey choice or sequence step prompt contains an
  operator note marker or an "edit this answer" placeholder
- **AND** every instruction that was removed is present as a quick setup step of that template

#### Scenario: A step points at one exact field
- **WHEN** a quick setup step is resolved against its game
- **THEN** the result names the stage, the mission and the single field path the step is about

#### Scenario: Setup steps never reach a participant
- **WHEN** a task is sanitized for a participant, or a game is published to the gallery
- **THEN** no quick setup step and no part of one appears in the result

### Requirement: A step resolves by identity and fails open
A quick setup step SHALL resolve to its target by stage id and mission id when it carries them, and
by positional path only when it does not.

A step that cannot be resolved (its stage or mission no longer exists, or its path is malformed)
SHALL be treated as absent: it SHALL NOT appear in the flow, SHALL NOT be counted as outstanding,
SHALL NOT block a launch, and SHALL NOT raise an error.

#### Scenario: Reordering stages does not re-point a step
- **WHEN** stages are reordered and a step carrying stage and mission ids is resolved
- **THEN** it resolves to the same mission it named before the reorder

#### Scenario: A step naming a deleted mission is inert
- **WHEN** a step names a mission that is no longer in the game
- **THEN** resolving it yields nothing, the flow omits it, and the launch guard ignores it

### Requirement: Quick setup walks the creator through the recommended order
The Builder SHALL offer a quick setup flow whose steps are ordered game level first, then by stage
order, then by mission order within a stage, then by the target field's rank within that mission,
then by the order the steps were authored in.

Field rank SHALL follow five lettered tiers, in this order: (a) the mission's concept — its name and
summary; (b) its details, including any riddle or clue text a player reads; (c) where it happens;
(d) how a player's attempt is verified — the answer, the code, or whether a submission is
auto-approved; (e) advanced settings — hints, scoring, timing, capacity, unlock gates and tags. A
field with no declared rank SHALL sort after every ranked field.

The game's own name SHALL always be the first step of any flow that has at least one other step,
whether or not the template left an explicit note about it.

While a step is active the Builder SHALL present the creator's progress through the flow, copy
describing what to do at that control, and controls to advance, to postpone the step, and to close
quick setup.

#### Scenario: The recommended order is the game name, then stage by stage
- **WHEN** the flow is built for a game whose steps were authored out of order
- **THEN** the game's name is the first step, and mission steps follow in stage then mission order

#### Scenario: A mission is understood before it is placed
- **WHEN** one mission carries steps for both its map pin and its description, authored pin first
- **THEN** the description step comes before the map pin step

#### Scenario: A riddle is written before the pin that answers it
- **WHEN** one mission carries steps for both a location clue and the map pin, authored pin first
- **THEN** the location clue step comes before the map pin step

#### Scenario: An attempt is verified only after its place is set
- **WHEN** one mission carries steps for both a numeric answer and its map pin, authored answer first
- **THEN** the map pin step comes before the numeric answer step

#### Scenario: The game name step appears even without an authored note
- **WHEN** a template's other content produced quick setup steps but never mentioned the game's name
- **THEN** the flow still includes a required step for the game's name, ordered first

#### Scenario: Closing quick setup leaves the game untouched
- **WHEN** quick setup is closed
- **THEN** no field of the game has been changed by closing it, and the flow can be reopened

### Requirement: Quick setup offers itself on a template the creator has not set up
The Builder SHALL offer quick setup unprompted when this creator has no stored record for this game
and at least one of its steps is unconfigured. The offer SHALL be an overlay that changes nothing on
the canvas and SHALL carry a plain option to decline and continue unaided.

The Builder SHALL make that offer at most once per creator per game: once a record exists for the
game, whatever its status, the flow SHALL NOT re-offer itself.

#### Scenario: A freshly cloned template invites the creator in
- **WHEN** a creator opens a game built from a template and has never met quick setup on it
- **THEN** a welcome overlay appears offering to walk them through, with an option to decline

#### Scenario: Declining is remembered
- **WHEN** a creator declines the offer and later reopens the Builder for that game
- **THEN** the offer does not reappear, and the persistent indicator is still available

#### Scenario: A fully configured game is not interrupted
- **WHEN** a creator opens a template-built game whose steps are all configured
- **THEN** no welcome overlay appears

### Requirement: The flow orients the creator before it moves the canvas
Quick setup SHALL present a context card naming the mission it is about to work on, and what players
do there, before any control is focused. It SHALL do so whenever the flow is entered or resumed, and
whenever it advances into a different mission from the one it was on.

Advancing between two fields of the same mission SHALL NOT re-present the card.

While the welcome or context card is shown, the Builder SHALL NOT change the open stage, open a
mission editor, switch editor sections, or focus any control.

#### Scenario: Entering the flow shows context first
- **WHEN** quick setup is opened or resumed
- **THEN** a context card naming the target mission is shown, and no control has been focused

#### Scenario: Moving within one mission does not re-orient
- **WHEN** the creator advances from one field of a mission to another field of the same mission
- **THEN** the next control is focused directly with no context card in between

#### Scenario: The context card cannot be stepped past unseen
- **WHEN** a context card is shown
- **THEN** advancing requires acknowledging it, while postponing the mission remains available

### Requirement: Quick setup speaks in its own voice
Each step SHALL lead with copy written for the control it targets, in the console's language.
A template's authored instruction SHALL be preserved and presented as the template author's note,
subordinate to that copy, and SHALL render with automatic text direction so a template authored in
one language reads correctly in a console set to another.

Every field the flow can target SHALL declare which copy it speaks.

#### Scenario: The template's operational prose is not the headline
- **WHEN** a step carries an authored instruction written for the template's operator
- **THEN** the flow's own line for that control is shown first, and the authored note appears
  beneath it as the template's note

#### Scenario: A mission is described in the creator's own words
- **WHEN** the context card is shown for a mission that already has a description
- **THEN** the card quotes that description, shortened, rather than a generic line

### Requirement: Completing quick setup is acknowledged
When quick setup transitions to complete, the Builder SHALL show a completion moment confirming the
game is ready. It SHALL show it only on that transition, never on merely opening a game whose steps
are already configured.

Decorative motion SHALL be suppressed when the viewer has requested reduced motion.

#### Scenario: Finishing the flow is celebrated
- **WHEN** the creator completes the last outstanding step
- **THEN** a completion moment is shown confirming the game is ready to launch

#### Scenario: Reopening a finished game is not celebrated again
- **WHEN** a creator opens a game whose quick setup was completed earlier
- **THEN** no completion moment is shown

### Requirement: The Builder suppresses distraction while quick setup is active
While the welcome overlay, a context card, or the running step bar is shown, the Builder SHALL hide
its stage navigator and visually de-emphasize its mission canvas, leaving the active mission's editor
(when open) and the quick setup surface as the only fully interactive regions. The de-emphasized
region SHALL NOT be interactive while suppressed.

The active mission editor SHALL NOT be de-emphasized by this behavior.

#### Scenario: The stage navigator is hidden during quick setup
- **WHEN** the welcome overlay, a context card, or the running step bar is shown
- **THEN** the stage navigator is not shown

#### Scenario: The mission canvas is de-emphasized but the open editor is not
- **WHEN** quick setup is running and a mission's editor is open
- **THEN** the mission canvas behind it is visually de-emphasized and not interactive, while the open
  editor remains fully visible and interactive

#### Scenario: Ordinary editing is unaffected once quick setup is closed or finished
- **WHEN** quick setup is closed or has finished
- **THEN** the stage navigator and mission canvas return to their ordinary, fully interactive state

### Requirement: Quick setup text meets WCAG AAA contrast
Every readable text element quick setup renders SHALL meet a contrast ratio of at least 7:1 against
its background in both light and dark themes. Visual de-emphasis between a step's own copy and an
authored template note SHALL be conveyed by size or weight, not by reducing text contrast.

#### Scenario: Welcome and completion copy is fully readable
- **WHEN** the welcome overlay or the completion moment is shown, in either theme
- **THEN** its body text meets at least 7:1 contrast against its background

#### Scenario: A demoted authored note is still fully readable
- **WHEN** a step's authored template note is shown beneath the flow's own headline
- **THEN** the note text meets at least 7:1 contrast against its background, distinguished from the
  headline by size or weight rather than by a lower-contrast color

### Requirement: Activating a step navigates to the exact control and focuses it
Activating a quick setup step SHALL open the stage that holds its mission, open that mission's
editor, select the editor section that owns the target field, expand the collapsed group the field
sits in when there is one, bring the control into view, place focus in it, and highlight that
control.

The highlight SHALL be applied to the target control itself, not to the mission card containing it.

#### Scenario: A field inside a collapsed group is reached
- **WHEN** a step targets a field that lives inside a collapsed optional group
- **THEN** the editor opens on the section that owns the field, that group is expanded, and the
  control receives focus

#### Scenario: An unrecognised field degrades instead of failing
- **WHEN** a step targets a field the Builder has no anchor for
- **THEN** the mission editor still opens and nothing is focused, and no error is raised

### Requirement: A postponed step is remembered and can be resumed
Postponing a step SHALL mark it deferred and move the flow on. The Builder SHALL show a persistent
indicator of how many quick setup fields remain outstanding, and activating that indicator SHALL
resume the flow at the first deferred step that is still unconfigured.

Whether a field is outstanding SHALL be derived from the game's current content, never from a stored
completion flag. A value that is still the template's placeholder SHALL count as unconfigured.

#### Scenario: The outstanding count follows the game, not the flow
- **WHEN** a creator fills a deferred field directly, without using quick setup
- **THEN** the outstanding count drops by one and that step is no longer offered on resume

#### Scenario: A placeholder value is not configured
- **WHEN** a mission's answer is still the template's "edit this answer" placeholder
- **THEN** the step targeting that answer counts as outstanding

#### Scenario: Advancing past the last step returns to deferred work
- **WHEN** the flow advances past its last step while a deferred step is still unconfigured
- **THEN** the flow re-enters that deferred step instead of finishing

#### Scenario: Postponement is remembered per creator and per game
- **WHEN** the same browser is used by two accounts, or for two games of one account
- **THEN** neither shares the other's deferred steps

### Requirement: A launch is blocked while required setup fields are unconfigured
An attempt to launch a game SHALL be refused while any required quick setup step is unconfigured.
The refusal SHALL name every outstanding required field, and each one SHALL be activatable to
navigate straight to that field.

This guard SHALL be additional to the existing launch readiness rules and SHALL NOT change them.

#### Scenario: A half-configured template refuses to launch
- **WHEN** a launch is attempted while a required step is unconfigured
- **THEN** the launch does not proceed and every outstanding required field is listed

#### Scenario: Optional steps never block a launch
- **WHEN** every required step is configured and only optional ones remain
- **THEN** the launch proceeds

#### Scenario: Existing readiness blockers still report first
- **WHEN** a game has both an existing readiness blocker and an outstanding required step
- **THEN** the existing readiness refusal is what the creator is shown

### Requirement: Setup steps survive copying a game
A copy of a game SHALL preserve that game's quick setup steps, whether the copy is made by
instantiating a template, duplicating a game, translating one, or exporting and importing one. Every
stage and mission reference in a copied step SHALL be rewritten to the ids of the copy.

#### Scenario: A game created from a template keeps working steps
- **WHEN** a creator instantiates a template whose missions carry steps
- **THEN** the new game carries the same steps, and each resolves to the corresponding mission of the
  new game

#### Scenario: Saving a game whose mission was deleted still succeeds
- **WHEN** a game is saved after a mission that a step referenced was deleted
- **THEN** the save succeeds and the orphaned step is dropped

### Requirement: The feature is named הקמה מהירה in Hebrew and Quick Setup in English
Every user-facing string for this feature SHALL come from the translation dictionaries and SHALL
name it `הקמה מהירה` in Hebrew and `Quick Setup` in English.

#### Scenario: Both dictionaries carry the same keys
- **WHEN** the quick setup copy is compared across the Hebrew and English dictionaries
- **THEN** neither carries a key the other lacks, the Hebrew values are Hebrew and the English values
  are English

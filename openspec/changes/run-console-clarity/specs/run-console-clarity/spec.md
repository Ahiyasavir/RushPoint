## ADDED Requirements

### Requirement: The console states what needs the organizer right now
The run console SHALL derive, from the run's current counters alone, an ordered list of signals
describing what needs the organizer's attention, and SHALL render that list where it is visible
whatever part of the console the organizer is looking at.

The derivation SHALL be biased to silence: a run with nothing wrong SHALL produce an empty list and
SHALL render nothing at all. A finished run SHALL produce an empty list.

Every signal SHALL name the panel that answers it, and that panel SHALL be reachable in the console's
layout for any state in which the signal fires. The ordering SHALL be total and deterministic, so
the same counters always produce the same list in the same order.

Every counter the derivation reads SHALL be treated as zero when it is absent, is not a number, is
not finite, or is negative, so an incomplete projection produces silence rather than a false alarm.

#### Scenario: A quiet run says nothing
- **WHEN** every counter is zero, teams have joined and every team has started
- **THEN** no signal is produced

#### Scenario: A raised alarm outranks a routine queue
- **WHEN** a team has raised an alert and photo submissions are waiting
- **THEN** the alert signal is ordered before the photo signal

#### Scenario: One queue never occupies two signals
- **WHEN** photo submissions are waiting and some of them are overdue
- **THEN** exactly one photo signal is produced, and it is the overdue one

#### Scenario: A missing counter produces silence
- **WHEN** a counter is absent, is not a number, is not finite, or is negative
- **THEN** it is treated as zero and produces no signal

#### Scenario: Every signal leads somewhere
- **WHEN** any signal is produced for a run state
- **THEN** the panel it names is part of that run's layout, either always on screen or inside
  exactly one section

### Requirement: Every navigation entry states the state of its destination
Each section of the console's navigation SHALL report, without being opened, what is inside it. The
report SHALL be derived from the same single pass over the run state that decides the section's
contents, so a navigation badge and the panel it describes can never disagree.

The mapping from a section to its report SHALL be exhaustive over the closed set of sections, with no
fallthrough, so a section added later cannot ship without a report.

A section SHALL never render a blank report. When a section has nothing else to say, it SHALL report
how many panels it holds.

#### Scenario: Every section reports something
- **WHEN** the navigation is built for a draft, a live and a finished run
- **THEN** every section in every case reports at least one item

#### Scenario: Teams needing attention are visible from the navigation
- **WHEN** teams need attention
- **THEN** the teams section reports how many, without being opened

### Requirement: The navigation keeps its shape while the run is live
The set of navigation destinations SHALL NOT change as work queues fill and empty during a live run.
Handling the last item in a queue SHALL NOT remove the destination the organizer is standing on.

A destination whose queue is empty SHALL render an explicit empty state saying so, rather than
rendering nothing.

#### Scenario: Clearing a queue does not move the organizer
- **WHEN** the photo queue, the chat threads and the photo feed are each empty or full, in any
  combination, on a live run
- **THEN** the list of navigation destinations is identical in every combination

#### Scenario: An empty queue explains itself
- **WHEN** a work queue destination is opened and its queue is empty
- **THEN** the panel states that the queue is empty

### Requirement: The console opens on what the run needs
The section shown when the console opens SHALL be derived from the run's status rather than fixed, so
a finished run opens on its reports and a live run opens on its teams.

When the console cannot show the section that was last selected, it SHALL report why it is showing a
different one, distinguishing a section that has become empty from an absent or unusable stored
selection. It SHALL never leave the console showing nothing while a section exists.

#### Scenario: A finished run opens on the reports
- **WHEN** the console is opened for a finished run with no stored selection
- **THEN** the reports section is shown

#### Scenario: A relocation is explained
- **WHEN** the last selected section is a real section that is not present right now
- **THEN** the resolution reports that the section became empty
- **AND** a different, present section is shown

#### Scenario: An unusable stored selection is not worth a sentence
- **WHEN** the stored selection is absent, empty or not a section identifier
- **THEN** the resolution reports that the default was used

### Requirement: Every control states its consequence
Every control the run console offers SHALL be classified once, in a single table keyed by the closed
set of console actions, declaring who is affected, whether the effect can be undone, whether it must
be confirmed, and the copy that explains it. Adding a control without classifying it SHALL fail the
build.

Any action that is destructive, or that affects every team, or that affects the public, SHALL require
a confirmation that names its effect before it runs.

Releasing a team that the safe-zone latch is holding SHALL remain an unconfirmed, non-alarming
action, because it is the only human escape hatch for a stranded player.

The visual weight of a control SHALL be derived from its classification in one place, so colour
always predicts consequence.

#### Scenario: Starting every team is confirmed
- **WHEN** the organizer starts all teams
- **THEN** a confirmation states that every team's clock starts

#### Scenario: Revealing standings is confirmed
- **WHEN** the organizer makes the standings visible to players
- **THEN** a confirmation states that every player will see them

#### Scenario: Acknowledging an alert is confirmed as irreversible
- **WHEN** the organizer acknowledges an alert
- **THEN** a confirmation states that the alert will not come back

#### Scenario: The safety release stays unscary
- **WHEN** a team is held outside the play area
- **THEN** releasing it needs no confirmation and is not styled as a destructive action

#### Scenario: Every classified action has an explanation in both languages
- **WHEN** the consequence table is walked
- **THEN** every entry's copy key resolves to non-empty text in Hebrew and in English

### Requirement: A shared link that would publish the standings says so first
A share artifact that causes the standings to be published when it is copied or opened SHALL be
marked as such before the organizer acts, and a failure to publish SHALL be reported rather than
swallowed.

An artifact SHALL be marked only when acting on it would actually publish. After the run has ended
the published flag is the organizer's own staged-reveal decision, so no artifact SHALL be marked
then.

#### Scenario: An audience link warns before it publishes
- **WHEN** the share surface is built for a live run
- **THEN** the public board, the ceremony screen and the TV screen are marked as publishing the
  standings
- **AND** the join link, the staff link and the access code are not

#### Scenario: A finished run publishes nothing on share
- **WHEN** the share surface is built for a finished run
- **THEN** no artifact is marked as publishing the standings

### Requirement: A team row fits the device it is read on
The controls on a team's row SHALL be split by a single pure decision into the controls shown
directly on the row and the controls placed behind an overflow affordance.

At most one control SHALL be shown directly on the row. No destructive control SHALL be shown
directly on the row. The safety release SHALL always be shown directly on the row when it applies,
and SHALL never be placed in the overflow. Every control SHALL appear in exactly one of the two
lists.

#### Scenario: A held team's release is immediate
- **WHEN** a team is held outside the play area
- **THEN** the release control is on the row itself
- **AND** the skip and score controls are in the overflow

#### Scenario: An ordinary team row carries no inline control
- **WHEN** a team is playing normally
- **THEN** no control is shown directly on the row
- **AND** every control is reachable through the overflow

### Requirement: Every panel has a name, an explanation and an empty state
Every panel in the console SHALL be catalogued with an icon and with copy for its title, its
explanation and its empty state. The catalogue SHALL be total over the closed set of panels, so a
panel cannot ship unnamed or unexplained.

Titles SHALL carry no decorative characters inside the translated text; the icon SHALL be a property
of the panel, not of the copy.

A panel with nothing to show SHALL render an explicit empty state, and a panel that failed to load
SHALL render a distinguishable failure state, so an empty panel is never mistaken for a broken one.

#### Scenario: Every panel is named and explained in both languages
- **WHEN** the panel catalogue is walked
- **THEN** every panel has non-empty title and explanation copy in Hebrew and in English

#### Scenario: Empty is distinguishable from failed
- **WHEN** a panel has no content and when a panel failed to load
- **THEN** the two render different states

### Requirement: The console never shows a machine identifier where a name belongs
Any value the console renders that came from a stored enumeration or a stored document identifier
SHALL be resolved to human copy. When it cannot be resolved, the console SHALL render a translated
fallback that is visibly a fallback, and SHALL NOT render the raw stored value.

#### Scenario: An unknown enumeration value is not printed raw
- **WHEN** a stored value has no matching label
- **THEN** the translated fallback is rendered
- **AND** the raw value is not rendered on its own

#### Scenario: A holder is shown by name
- **WHEN** a collectible or a captured zone is held by a team
- **THEN** the team's display name is rendered, never its document identifier

### Requirement: Setup artifacts release the primary zone once the run is under way
The always-on-screen zone SHALL rank the join code and the station code sheet first while no team has
joined, and SHALL remove the station code sheet from that zone once a team has joined. The sheet
SHALL remain reachable elsewhere in the console, so nothing becomes unreachable.

#### Scenario: Before anyone joins, the codes lead
- **WHEN** no team has joined
- **THEN** the join card and the station code sheet are in the always-on-screen zone

#### Scenario: Once teams are in, the field takes the space
- **WHEN** at least one team has joined
- **THEN** the station code sheet is no longer in the always-on-screen zone
- **AND** it is still reachable in exactly one section

### Requirement: Per-task analytics are available while the run is live
Per-task completion analytics SHALL be available to the organizer during a live run, not only after
it has ended, because the decision they inform, taking a failing stop out of play, can only be made
while the run is still going.

Reports that read post-run artifacts SHALL remain available only after the run has ended.

#### Scenario: Analytics are reachable mid run
- **WHEN** the console layout is built for a live run
- **THEN** the per-task analytics panel is present

#### Scenario: Post-run reports stay post-run
- **WHEN** the console layout is built for a live run
- **THEN** the run summary, the movement heatmap and the player feedback panels are absent

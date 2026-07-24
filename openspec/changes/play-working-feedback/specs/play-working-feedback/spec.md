## ADDED Requirements

### Requirement: A multi-second wait shows rotating branded messages and an advancing indicator

A multi-second in-game wait SHALL present a branded "working" panel that rotates through a small set
of short RushPoint-voiced status messages and shows an indicator that reads as forward motion,
instead of a single static spinner and one unchanging sentence.

The panel SHALL rotate through 2 to 4 caller-supplied, already-translated messages on a timer, and
SHALL show an advancing left-to-right bar (indeterminate when no real progress is known, determinate
when a progress fraction is supplied). The bar SHALL fill from the reading start to the reading end in
both left-to-right and right-to-left layouts. The panel SHALL announce its current message via an
`aria-live` status region.

The panel SHALL be a pure presentational component with no server call and no new dependency, and its
message rotation SHALL be governed by a pure helper that, given a tick and a message count, returns
which message index is shown — total for any tick value and always within range.

#### Scenario: A slow route shows a talking, advancing panel

- **WHEN** the participant app waits multiple seconds for the next mission to be assigned
- **THEN** the panel cycles through the branded status messages and its bar advances toward the
  reading end rather than sitting as a chasing ring

#### Scenario: The message index helper is total and in range

- **WHEN** the rotation helper is called with a message count of 3 across ticks 0,1,2,3
- **THEN** it returns 0,1,2,0 respectively, and for a count of 0 or 1 it always returns 0, and a
  negative or very large tick still returns an index within range

### Requirement: Reduced motion shows a static message instead of rotating animation

Under a reduced-motion preference the working panel SHALL fall back to a static presentation: it SHALL
show only the first message without cycling, and its bar SHALL not run the sweeping animation.

The reduced-motion fallback SHALL still convey the same information (the first branded status message
and the aria-live status region), so a participant who prefers reduced motion still gets a legible,
non-empty wait state.

#### Scenario: Reduced-motion participant waits for the next mission

- **WHEN** the participant has `prefers-reduced-motion: reduce` set and a multi-second wait begins
- **THEN** the panel shows the first branded message statically, does not rotate the messages, and the
  bar does not sweep

### Requirement: The status and success copy is bilingual and routed through the dictionary

Every branded status string introduced for the working panel SHALL be defined in both the Hebrew and
the English play-web dictionaries and SHALL be rendered through the translation layer, never
hardcoded in a component.

The Hebrew copy SHALL be natural Hebrew and the English copy SHALL be English, and neither SHALL use
an em-dash. The keys `task.workingChecking`, `task.workingLocating` and `task.workingPrepping` SHALL
exist in both dictionaries.

#### Scenario: The app is in Hebrew

- **WHEN** the participant app language is Hebrew and the working panel is shown
- **THEN** the rotating messages render in Hebrew from the Hebrew dictionary, not in English

#### Scenario: The app is in English

- **WHEN** the participant app language is English and the working panel is shown
- **THEN** the rotating messages render in English from the English dictionary

### Requirement: A confirmed-correct answer produces a success beat, not a silent swap

A server-confirmed task success SHALL fire the existing mute-gated celebratory cue (sound and success
haptic) once, so a correct answer is acknowledged before the card advances to the next-mission wait
instead of swapping silently.

The cue SHALL fire only on a server-confirmed success and SHALL NOT fire on a wrong answer or for a
viewer/readonly device. When sound is muted the cue SHALL produce no sound and no vibration. The
change SHALL reuse the existing cue and SHALL NOT introduce a new sound.

#### Scenario: A correct answer is acknowledged

- **WHEN** the server confirms a task is completed correctly and sound is enabled
- **THEN** the existing task-success cue fires once and the wait panel then takes over with its
  advancing indicator

#### Scenario: A wrong answer stays silent

- **WHEN** an answer is rejected as incorrect
- **THEN** the success cue does not fire

#### Scenario: Muted player completes a task

- **WHEN** the server confirms a task success and the participant has sound muted
- **THEN** neither the sound nor the haptic fires

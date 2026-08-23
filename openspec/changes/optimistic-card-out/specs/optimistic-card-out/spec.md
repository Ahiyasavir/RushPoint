## ADDED Requirements

### Requirement: A confirmed-correct answer animates the current task card out before advancing

On a server-confirmed task success the current task card SHALL play a brief exit animation — a slide
toward the reading end plus a fade — and then the run SHALL advance to the next phase, so a correct
answer shows forward motion at the start of the transition instead of a static card sitting until the
next mission loads.

The card-out SHALL fire only on a server-confirmed success and SHALL NOT fire on a wrong answer, on a
mid-task sequence step, on a hidden-task arrival unlock, or for a viewer/readonly device. The exit
SHALL move the card toward the reading end in both left-to-right and right-to-left layouts. The change
SHALL introduce no new dependency and SHALL add no user-visible copy.

#### Scenario: A correct answer animates the card out then advances

- **WHEN** the server confirms a task is completed correctly on an interactive (non-readonly) device
- **THEN** the current task card slides toward the reading end and fades, and then the run advances to
  the next-mission phase

#### Scenario: A wrong answer or a viewer device shows no card-out

- **WHEN** an answer is rejected as incorrect, or the device is a viewer/readonly device
- **THEN** the task card does not play the exit animation and the existing wrong-answer / read-only
  behavior is unchanged

### Requirement: Reduced motion advances instantly with no animation

Under a reduced-motion preference a confirmed-correct answer SHALL advance to the next phase
immediately with no exit animation applied to the card, matching the behavior the app had before this
change.

The reduced-motion decision SHALL be governed by a pure helper that, given whether reduced motion is
preferred, returns whether to animate and a bounded delay before advancing: reduced motion SHALL
return no animation and a zero delay, and otherwise SHALL return a short bounded delay.

#### Scenario: A reduced-motion player completes a task

- **WHEN** the participant has `prefers-reduced-motion: reduce` set and answers correctly
- **THEN** the run advances immediately, no exit class is applied, and no slide or fade plays

#### Scenario: The exit-decision helper is bounded and total

- **WHEN** the exit-decision helper is called with reduced motion true and with reduced motion false
- **THEN** the true case returns no animation and a zero delay, and the false case returns an
  animation and a small strictly-positive bounded delay, without throwing for either input

### Requirement: The next task always appears even if the exit animation is interrupted

Progression to the next phase SHALL NOT depend on any animation or transition completion event. The
run SHALL advance via a bounded timer (or an immediate call under reduced motion), so a failed,
skipped, janky, or interrupted card-out animation can never prevent the next task from appearing or
strand the player.

The advance callback SHALL run at most once per submission, the pending timer SHALL be cleared if the
component unmounts, and the delay before advancing SHALL always be a small bounded value, never
derived from an animation event and never unbounded.

#### Scenario: The exit animation is interrupted but the run still advances

- **WHEN** a correct answer starts the card-out animation and the animation is dropped or never
  completes (for example the browser skips it or the tab is backgrounded)
- **THEN** the bounded timer still fires, the run advances to the next phase, and the player is not
  stranded on the completed task

#### Scenario: The player navigates away mid-exit

- **WHEN** the component unmounts while a card-out timer is pending
- **THEN** the pending timer is cleared, the advance callback does not fire a second time, and no
  error occurs

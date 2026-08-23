# Proposal — mobile-task-type-sample-icon

## Why

The TaskWizard's task-type picker (`TaskWizard.tsx:849-876`) lays out task
types in a `grid grid-cols-3`; each type button reserves `pe-11` (44px) at
its end for an overlaid "load sample" (✨) icon button. The reserved zone is
correctly sized, but the actual button inside it is `w-4 h-4` — **16px** —
positioned right against the edge of the larger, primary type-selection
button in a 3-column grid that is already tight at 375px width. A finger
aiming for the 16px sample icon can easily land on the adjacent type button
instead (or vice versa), and choosing the wrong task type is exactly the
kind of silent, easy-to-miss error described elsewhere in this app's own
"gotchas" (a wrong selection that looks like it worked).

## What Changes

- The sample-icon button grows from `w-4 h-4` (16px) to a real touch target
  (`w-6 h-6`, 24px).
- The type button's reserved end-padding grows `pe-11` (44px) → `pe-12`
  (48px) to hold the now-wider overlay without covering the type label.
  *(Measured during verification: the overlay is `sample + gap-0.5 +
  RichTooltip` and sits at `end-1`, so it needs `4 + 24 + 2 + 16 = 46px`.
  At the original `pe-11` an initial 28px icon overflowed the reserve and
  covered two of the nine type labels — see design.md §3.)*
- No change to the type grid's column count, the `RichTooltip` trigger, or
  the sample-picker dropdown that opens beneath it.

## Non-goals

- Does not redesign the 3-column type grid or its breakpoints.
- Does not change which task types offer a sample or the sample-picker
  dropdown's own behavior/positioning.
- Does not touch the general `dense` field-density pass
  ([[mobile-taskwizard-density]]) — this is one specific undersized control,
  not the step's overall spacing.

## Surfaces touched

`apps/creator-web` only (`TaskWizard.tsx`). No callable, no shared type.

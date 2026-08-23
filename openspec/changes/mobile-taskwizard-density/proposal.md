# Proposal — mobile-taskwizard-density

## Why

`ui.tsx`'s `dense` variant of `Input`/`Textarea` (`px-2.5 py-1.5 text-[13px]`,
`ui.tsx:78-93`) is used throughout the TaskWizard's Details/Execution steps
so a form of many small fields fits without scrolling (the file's own
comment states this intent explicitly). At `py-1.5` (6px top+bottom) with a
13px font, the rendered row height is ~30px — noticeably tighter than even
the non-dense 40px baseline, on the step of the Builder with the highest
field density per screen. This compounds with
[[mobile-touch-target-baseline]] and [[mobile-task-type-sample-icon]] to make
the wizard's body feel like a squeezed desktop form rather than a
mobile-considered one.

This is a narrower, more careful change than simply "make dense not dense" —
the density is a deliberate, documented tradeoff (fit many fields without
scrolling), and text INPUTS are lower touch-target risk than buttons: a
mis-tap mostly just focuses the wrong field (recoverable via the keyboard's
own next/prev, not a silent wrong action), unlike a mis-tapped button or
`<select>`. So the fix nudges the floor up without matching the 44px
guideline used for tappable controls.

## What Changes

- `dense` `Input`/`Textarea` vertical padding: `py-1.5` → `py-2` (a ~5-6px
  per-field height increase, keeping the 13px font and horizontal padding
  unchanged). `Select` has no `dense` variant and TaskWizard does not use
  `<Select>` at all — its type/mode pickers are custom button-toggle groups,
  out of scope here (see Non-goals).

## Non-goals

- Does not change the non-dense `Input`/`Textarea` used elsewhere in the
  app — only the `dense` variant.
- Does not touch TaskWizard's custom button-toggle rows (quiz grading mode,
  trigger mode, the task-type grid, etc. — `TaskWizard.tsx:200,591,718,861,1296`)
  — those are tappable controls, not text fields, and are covered by the
  already-scoped [[mobile-touch-target-baseline]] /
  [[mobile-task-type-sample-icon]] changes where they were found to be a
  real problem; broadening this change into every `py-1.5` button in the
  wizard would outgrow "keep tasks small."
- Does not remove field density or reduce the number of fields visible per
  screen — the goal is a modest per-field height increase, not a redesign
  of the wizard's information density.

## Surfaces touched

`apps/creator-web` only (`ui.tsx`). No callable, no shared type.

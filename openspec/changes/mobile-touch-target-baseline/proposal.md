# Proposal — mobile-touch-target-baseline

## Why

Two touch-target sizes recur throughout the Builder and sit below the
44×44px guideline (WCAG 2.5.5 / Apple HIG):

1. The shared `Button` component (`ui.tsx:59`) sets `min-h-[40px]` — every
   button in both apps inherits this floor, including the Builder's primary
   actions ("Launch run", "Save", wizard "Next"/"Back").
2. Three identical **"close ✕" icon buttons** — dismissing the task editor
   (`TaskWizard.tsx:210`), the enlarged map modal (`TaskWizard.tsx:551`), and
   the stage-settings panel (`BuilderPage.tsx:2788`) — are all `w-7 h-7`
   (28px). These are exactly the controls a creator taps repeatedly while
   building a game on a phone: open a task, close it, open the next one.

Neither is a single bad spot; each is a shared baseline that every mobile tap
in the Builder inherits. Fixing the baseline fixes the friction everywhere at
once instead of one card at a time.

## What Changes

- `Button` (`ui.tsx`): `min-h-[40px]` → `min-h-[44px]`.
- The three identical close-button call sites: `w-7 h-7` → `w-11 h-11`
  (44px), same glyph/icon size, same visual style otherwise.

## Non-goals

- Does not touch the `dense` Input/Textarea/Select variant used throughout
  TaskWizard's form fields — that is its own scoped pass
  ([[mobile-taskwizard-density]]).
- Does not touch every `w-7 h-7` icon button in the app (e.g. the map
  "enlarge" corner control, `QuizChoicesEditor.tsx`, `QuickSetup.tsx`) —
  only the three close controls named above, chosen because they are the
  highest-frequency taps in the mobile build loop. Broader icon-button
  auditing is left for a follow-up if it turns out to still be needed after
  this lands.
- Does not touch the back-to-games button — that is
  [[mobile-back-button-target]], a differently-shaped fix (hidden label,
  not just padding).
- Does not touch the stage-settings **pill** button itself (the `⚙ stage
  settings` control that OPENS the panel, `BuilderPage.tsx:2383-2398`) —
  only its close counterpart. The open-pill has a text label plus padding
  already and was not among the sub-40px targets found live.

## Surfaces touched

`apps/creator-web` only (`ui.tsx`, `TaskWizard.tsx`, `BuilderPage.tsx`). No
callable, no shared type.

## Why

The eyebrow above the task title on the participant's primary card shows internal jargon. In a full
multi-task stage (more than one task, not a partial "N of M" stage) the label reads **"Routed task"**
/ **"משימה מנוהלת"** ("managed task"). "Routed" is the creator/engine's word for smart routing; a
participant has no mental model for it. It sits at the very top of the card the player looks at most.

## What Changes

- Replace the player-facing copy of the `task.routedTask` eyebrow with plain, friendly language in
  **both** dictionaries — reusing the register already used by the sibling `task.yourTask` label:
  - HE `'משימה מנוהלת'` → `'המשימה שלכם'`
  - EN `'Routed task'` → `'Your task'`
- **Copy only.** No logic, no component, no new key.

## What does NOT change

- **No logic.** The eyebrow selection in `TaskRunner.tsx` is untouched: the partial-stage variant
  (`task.stopOf`, "Stop X of Y") and the single-task variant (`task.yourTask`) still render exactly
  as before. Only the string that `task.routedTask` resolves to changes.
- No new i18n key (the existing `task.routedTask` key is reused with new copy, so nothing else that
  references it breaks), no component change, no backend change.

## Impact

- `apps/play-web` — `src/i18n.ts` only (the `task.routedTask` value in HE and EN).
- **Not touched:** `apps/play-web/src/components/TaskRunner.tsx` (reads the same key), `functions/`,
  `packages/shared`, `apps/creator-web`.

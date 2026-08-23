## Why

The creator TaskWizard footer (`apps/creator-web/src/components/TaskWizard.tsx`) shows **two adjacent
forward-ish buttons on non-final steps**: a ghost **"Next →"** (advance) and a primary **"Done"**
(commit + close). The visually dominant primary "Done" invites the creator to close the editor before
walking the remaining steps, even though on steps 1-2 the natural next action is to continue. Two
similar controls competing for the primary slot is a weighting nit on an otherwise well-designed
progressive-disclosure wizard.

"Done" is deliberately reachable and never disabled from every step (a valid task can be finished
immediately) — that is a documented choice and must stay. The issue is only that "Done" out-shouts
"Next" mid-flow.

## What Changes

- On **non-final** steps: make **"Next →"** the primary (weighted) action and **"Done"** the
  secondary/ghost action. The contextually-correct forward action leads.
- On the **final** step (no "Next →" to show): **"Done"** is the primary action, as it is the only
  forward action there.

So the footer always presents exactly one weighted primary, and it is the step-appropriate one.

## What does NOT change

- **"Done" stays reachable and never disabled on every step.** Its behaviour is unchanged (first
  press reveals unrevealed blockers and lands on the offending step; a second press closes). Ability
  preserved: finishing a valid task immediately from any step — same button, same handler, only its
  visual weight changes on non-final steps.
- **"Next →" keeps its `canGoNext` enablement** and its advance behaviour; only its variant (now
  primary on non-final steps) changes.
- **Back, Delete task, step chips, and the step bodies are untouched.**
- **No i18n change.** Reuses `builder.next` / `builder.done`.

## Impact

- `apps/creator-web` — `src/components/TaskWizard.tsx` (footer only: swap which of Next / Done is the
  primary variant based on whether the current step is the last).
- **Not touched:** `functions/`, `packages/shared`, `apps/play-web`, `src/i18n.ts` (existing keys
  reused).

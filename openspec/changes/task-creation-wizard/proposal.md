> ⚠️ **PARTIALLY SUPERSEDED (2026-06-27) by [`v2.1-builder-shell-redesign`](../v2.1-builder-shell-redesign.md).**
> The redesign replaced this change's **layout half** — the linear step-by-step wizard is now the
> persistent 3-pane shell (Stage Rail · virtualized Task Canvas · slide-in Context Panel), with the
> task-type selector, Inspiration samples, and dynamic Quiz editor already shipped and gate-green.
> The **interaction-guidance / wizard-flow half** (location-first guided onboarding) remains open.
> Treat the layout sections below as historical; reuse only the pure-logic intent.

## Why

The current `TaskEditor` is a dense, single-scroll form that buries the most spatially critical decision (where is this task?) at the middle of the form and hides the interaction type inside an "Advanced" accordion. First-time creators are overwhelmed and make task-type mistakes they only discover at playtest. A guided, step-by-step wizard that anchors creators to the physical world first — then naming, then interaction — matches the natural mental model of designing a real-world adventure.

## What Changes

- The `TaskEditor` modal interior is replaced with a 3-step wizard (`wizardStep`: 1 | 2 | 3).
- **Step 1 — Map & Geospatial Placement**: prominent `LocationPicker` map + a clearly labeled "Locationless task" pill toggle. Locationless tasks skip the map entirely with a friendly explanation.
- **Step 2 — Mission Metadata**: task name (required; blocks forward nav if empty), difficulty, description, hint + hint penalty — all previously spread across the form or buried.
- **Step 3 — Input & Interaction Type**: a visual 2-column card grid; each of the 8 task types gets an icon, a plain-English name, and a 1-sentence description. Selecting a card reveals inline type-specific config (secret code, auto-approve, quiz choices/answers, numeric answer/tolerance, geofence radius, sequence steps). Advanced numeric fields (pointValue, estimatedMinutes, maxConcurrentTeams) are in a collapsible accordion on this step.
- Wizard navigation (Back / Next / Done) is inside the modal body; the outer `Modal` wrapper and the Done button to close are unchanged.
- A pure-logic helper module (`wizardLogic.ts`) is extracted for: `canGoNext(step, task)`, `canGoBack(step)`, `TASK_TYPE_META` (friendly label + description for all 8 types), and `isTaskLocationValid(task)`. This is the testable surface.

## Capabilities

### New Capabilities

- `task-creation-wizard`: Step-by-step guided modal for creating/editing a task inside the Builder. Replaces the flat `TaskEditor` form with a 3-step flow (location → metadata → interaction type). Introduces `wizardLogic.ts` as a pure-logic helper with typed predicates and display metadata for all task types.

### Modified Capabilities

*(none — no spec-level requirement changes to any existing callable or shared type)*

## Impact

- **creator-web only** — `apps/creator-web/src/pages/BuilderPage.tsx` (TaskEditor replaced, rest of BuilderPage unchanged).
- No callable changes, no shared-type changes, no Firestore rule changes.
- New pure-logic helper: `apps/creator-web/src/lib/wizardLogic.ts` (testable via `scripts/test-wizard.ts`).
- No play-web, functions/, or packages/shared changes.
- Non-goals: Hebrew i18n for wizard labels (separate change); drag-to-reorder tasks; task duplication; AI task generation.

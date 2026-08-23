## Why

The just-shipped `builder-clarity-mission-hierarchy` change fixed vocabulary and made the
stage/mission hierarchy visible, but the underlying complaint — creators find the Builder
overwhelming — has more root causes than terminology. Reading the current code surfaces three
concrete, fixable gaps: empty stages/canvases offer zero onboarding guidance; advanced-concept
warning banners (exclusive groups, unlock graphs, partial-stage starvation) render inline on the
main canvas for every creator, even ones who never touched the advanced settings that cause them;
and one advanced per-mission toggle (`pausesTimer`) is mixed into a wizard chip a creator opens for
basic, every-mission fields. None of these require removing functionality — they require putting
guidance where there is none, and putting advanced concepts at advanced visual weight, consistent
with how stage-level settings already do this correctly via the gear-icon drawer.

## What Changes

- Add inline empty-state guidance copy in the Builder canvas/rail when a stage has zero missions
  (e.g., a short "Add a few missions to this stage to get started" hint near the add-mission
  tiles), routed through `t.*` like all other Builder copy.
- Make the exclusive-group-unwinnable, unlock-graph-risk, and partial-stage-starvation warning
  banners actionable instead of dead-end text. Correction from initial framing: reading
  `packages/shared/src/gating.ts` confirms these three warnings only ever fire once a creator has
  already set `requiredTaskCount`, an unlock condition, or an exclusive group — they do not ambush
  a creator who has never touched the advanced settings drawer. The real friction is different: a
  creator sets one of those advanced fields in the "⚙ Stage settings" drawer, closes it, returns to
  the main canvas, and the resulting warning banner is inert text with no path back to where it can
  be fixed. This change makes each banner clickable, opening the stage settings drawer directly
  (mirroring how readiness-panel issues already deep-link to their offending stage/task). The
  banners stay unconditionally visible per the existing code invariant ("the unwinnable-stage guard
  must surface whether or not the panel is open") — this proposal does not touch that invariant, it
  only adds a click affordance. The launch-readiness gate (`canLaunchGame`/`ReadinessPanel`) remains
  the single source of truth for "can this launch" and is unchanged.
- Correction from initial framing: reading `TaskWizard.tsx` shows `pausesTimer` is NOT actually at
  basic-field visual weight — it already renders below the existing `AdvGroup` "Advanced timing"
  divider, in the same visually-advanced section as expiry/duration overrides, separate from
  `difficulty`/`pointValue` which render above the divider. No relocation is needed. Scope reduced
  to a small polish: add an explicit small "Advanced" marker directly on the pause-clock control
  itself, so its advanced status doesn't rely solely on position within a scrolled chip body.
  `Task.pausesTimer`'s data shape, scoring effect (`excludedMs`), and behavior are unchanged.

## Non-goals

- No change to any scoring, routing, or launch-readiness *logic*. `canLaunchGame`,
  `computeGameReadiness`, `excludedMs`/clock-pause scoring, and the exclusive-group/unlock-graph
  validity checks themselves are unchanged — only where/how their warnings are first surfaced.
- No removal of any feature or field. Exclusive groups, partial completion
  (`requiredTaskCount`), unlock conditions, and clock-pausing remain fully configurable; this only
  changes their visual placement/timing of disclosure.
- No callable, Firestore, or `packages/shared` type changes.

## Capabilities

### New Capabilities
- `builder-empty-state-guidance`: inline onboarding copy shown when a stage has zero missions.
- `builder-warning-navigation`: the three stage-level warning banners become clickable, opening the
  stage settings drawer they relate to, instead of being inert text.

### Modified Capabilities
- `task-creation-wizard`: adds a small "advanced" visual marker directly on the pause-clock
  (`pausesTimer`) control; no relocation, no other step/field behavior changes.

## Impact

- **creator-web**: `apps/creator-web/src/pages/BuilderPage.tsx` (empty-state copy near the
  add-mission tiles, warning-banner relocation/deep-link to `StageSettingsPanel`, gear-pill badge
  logic), `apps/creator-web/src/components/TaskCanvas.tsx` (empty-canvas guidance),
  `apps/creator-web/src/components/StageRail.tsx` (optional first-stage tip),
  `apps/creator-web/src/lib/taskOptInGroups.ts` (moves `pausesTimer` out of the `timerPoints`
  group definition), `apps/creator-web/src/i18n.ts` (new EN/HE copy keys).
- **Tests**: no new pure-logic test is required for copy/placement changes with no behavioral
  branch; `npm run i18n:check:strict` covers the new copy. If the warning-relocation logic gains a
  non-trivial branch (e.g., "show inline only if the drawer has never been opened for this stage"),
  it gets a co-located test per the design doc's decision.
- No `functions/`, `packages/shared` types, or Firestore rules changes.

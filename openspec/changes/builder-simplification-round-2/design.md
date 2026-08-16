## Context

This is round 2 of Builder clarity work, following `builder-clarity-mission-hierarchy` (mission
terminology + stage/mission breadcrumb, already shipped). Direct code reading (not assumption)
grounds this round:

- `TaskCanvas.tsx` renders nothing when `tasks.length === 0` — an empty stage's canvas is a blank
  div. The only guidance is two `AddTile` buttons rendered below the canvas in `BuilderPage.tsx`
  (~1868-1871), with no copy explaining what a stage needs.
- The three warning banners (`exclusiveUnwinnableWarn`, `unlockRequiredCountWarn`,
  `partialStarvationWarn`, `BuilderPage.tsx` ~1817-1852) are governed by an explicit existing-code
  invariant: *"Warnings stay ALWAYS visible — the unwinnable-stage guard must surface whether or not
  the panel is open."* Reading `packages/shared/src/gating.ts` confirms all three only ever fire
  once a creator has set `requiredTaskCount`, an unlock condition, or an exclusive group — they do
  not fire for an untouched stage. The real gap is that the banner is inert text: a creator who set
  the field in the "⚙ Stage settings" drawer, closed it, and now sees the warning has no click path
  back to fix it.
- `pausesTimer` in `TaskWizard.tsx` (~1541-1553) already renders below the existing `AdvGroup`
  "Advanced timing" divider (~1421), in the same visually-advanced section as expiry/duration
  overrides — separate from `difficulty`/`pointValue`, which render above the divider. The original
  premise (pausesTimer mixed at basic weight) does not hold; scope is reduced to a small polish
  decided with the user: add an explicit "Advanced" marker directly on the pause-clock control.

## Goals / Non-Goals

**Goals:**
- A creator looking at an empty stage sees guidance on what to do next, not a blank canvas.
- A creator who triggers one of the three stage-warnings can click straight into the settings
  drawer that owns the field causing it, instead of reading inert amber text.
- The pause-clock control visually self-identifies as an advanced/rare toggle even out of the
  context of the `AdvGroup` divider above it (e.g. if the group scrolls or the divider is missed).

**Non-Goals:**
- No change to `canLaunchGame`, `computeGameReadiness`, the gating logic in
  `packages/shared/src/gating.ts`, or excludedMs/clock-pause scoring.
- No change to the "warnings stay always visible" invariant — this proposal adds a click affordance
  to existing always-visible banners, it does not gate their visibility.
- No new top-level opt-in chip, no relocation of `pausesTimer` out of the `timerPoints` group.
- No change to `TaskCanvas`'s virtualization, drag-and-drop, or non-empty rendering path.

## Decisions

**1. Empty-state guidance lives in `TaskCanvas`, not `BuilderPage`.**
`TaskCanvas` already owns "what does this stage's task area look like"; adding an
`tasks.length === 0` branch there (rendered where the grid/virtualized list currently renders
nothing) keeps the empty-state decision co-located with the component that already decides
small-vs-virtualized rendering, rather than duplicating a `tasks.length` check in `BuilderPage`.
Copy comes from a new `builder.emptyStageHint` i18n key. No new prop needed — `TaskCanvas` already
receives `tasks`.

**2. Warning banners become buttons, not links or a routed navigation.**
Each of the three `<p>` warning elements becomes a `<button>` (matching the existing pattern for
the readiness panel's clickable issues) whose `onClick` calls the existing
`setEditing(null); setSettingsOpen(true)` sequence already used by the gear pill
(`BuilderPage.tsx` ~1755), so opening from a warning is identical to opening from the gear —- one
code path, not two ways to reach the same drawer. No new state is introduced. The visual style
changes minimally (underline/cursor-pointer on hover) so the click affordance is discoverable
without redesigning the warning's amber-text look.

**3. `AdvGroup` divider label is reused as the pause-clock control's own micro-label, not a new
component.**
Rather than inventing a second "advanced" visual language, the pause-clock control gets a small
inline badge/label reusing the same `InlineLabel`/muted-text styling `AdvGroup` already uses for
"Advanced timing," directly beside "{b.pauseClock}" — e.g. `⏱ {b.pauseClock} · {b.advancedTag}` or
a small pill, exact styling decided at implementation time to match existing `InlineLabel`
conventions in the file. This is copy + a few classNames, not a new component.

**4. No new pure-logic test required.**
None of these three changes introduce a new decision branch with inputs/outputs worth a unit test:
the empty-state guidance is an unconditional render when `tasks.length === 0` (visually verified,
not logic-tested), the warning-click handler reuses the existing settings-open state transition
(already implicitly covered by existing manual/e2e Builder usage), and the advanced-tag is static
copy. Verification is via the preview tools, consistent with "UI has no component test runner —
verify via preview tools" (CLAUDE.md).

## Risks / Trade-offs

- **[Risk]** Turning a `<p>` into a `<button>` inside a stage warning could visually clash with the
  existing amber-text styling if not matched carefully. → **Mitigation**: reuse the exact existing
  `text-xs text-amber-400` classes, only adding `underline decoration-dotted` / `cursor-pointer` and
  a `hover:` state, verified visually before considering the task done.
- **[Risk]** Empty-state copy could feel like it's telling an experienced creator (who is
  intentionally leaving a stage sparse, e.g. a single-task stage by design) what to do when they
  don't need the hint. → **Mitigation**: the hint only shows at `tasks.length === 0` (a stage with
  literally nothing yet), never once a first mission exists — so a deliberately small but non-empty
  stage is never nagged.
- **[Risk]** None of these changes are covered by automated tests, relying entirely on visual
  verification. → **Mitigation**: explicit visual-verification tasks in tasks.md for both LTR/RTL
  and the click-through path, matching the verification rigor of the mission-hierarchy change's
  breadcrumb feature.

## Migration Plan

No data migration — copy + minor JSX changes only. Deploy as a normal creator-web build. Rollback
is a normal commit revert.

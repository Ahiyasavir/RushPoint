## Why

Real-user testing found the task editor overwhelming: `TaskWizard.tsx` mixes title, description,
difficulty and task type in one step; trigger/location config in another; and scatters everything
else — points, timing, hints, media, prerequisites, station capacity, tags — across five separate
collapsible sections (`hint`, `unlock`, `media`, `rules`, and a catch-all `advanced` mega-section)
that a creator has to know exist. An earlier, incremental pass (`builder-first-task-flow`,
`builder-settings-grouping`) improved specific corners of this without changing the shape of the
problem. Product direction is a deeper redesign: a first-time creator should see almost nothing
until they ask for it, structured as a deliberate 3-step wizard with a modular "opt-in" pattern
(Notion/Typeform-style) for everything optional — not a single big collapsible panel, which still
produces a wall of controls once opened.

## What Changes

- **Reorder and narrow the wizard to a strict 3 steps**, replacing today's
  Details → Interaction → Placement:
  1. **Step 1 — Location.** The entire step is the 2-option Location picker from
     `task-location-mode-consolidation` ("Anywhere" / "Specific Location"), with all technical
     detail nested in that picker's own Advanced panel. Promoted to Step 1 (today it's last)
     because the interactive map needs dedicated screen space, not a shared scroll.
  2. **Step 2 — Details & Type.** Only Title, Description, and the Task Type selector. Nothing
     else — `difficulty` moves out (see Step 3).
  3. **Step 3 — Execution, Verification & Enhancements.** First, the task-type-conditional
     required verification fields (quiz choices/ordering, numeric answer+tolerance, smart-station
     secret code, sequence steps, survey choices) — unchanged behavior, just relocated here from
     today's standalone `Interaction` step. Directly below, a row of **modular opt-in chips**
     (see next bullet) for every optional field group.
- **Replace all 5 existing collapsible sections with 4 modular "opt-in" chips**, not a single
  accordion:
  - `+ Add Hint` → `hint`, `hintPenalty`, auto-reveal thresholds
  - `+ Set Timer / Points` → `difficulty`, `pointValue`, `estimatedMinutes`,
    `expectedDurationMinutes`, `expiresAfterMinutes`, `pausesTimer`
  - `+ Attach Media` → the media upload/YouTube control
  - `+ Prerequisites / Rules` → `unlockAfterTaskIds`, `maxConcurrentTeams`, `requirePresence`,
    `tags`
  - Clicking a chip mounts only that group's fields inline, with its own Remove (×) affordance
    that clears the fields and collapses it back to a chip.
  - A group that already has data on task load renders expanded with its Remove icon by default —
    never hidden behind a chip a creator has to know to click.
- **BREAKING (internal, UI-only):** the wizard's step order and internal section structure change.
  No stored `Task` field changes meaning or is removed.

### Non-goals
- No change to `Task` type/schema or any field's stored meaning.
- No change to `BUILDER_EDITABLE_FIELDS`/`savePayload.ts` (confirmed unaffected — `stages` is
  copied as one blob regardless of internal UI grouping).
- No change to the game-level Settings tab (`BuilderPage.tsx` `StepDetails`) — that surface keeps
  using the existing accordion `Advanced` component via the separate `builder-settings-grouping`
  change; this critique and redesign is scoped to the task editor (`TaskWizard.tsx`) only.
- Depends on, but does not duplicate, `task-location-mode-consolidation` — Step 1 is exactly that
  change's picker, referenced not re-specified here.

## Capabilities

### New Capabilities
- `creator-task-editor-progressive-disclosure`: The Builder's task editor is a strict 3-step
  wizard (Location → Details & Type → Execution & Enhancements) where every optional field group
  is opt-in via a chip rather than shown by default or buried in a shared accordion, while
  required verification fields and any field with existing data always render directly.

## Impact

- **Surfaces touched:** `apps/creator-web` only (`TaskWizard.tsx`, `apps/creator-web/src/lib/
  wizardSections.ts`, `i18n.ts`). No shared type, no callable, no Firestore rule change.
- **Files:** `apps/creator-web/src/components/TaskWizard.tsx` (step reorder, new
  `OptInField`/`OptInGroup` primitive, retirement of the `hint`/`unlock`/`media`/`rules`/`advanced`
  `Section` usages), `apps/creator-web/src/lib/wizardSections.ts` (`sectionApplies`/
  `sectionSummary` adapted from accordion-open-state to opt-in-group-mounted-state), `i18n.ts`
  (both dictionaries, new step titles and chip labels).
- **Risk:** moderate UI-refactor risk (large file, many fields relocated) but zero data risk — no
  stored field changes shape or meaning, this is purely how/where each control renders and in
  which step. The main regression to guard against is an existing task's populated field silently
  rendering behind an unclicked chip; the spec makes "data present ⇒ expanded by default"
  mandatory, not incidental.
- **Testing:** step-content assertions (which fields render in which step) and the opt-in
  chip-vs-expanded derivation become pure/co-located tests; UI verified via the preview tools (no
  component test runner exists per repo convention) in both Hebrew and English. `npm run
  i18n:check:strict` for the copy changes.

## Context

`TaskWizard.tsx` is already a 3-step wizard (`WIZARD_STEP_ORDER`, `:6,118-121,168-170`:
Details → Interaction → Placement) with a working collapsible-section primitive: `Section`
(`:205-222`) wraps the shared ui-kit `Advanced` component (`ui.tsx:204-226`), a generic controlled
disclosure widget. Sections exist today for `hint` (`:545`), `unlock` (`:588`), `media` (`:593`),
`rules` (`:1087-1160`), and a catch-all `advanced` mega-section (`:1162-1312`). Per-task
open/close defaults to "open only if it already has content" (`defaultOpenSections`, `:102`),
driven by `sectionApplies`/`sectionSummary` in `wizardSections.ts`. `buildSavePayload()`
(`savePayload.ts:74-91`) copies `stages` as one blob — confirmed independent of which UI section
or step a task field renders in.

Full field inventory used to derive the grouping below (task type: which fields apply to which of
the 9 task types — field/photo/quiz/numeric/smart_station/self_report/geofence/sequence/survey):

- **Core (Step 2):** `title`, `description`, `type`.
- **Location (Step 1):** trigger mode + coordinates, owned by `task-location-mode-consolidation`.
- **Required, type-conditional (Step 3, before chips):** quiz choices/ordering, numeric
  answer+tolerance, smart-station secret code, sequence steps, survey choices. `field`/
  `self_report`/`geofence` have no type-specific config.
- **Opt-in group "Hint":** `hint`, `hintPenalty`, `hintAutoRevealMinutes`,
  `hintAutoRevealAttempts`.
- **Opt-in group "Timer / Points":** `difficulty`, `pointValue`, `estimatedMinutes`,
  `expectedDurationMinutes`, `expiresAfterMinutes`, `pausesTimer`.
- **Opt-in group "Media":** `media[]` (image/video/YouTube).
- **Opt-in group "Prerequisites / Rules":** `unlockAfterTaskIds`, `maxConcurrentTeams`,
  `requirePresence`, `tags`.

## Goals / Non-Goals

**Goals:**
- Step 2 renders exactly 3 controls (title, description, type) and nothing else.
- Step 3's required verification fields are never optional/hidden — they render whenever the
  selected type needs them, full stop.
- Every optional field group is opt-in via a chip; a group with existing data is never hidden
  behind an unclicked chip.
- Zero change to what gets saved or how — this is a rendering/step-structure change only.

**Non-Goals:**
- Redesigning the game-level Settings tab (separate change, keeps the accordion pattern — that
  critique doesn't apply there, only to the task editor's density).
- Changing `Task`/`Game` schema, `savePayload.ts`, or any callable.
- Deciding the *exact* visual chip design (icon set, spacing) — that's implementation detail for
  `/opsx:apply`, this document fixes the structural contract (which fields, which step, which
  group, expand-if-populated).

## Decisions

- **Promote Location to Step 1, ahead of Details.** Today's order (Details → Interaction →
  Placement) makes a creator name and type a task before ever seeing where it lives on the map.
  Product direction is the opposite: the map control is the heaviest, most spatial part of the UI
  and deserves the first, uncluttered step. This is a real reorder of `WIZARD_STEP_ORDER`
  (`:6,118-121,168-170`), not just a relabeling — the "can't advance without a title" gate that
  exists today moves from the Step 1→2 transition to the Step 2→3 transition (Location no longer
  blocks on a title that doesn't exist yet).
- **`difficulty` moves from the old Details step into the "Timer / Points" opt-in group**, not
  into the new Step 2's 3 core fields. It wasn't named as a core field in product direction, and
  its natural home is beside `pointValue`/timing, which it directly influences via scoring.
- **Verification fields stay mandatory, not opt-in.** A quiz without answers or a sequence without
  steps isn't a valid task — hiding these behind a chip a creator might not click would let them
  save an unplayable task. They render unconditionally (filtered by type) directly above the
  opt-in chip row in Step 3.
- **New `OptInField`/`OptInGroup` primitive, not a reuse of `Advanced`/`Section`.** `Advanced` is a
  single expand/collapse trigger for one panel — using it for "everything optional" reproduces the
  exact "one mega scroll-heavy panel" problem being fixed. The new primitive instead renders, per
  group: a small chip when the group's fields are all empty, or the real field(s) plus a Remove
  (×) icon when populated or explicitly opted into. State is derived the same way
  `defaultOpenSections` already derives section-open state today (`:102`) — "does this task have
  data here" — just changing the rendered unit from a collapsible panel to a
  mount/unmount-with-remove field group.
- **Combine verification + opt-in chips into Step 3 rather than adding a 4th step.** Keeps the
  wizard at the specified 3 steps. The opt-in chips are collapsed by default and don't compete for
  space with verification fields until a creator opts in, so "complex interaction modes get
  breathing room" is preserved without a dedicated step.

## Risks / Trade-offs

- [Risk] Reordering `WIZARD_STEP_ORDER` touches step-navigation gating logic (`:74,119`) used
  throughout the file — a large, error-prone refactor surface. → Mitigation: RED-phase tests
  assert exact per-step field membership before implementation touches the gating logic, so a
  misrouted field or a broken "next" gate fails loudly.
- [Risk] A populated optional field silently rendering behind an unclicked chip would be a data-
  visibility regression (a creator editing an existing task might not notice a hint or media
  attachment is set). → Mitigation: this is a named, tested requirement ("data present ⇒ expanded
  by default"), not an incidental behavior — see specs.
- [Risk] Four chip groups is itself a judgment call on granularity (could be finer or coarser). →
  Mitigation: the grouping directly matches the product direction's four named chips (`+ Add
  Hint`, `+ Set Timer / Points`, `+ Attach Media`, `+ Prerequisites / Rules`); no further
  subdivision is introduced without a new product decision.

## Migration Plan

None required at the data layer. UI-only: on ship, every creator opening the task editor sees the
new 3-step structure; every previously-authored task loads its existing field values into the
correct new location (core / verification / opt-in-group-expanded) with no data transformation.

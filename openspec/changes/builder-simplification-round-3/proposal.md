## Why

Rounds 1 and 2 fixed vocabulary, hierarchy visibility, empty-state guidance and dead-end warnings.
Two confirmed gaps remain from the same Builder survey. First, the three opt-in chips on wizard
step 3 render through one identical `OptInChip` component with identical styling, identical `+`
prefix, fixed order and no descriptions, and two of their labels are vague or jargon ("Set timer /
points", "Rules") — a creator cannot tell what is behind a chip without opening it. Second, the
Builder header (`BuilderPage.tsx` ~558) is `flex items-center gap-3 px-4 h-14` with **no responsive
variants at all**, and every child except the centre tab strip is `shrink-0`: back button, title,
save status, undo/redo pair, File menu, readiness pill, and two launch buttons. At phone width the
tab strip is squeezed to nothing and the remaining fixed-width controls overflow horizontally, so
the Builder header is effectively unusable on a phone.

## What Changes

- Rewrite the three step 3 opt-in chip labels (and their matching group titles) into plain language
  that accurately describes what each group holds, in both EN and HE. Notably `rules` is currently
  labelled just "Rules" while actually holding four unrelated things (unlock prerequisites, an
  everyone-must-be-present gate, library tags, and station capacity) — the replacement label must
  describe that real content, not just its most memorable member. Copy only: no chip is added,
  removed, reordered, or restyled, and no field moves between groups.
- Make the Builder header responsive so it is usable at phone width: at narrow breakpoints, collapse
  secondary controls (undo/redo, the File menu, and the secondary "test run" launch button) into the
  existing `OverflowMenu` component already used for the File menu, keeping the primary controls
  (back, title, save status, tab strip, readiness, primary launch) directly reachable. Every control
  currently in the header remains reachable at every width — this is relocation into a menu at
  narrow widths only, never removal, and the desktop layout is unchanged.

## Non-goals

- No change to which fields live in which opt-in group, to `OPT_IN_GROUP_KEYS`, to
  `groupHasContent`/`groupSummary`/`clearGroupPatch`, or to the chips' collapsed-by-default rule.
- No change to the `OptInChip`/`OptInGroup` components' structure or styling, and no added tooltip,
  icon, description line, or "recommended" marker (explicitly declined in favour of plainer labels).
- No removal of any header control at any width, and no change to the desktop (>= `sm`/`md`) header
  layout.
- No change to launch behavior, readiness logic, undo/redo behavior, or import/export behavior —
  only where their controls are rendered at narrow widths.

## Capabilities

### New Capabilities
- `builder-responsive-header`: the Builder header remains usable at phone width by collapsing
  secondary controls into an overflow menu, with every control still reachable.

### Modified Capabilities
- `task-creation-wizard`: the step 3 opt-in chip labels and their group titles change to plainer,
  content-accurate wording; no structural or behavioral change to the groups themselves.
- `ui-text-standards`: no requirement change, but the new labels are bound by the existing
  no-dash-separator requirement, so replacement copy must use "&"/"and" rather than any dash or
  hyphen.

## Impact

- **creator-web**: `apps/creator-web/src/i18n.ts` (EN + HE values for `chipAddHint`,
  `chipSetTimerPoints`, `chipRules`, `groupTimerPoints`, `groupRules`),
  `apps/creator-web/src/pages/BuilderPage.tsx` (responsive header: breakpoint classes plus an
  `OverflowMenu` grouping for undo/redo, File menu and the test-run button at narrow widths).
- **Tests**: `npm run i18n:check:strict` covers the new copy; `scripts/test-no-dashes.ts` (already
  in `npm test`) enforces the no-dash rule on the new labels automatically. The header change is
  layout-only with no new decision branch, so it is verified via the preview tools at phone,
  tablet and desktop widths rather than by a unit test, consistent with "UI has no component test
  runner".
- No `functions/`, `packages/shared`, play-web, callable, or Firestore changes.

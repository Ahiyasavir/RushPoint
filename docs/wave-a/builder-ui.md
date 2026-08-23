# Wave A — Builder UI (Tasks 6 & 7)

Scope-limited SDD + TDD notes for the two Builder-shell changes owned by this lane.
Files owned: `apps/creator-web/src/pages/BuilderPage.tsx`, `components/StageRail.tsx`,
`components/TaskCanvas.tsx`, `components/TaskCard.tsx`, `lib/reorder.ts`, and the `b.*`
namespace of `src/i18n.ts`.

---

## Task 6 — compact stage settings row

### (a) SDD

**Problem.** The active-stage header block (`BuilderPage.tsx`, StepStages) spent three
full-width rows on two low-frequency settings:

1. `requiredTaskCount` — "כל קבוצה משלימה **X** מתוך **Y** משימות" (rendered only when the
   stage has more than one task).
2. `releaseAfterMinutes` — "שחרור השלב **N** דקות אחרי תחילת המשחק (0 = מיד)" (hidden on
   the first stage, which always opens at run start).

Each was its own `flex … text-xs` line, and the release row carried a very long unit
sentence. On a 3-pane shell at laptop height this pushed `StageStory` and the task canvas
below the fold.

**Change.** Fold both controls into ONE bordered "stage rules" strip:

- a single `flex flex-wrap items-center gap-x-4 gap-y-2` container with a subtle
  `border-[--rp-border] bg-[--surface-2]/40` chrome so it reads as one settings unit;
- each control is an inline `flex items-center gap-1.5` group, so a group wraps as a whole
  rather than breaking mid-sentence;
- a 1px vertical divider between the groups, rendered only when both are present
  (`m > 1 && !isFirstStage`) and hidden once the row wraps is acceptable — it is
  `aria-hidden` decoration;
- the long release sentence becomes a short `b.releaseUnitShort` ("דקות" / "minutes") with
  the full existing `b.releaseAfterUnit` sentence preserved as the `title` tooltip on the
  group — no information is lost, ~40 characters of width are.
- the whole strip is skipped entirely when neither control applies (single-task first
  stage), removing an empty bordered box.

**Constraints honoured.**
- RTL: only logical utilities — `gap-x`, `gap-y`, `px`, `py`, `text-start`. No `ml-`/`mr-`/
  `text-left`. The divider is a plain `w-px` element, direction-agnostic.
- Wrapping: `flex-wrap` + `min-w-0` on each group; the number `Input` is fixed at `w-16`
  and the `Select` at `w-auto`, so nothing forces horizontal overflow.
- Tailwind: static class strings only.
- Untouched behaviour: the two warning blocks (`unlockRequiredCountWarn`,
  `partialStarvationWarn`) and `StageStory` still render after the strip; the
  `requiredTaskCount` clamp-on-task-delete in `ContextPanel.onRemove` is unchanged (it now
  delegates to the shared `clampRequiredTaskCount` helper — same semantics, see Task 7).

### (b) TDD

The strip is pure presentation (no new logic), so the RED lane is the shared clamp helper
this refactor now leans on plus a visual check:

- `scripts/test-builder-dnd.ts` → `clampRequiredTaskCount` cases (see Task 7 test list) —
  these lock the invariant the compacted `Select` renders against (`req` must always be one
  of the options `1..m`, or `undefined`).
- i18n: `releaseUnitShort` added to BOTH the HE and EN `builder` objects; HE is genuine
  Hebrew script. Zero hardcoded strings introduced.
- Visual/RTL verification: read-through of the emitted class list for `ml-*`/`mr-*`/
  `text-left`/`text-right` (none), plus a `grep` for dynamic class interpolation (none).

---

## Task 7 — drag & drop tasks within and between stages

### (a) SDD

**Before.** Stages reorder via native HTML5 DnD (`StageRail` → `onMove` → `moveItem`).
Tasks could not be reordered at all: `TaskCanvas` was a read-only (optionally virtualized)
grid and `TaskCard` had only `onClick`.

**After.**

1. **Intra-stage reorder.** Every task in `TaskCanvas` is wrapped in a `draggable` element
   with `onDragStart / onDragOver / onDrop / onDragEnd`. Dropping onto index `j` calls
   `onReorder(i, j)` → `moveItem`. A dashed outline marks candidate drop slots while a drag
   is live, matching `StageRail`'s existing affordance.

2. **Inter-stage move.** The drag payload is published on a **custom MIME type**,
   `application/x-rushpoint-task`, carrying `{ stageId, taskId }`. `StageRail` entries
   become drop targets: `onDragOver` accepts when `e.dataTransfer.types` contains that type,
   and `onDrop` calls `onTaskDrop(stageId)`. The pre-existing stage-reorder drop path is
   untouched — it is guarded by `dragIdx !== null`, which is null during a task drag, and
   the task branch returns early.

3. **No new dependency.** Native HTML5 DnD only, matching `StageRail`. (`@tanstack/
   react-virtual` stays purely a windowing concern.)

**Virtualization.** `TaskCanvas` windows once a stage exceeds 24 tasks. Two mitigations:

- **Edge auto-scroll.** The scroll container has an `onDragOver` handler that, when the
  pointer is within 48px of the top/bottom edge, nudges `scrollTop` by ±16px per event.
  This makes the windowed branch reachable without releasing the drag — react-virtual then
  mounts the newly visible rows, which are themselves drop targets.
- **A scroll-free escape hatch.** The `StageRail` on the left is always fully visible and
  never scrolls with the canvas, so "move this task somewhere far away" is achievable by
  dropping on a stage — including the *current* stage, which appends to its end.

**requiredTaskCount invariant.** Moving a task between stages changes BOTH stages' task
counts, so both must be re-clamped or the source stage becomes unwinnable (`required >
tasks`) and the destination's select shows a stale value. This is the same invariant as the
delete path. It is now expressed once, as pure logic in `lib/reorder.ts`:

```
clampRequiredTaskCount(req, taskCount) -> number | undefined
moveTaskBetweenStages(stages, fromStageId, taskId, toStageId, toIndex?) -> Stage[]
```

`moveTaskBetweenStages` also refuses to empty a stage (a source holding its last task is a
no-op, returning the original array by reference) — `blankStage` guarantees ≥1 task and the
Builder's delete action is likewise disabled at one task.

**Accessibility / touch.** Drag-only is unusable on the tablets this Builder targets, so
`TaskCard` gains a **"move to stage" select** (`b.moveTaskTo`), rendered whenever the game
has more than one stage. That forced the card root from `<button>` to
`<div role="button" tabIndex={0}>` with an Enter/Space key handler — a `<select>` cannot be
nested inside a `<button>`. The select stops click/keydown propagation so choosing a stage
never also opens the task panel. A drag grip (`⠿`, `aria-hidden`, `b.dragTaskHandle` title)
gives the pointer affordance.

### (b) TDD — `scripts/test-builder-dnd.ts` (auto-discovered by `scripts/run-unit-tests.mjs`)

RED-first assertions, all pure and DOM-free:

*clampRequiredTaskCount*
1. `undefined` in → `undefined` out.
2. `req < taskCount` → unchanged.
3. `req === taskCount` → `undefined` (means "all").
4. `req > taskCount` → `undefined` (the unwinnable case).
5. `req < 1` / non-finite → `undefined`.
6. fractional `req` floors.

*moveTaskBetweenStages*
7. Same-stage move reorders in place (equivalent to `moveItem`).
8. Cross-stage move removes from source and inserts into destination at `toIndex`.
9. Omitted `toIndex` appends to the destination's end.
10. Source `requiredTaskCount` is re-clamped when it would exceed the shrunken source.
11. A source count that still fits is preserved verbatim.
12. Destination `requiredTaskCount` survives growth (a smaller `required` stays valid).
13. Destination count equal to its NEW length collapses to `undefined`.
14. Moving a stage's LAST task is a no-op (identity-equal result) — never empty a stage.
15. Unknown stage id / unknown task id are no-ops (identity-equal).
16. The input array and its stage objects are not mutated.
17. Stages the move does not touch keep their object identity (cheap React re-render).

*existing coverage kept*: `moveItem` cases already live in
`scripts/test-builder-redesign.ts` and are untouched.

### Verification performed in this lane

- `npx tsx scripts/test-builder-dnd.ts` — all assertions green.
- `npx tsc --noEmit -p apps/creator-web/tsconfig.json` — clean. (App-scoped and read-only;
  the full `npm run typecheck` was NOT run because it invokes `shared:build`, which rewrites
  `packages/shared/dist` in place and must not race concurrent agents.)
- `npx eslint` on the five touched source files — 0 errors (one pre-existing
  `react-hooks/exhaustive-deps` warning in BuilderPage, untouched by this change).
- `npx tsx scripts/check-i18n.ts` — PART A green (key parity, HE pure Hebrew, EN pure
  English) and PART B green (zero hardcoded UI strings).
- `npx tsx scripts/test-builder-redesign.ts` — still green (existing `moveItem` coverage).
- i18n: 3 new `b.*` keys added to both dictionaries (`releaseUnitShort`, `moveTaskTo`,
  `dragTaskHandle`); HE values are Hebrew script, EN values Latin.

### Regression risk — the virtualized path

- `rv.measureElement` is attached to the **same** element that is now `draggable`. Adding
  drag props does not change layout, and `paddingBottom` is unchanged, so measured row
  heights are unaffected.
- During a drag the browser may briefly hide the source element; react-virtual measures via
  `ResizeObserver`, which can fire a 0-height measurement for a hidden node. Mitigated by
  keeping the dragged element in the DOM (only opacity is reduced — `opacity-40` — never
  `display:none`).
- Auto-scroll writes `scrollTop` directly on the container react-virtual observes. This is
  the supported path (the virtualizer reads scroll offset from the element), but a very fast
  drag near an edge can queue several 16px nudges per frame; the step is intentionally small
  so overshoot stays sub-row.
- Drop indices come from `data-index`/the render index, which in the windowed branch equals
  `vi.index` — the true array index, not a window-relative one. A drop on a windowed row
  therefore reorders correctly; this is the single most likely place for an off-by-window
  bug, so the index is threaded through explicitly rather than derived from DOM position.
- Cross-stage drops bypass the canvas entirely (they resolve in `StageRail`), so the
  windowed branch is not on that path at all.

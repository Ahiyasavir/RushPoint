# Wave-G robustness sweep — creator-web DnD, exclusive groups, photo queue

Scope: the recently-shipped dnd-kit task drag-and-drop + exclusive-groups redesign
(`BuilderPage`, `TaskCanvas`, `StageRail`, `ExclusiveGroupsModal`, `lib/reorder.ts`,
`shared/mutualExclusion.ts`) and the live photo approval queue (`RunConsolePage`
`PhotoReviewConsole`, `shared/photoQueue.ts`). Read-only trace; no code changed.

Headline: **one high-impact DnD collision-resolution risk (needs runtime check)**; the
exclusive-group / cross-stage-move invariant and the photo-queue idempotence are
otherwise **clean**. The rest are low-severity UX / defensive items.

---

## Confirmed findings

| # | Location | Scenario | Player/creator experiences | Sev | One-line fix |
|---|----------|----------|----------------------------|-----|--------------|
| C1 | `RunConsolePage.tsx:938` & `:980` | Pending and reviewed rows render `row.taskId` (raw id) — the panel holds `ownerUid`/`gameId` but never loads the game to map id→title. | Reviewer sees an opaque id (`task-a1b2…`) not the task name; can't tell which task a photo is for. No throw. | Low (UX) | Subscribe to the game once and render `titleById[taskId] ?? taskId`. |
| C2 | `RunConsolePage.tsx:985-991` | Reviewed strip shows an **active** "reject" on already-`rejected` rows (`canReject('rejected')===true`); clicking re-opens the reject-note prompt and fires a no-op `reviewStationSubmission(approved:false)`. | Confusing: a rejected item invites another reject + a pointless note prompt + a toast. | Low (UX) | Only offer reject where it changes state (e.g. `row.status==='pending'`), or relabel for rejected rows. |
| C3 | `RunConsolePage.tsx:867` | `onSnapshot` error handler is `() => undefined` — a permission/transient error leaves the queue silently empty. | On any read failure the whole review panel shows nothing with zero indication (matches the known "silently shows nothing" risk). Owner-only rules make this rare. | Low | `console.warn` the error and/or render a distinct error state vs the empty state. |
| C4 | `lib/reorder.ts:135` (`clampRequiredTaskCount`) | Clamp is only against raw `taskCount`, never `maxAttainableCompletions`. After a cross-stage move that strips a group, the source stage can keep `requiredTaskCount > maxAttainable`. | Stage ends early (team scores less than intended). **Not** stranding — losers skip in the same commit (per `mutualExclusion` contract), and the amber ceiling warning still renders. | Low | Optional: also clamp/warn against `maxAttainableCompletions` after a group-affecting move. |
| C5 | `ExclusiveGroupsModal.tsx:66` | `atMax = authored.length >= 6` counts **inert 1-member** authored groups toward the cap. | Six half-built (1-member) groups hide the `＋` column and block creating the group the creator actually needs. | Low (friction) | Count effective groups, or cap on `GROUP_STYLES.length` of non-empty groups. |
| C6 | `i18n.ts:1386` | EN `exclusiveGroupLetter = String.fromCharCode(65+i)` has no past-`Z` fallback (HE falls back to a number at `i:1387`→`:557`). | Would emit `[`, `\`… past 26 groups. **Unreachable today** — `＋` is hidden at 6 groups (`atMax`), so `i ≤ 5`. | Low (defensive) | Mirror HE: `String.fromCharCode(65+i) or String(i+1)` when `i>25`. |

---

## Needs runtime check (highest priority)

### R1 — Rail entry registers TWO droppables on the same node; `closestCenter` must break a zero-distance tie
- `StageRail.tsx:35-42` + `:46` — each `RailEntry` calls `useSortable({id: stage.id})`
  **and** `useDroppable({id: 'stage-drop:'+stage.id})` and puts **both refs on the same
  DOM element** (`setNodeRef(el); drop.setNodeRef(el)`). So two droppables share one rect
  / one center.
- `BuilderPage.tsx:909` uses plain `collisionDetection={closestCenter}` with **no custom
  resolver and no per-drag filtering** (confirmed: `closestCenter` is the only collision
  detection in the app).
- Because both droppables have an identical center, `closestCenter` distance is a tie; the
  winner is decided by droppable **registration order** (the sortable's droppable registers
  first — `useSortable` is declared before `useDroppable` in the component).

**The two failure directions:**
1. **Task dragged onto a rail entry (the primary cross-stage move):** if the tie resolves to
   the bare `stage.id` (sortable) instead of `stage-drop:…`, then `onDragEnd`
   (`BuilderPage.tsx:856`) `overId.startsWith(STAGE_DROP_PREFIX)` is false, falls through to
   `game.stages.find(s => s.tasks.some(t => t.id === overId))` (`:862`) which finds nothing
   (overId is a *stage* id), and **the move silently no-ops** — the task springs back.
2. **Stage dragged onto another stage (reorder):** if the tie instead resolves to
   `stage-drop:…`, the stage branch `to = findIndex(s.id === overId)` (`:848`) returns `-1`
   and **the reorder silently no-ops**.

Only one of these can "win" per registration order, so at least one of {cross-stage task
move, stage reorder} is at risk of doing nothing. The code comment at
`STAGE_DROP_PREFIX` (`StageRail.tsx:22-24`) only guards against *string-id* collision — it
does **not** address the *spatial* collision the two co-located droppables create.

**Why runtime, not confirmed:** the exact tie-break in `@dnd-kit/core`'s `closestCenter`
(stable-sort over `droppableContainers` iteration order) needs a browser to observe; the
pure-logic DnD tests (`reorder.ts`) never exercise collision resolution. **Verify by
actually dragging a task onto a rail stage, and dragging a stage over another, in the app.**

**Fix if reproduced:** supply a custom `collisionDetection` that filters candidate
droppables by `active.data.current.type` (task ⇒ only `stage-drop:*` + task ids; stage ⇒
only bare stage ids), or `disabled:` the explicit `useDroppable` while a stage is in flight
and the sortable-droppable while a task is in flight.

### R2 — Fast drop into an unmounted virtualized region
- `TaskCanvas.tsx:120-137` windows large stages; only mounted rows are droppables. A drop
  flung to a far, never-rendered region yields `over == null` ⇒ `onDragEnd` returns early
  (`BuilderPage.tsx:842`) and the task returns home. **No data corruption** (index always
  comes from the data-model `findIndex`, `:864`, never DOM measurement), but the drop is
  lost. `overscan:6` + autoScroll make this hard to hit. Confirm it feels acceptable on a
  100+ task stage.

---

## Clean bills (verified correct)

- **Exclusive-group source-strip invariant — CLEAN.** Every path that removes a task from a
  stage strips it from that stage's `exclusiveGroups` and re-clamps `requiredTaskCount`:
  - drag onto rail / onto a cross-stage task ⇒ `moveTaskToStage` → `moveTaskBetweenStages`
    (`reorder.ts:199-207`) strips source groups + clamps both sides;
  - `⋯` menu move ⇒ same `moveTaskToStage` (`BuilderPage.tsx:788`);
  - delete ⇒ `onRemove` strips groups + clamps (`BuilderPage.tsx:1117-1124`);
  - modal edits funnel through `normalizeGroups` (`BuilderPage.tsx:745`).
  Destination always receives the task **ungrouped** (dest groups untouched). No path leaves
  a group referencing a moved/deleted id. A group reduced to 1 member is kept but is inert by
  contract (`mutualExclusion.ts:54`) and visibly greyed (`ExclusiveGroupsModal.tsx:185-188`).
- **Group ceiling never exceeds the palette.** `＋` hidden at `atMax` (6 authored groups),
  so effective groups ≤ 6; letters/colours (`GROUP_STYLES`, `TaskCard.tsx:25-32`) never run
  out in practice. `gi % GROUP_STYLES.length` guards colour regardless.
- **Drag cancel / Escape mutate nothing.** State is committed **only** in `onDragEnd`
  (`BuilderPage.tsx:838`); `onDragCancel` just clears the overlay (`:916`). One drag = one
  `useHistory` undo step (no `onDragOver` writes).
- **Within-stage reorder index is exact under virtualization.** `toIndex` /`from` come from
  `overStage.tasks.findIndex(...)` on the data model (`BuilderPage.tsx:864-867`), not from
  windowed DOM geometry — so a windowed drop lands where the creator dropped it.
- **RTL keyboard nav** (`arrowKeyCoordinates`, `BuilderPage.tsx:62-93`) walks sortable order
  (not geometry), so Down/Up = next/prev independent of column count; last/first item
  returns `undefined` (can't over-run) rather than jumping. No stuck/reversed case found.
- **Photo queue flattening — robust.** `flattenSubmissions` (`photoQueue.ts:133-145`) skips
  teams with no `id`, no/`null`/non-object `taskSubmissions`, and malformed submission
  entries; a nameless team falls back to its id (`:120`). No-submission teams contribute
  nothing. Cost is O(teams×subs) per snapshot, memoized on `teamDocs` (`RunConsolePage:870`).
- **Double-approve can't double-score.** UI is single-flight per `teamId:taskId` via
  `useAsyncAction` (`RunConsolePage:893`, guard `hooks/useAsyncAction.ts:54-56`); two
  reviewers / two browsers are deduped server-side (`nextStatus` idempotence table +
  `completeTaskForTeam` returning `completed:false`, `photoQueue.ts:91-94`). Approved→reject
  is refused in UI (`canReject`, `:987`) and has no server clawback path.
- **Reviewed cap (8).** By design a confirmation strip, newest-first (`buildReviewedQueue`,
  `photoQueue.ts:184-190`); older reviewed rows fall off intentionally — not an audit view.
- **i18n:** no new hardcoded UI literal found in the modal / strip / queue JSX — all copy
  routes through `b.*` / `rc.*`; only symbols (`○ ＋ ✕ 📷`) and data (`displayName`,
  `taskId`, clock) are inline. (`i18n:check` gate will confirm.)

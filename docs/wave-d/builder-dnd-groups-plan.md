# Wave D — Builder plan: exclusive groups UI (2A) + real drag and drop (2B)

Status: **IMPLEMENTED** (2026-07-21). The plan below is unchanged as authored; the
deltas from the user's decisions and from what implementation actually taught us are
recorded in §7 at the end.

Scope of ownership for the implementation pass:
`apps/creator-web/src/pages/BuilderPage.tsx`,
`apps/creator-web/src/components/{StageRail,TaskCanvas,TaskCard,TaskWizard}.tsx`,
`apps/creator-web/src/lib/reorder.ts`, `apps/creator-web/src/i18n.ts`,
`apps/creator-web/package.json`, `scripts/test-builder-dnd.ts`, this doc.
**Nothing** in `functions/`, `packages/shared/`, `apps/play-web/`.

---

## 0. Ground truth gathered (verified by reading, not assumed)

| Fact | Where |
|---|---|
| Data model is done + server enforced | `packages/shared/src/mutualExclusion.ts` (7 pure exports), `docs/wave-b/mutually-exclusive-tasks.md` §5 |
| Current group editor = nested chip table | `BuilderPage.tsx` L845–896 |
| Group mutators already exist | `BuilderPage.tsx` L683–695 (`setExclusiveGroups` / `addExclusiveGroup` / `removeExclusiveGroup` / `toggleExclusiveMember`) |
| Unwinnable warning | `BuilderPage.tsx` L898–904, uses `maxAttainableCompletions` |
| Task delete already prunes groups | `BuilderPage.tsx` L975–984 |
| `העברה לשלב…` select | `TaskCard.tsx` L82–105, fed by `TaskCanvas` `moveTargets`/`onMoveToStage`, wired at `BuilderPage.tsx` L727–734 |
| Native HTML5 task DnD | `TaskCanvas.tsx` L52–91 (intra stage + edge autoscroll), `StageRail.tsx` L32–77 (cross stage drop target + stage reorder) |
| Virtualization | `TaskCanvas.tsx` L42–47, windowed branch when `tasks.length > 24` |
| React version | **18.3.1** (creator-web deps, root resolve) |
| No DnD library installed | `apps/creator-web/package.json` L15–29 |
| BuilderPage is already `React.lazy` | `App.tsx` L12 |
| **creator-web has NO colorblind flag** | the `colorblind` flag exists only in `apps/play-web/src/i18nContext.tsx` L14–28 + `store.ts` L55–58; creator-web's `LanguageContext` has language only |
| No `Modal` primitive in creator-web `ui.tsx` | only `components/dialog.tsx` (`dialog.confirm`/`DialogHost`), which is a text dialog, not a content modal |

**Consequence of the colorblind finding:** we cannot gate the new colour cues on a
creator side `colorblind` flag, because there is none, and adding one would require
`LanguageContext.tsx` (not in my ownership) plus a settings toggle. So the design is
**unconditionally colourblind safe**: every group cue carries a **letter** as well as
a colour, always, for everyone. That is strictly better than a mode switch and needs
no new context. (If the user prefers a real creator side toggle later, that is a
separate change touching `LanguageContext.tsx` + `SettingsPage.tsx`.)

---

## 1. SDD — Point 2A: redesign the mutually exclusive groups UI

### 1.1 Problem with what shipped

The current editor renders, per group, **one chip per task in the stage**. A stage with
5 tasks and 2 groups draws 10 chips over 2 wrapped lines inside the header strip, with
no visual link between a chip and the card it refers to. The creator has to read task
titles twice (once in the strip, once on the cards) and mentally join them. It also
grows linearly with `groups × tasks`, which is exactly the vertical bloat wave C just
removed.

### 1.2 The concept to communicate

> *A set of alternatives. Every team is handed only ONE of them, so different teams get
> different variants and nobody farms all of them.*

Design rule derived from that: **the grouping must be visible on the task cards**
(that is where the creator already looks), and **editing it must happen in one focused
place** (a modal), not inline in the header.

### 1.3 New surface A — the header strip collapses to one line

Replaces `BuilderPage.tsx` L845–896 entirely.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ רק אחת מתוך   ( א · 3 משימות )  ( ב · 2 משימות )        [ קיבוץ משימות ]     │
└─────────────────────────────────────────────────────────────────────────────┘
```

* One row, `text-xs`, same bordered `--surface-2/40` idiom as the stage rules strip
  above it, `flex flex-wrap items-center gap-x-3 gap-y-1.5`, `text-start` only.
* Height is **constant** in the number of tasks and only wraps with the number of
  groups (a stage rarely has more than 2 or 3). Strictly less bloat than today.
* Each group is a **summary chip**: letter badge + count. Clicking it opens the modal
  with that group pre focused. `aria-label` = "קבוצת חלופות א, 3 משימות".
* The trailing button opens the modal with no group focused (`קיבוץ משימות`).
* When the stage has **no** groups the row shows only the lead text plus the button,
  so a first time creator still discovers the feature. Rendered only when `m > 1`
  (unchanged condition).
* The amber unwinnable warning at L898–904 **stays exactly where it is** and keeps its
  existing key `b.exclusiveUnwinnableWarn` / `maxAttainableCompletions` guard.

### 1.4 New surface B — the group badge on the task card

`TaskCard.tsx`, header row (currently L73–106). The badge sits **after** the type pill
and **before** the title, and is `shrink-0`:

```
⠿ [PHOTO] (א) צילום במזרקה                        ⌖
   ↑type    ↑group badge
```

Badge markup: a 18px rounded square, 1px border, tinted background, containing the
group **letter** in `text-[10px] font-bold`. Colour AND letter AND a border, so hue is
never the only carrier. `title`/`aria-label` = `b.exclusiveBadgeAria(letter, n)` →
"חלופה א מתוך 3, הצוות יקבל רק אחת מהן".

Additionally the card's inline start rail (`border-s-[4px]`, currently the task **type**
colour) is left alone — we do not overload it. Grouped cards instead get
`ring-1 ring-inset` in the group colour, which reads as "these belong together" when two
grouped cards sit next to each other in the 2 column grid, without changing card height.

`TaskCard` gains one optional prop:

```ts
/** Membership in this stage's exclusive groups, precomputed by BuilderPage from
 *  effectiveExclusiveGroups(). Undefined = ungrouped (no badge, no ring). */
group?: { index: number; letter: string; size: number };
```

`TaskCanvas` just forwards it (`groupOf?: (taskId) => Group | undefined`). No layout
change to the canvas, no extra row, **zero added vertical space**.

### 1.5 New surface C — the "group tasks" modal

A local component `ExclusiveGroupsModal` **inside `BuilderPage.tsx`** (keeps the change
inside owned files; BuilderPage is already 1120 lines, so if the user prefers, it can be
a new `components/ExclusiveGroupsModal.tsx` — see §5 decision list). Fixed overlay,
`max-w-2xl`, its own `overflow-y-auto` body, closes on Escape and on backdrop click,
focus trapped to the panel, focus restored to the opener.

```
┌── קיבוץ משימות חלופיות ───────────────────────────────── ✕ ──┐
│ בחרו משימות שהן גרסאות שונות של אותו אתגר. כל צוות יקבל רק     │
│ אחת מהן, כך שצוותים שונים מקבלים גרסאות שונות ואי אפשר לצבור   │
│ את כולן.                                                      │
│                                                               │
│  משימה                        ללא   א    ב    ＋              │
│  ─────────────────────────────────────────────────────────    │
│  [PHOTO] צילום במזרקה          ( )  (•)  ( )   ( )            │
│  [QUIZ]  שאלה על המזרקה        ( )  (•)  ( )   ( )            │
│  [CODE]  קוד במזרקה            ( )  (•)  ( )   ( )            │
│  [FIELD] הגעה לשוק             (•)  ( )  ( )   ( )            │
│  [QUIZ]  שאלה על השוק          ( )  ( )  (•)   ( )            │
│  [NUM]   כמה דוכנים בשוק       ( )  ( )  (•)   ( )            │
│                                                               │
│  קבוצה א: 3 משימות · הצוות ישלים אחת                          │
│  קבוצה ב: 2 משימות · הצוות ישלים אחת                          │
│  מקסימום השלמות בשלב הזה: 3 מתוך 6                            │
│  ⚠ מספר המשימות הנדרש גבוה ממה שאפשר להשלים…                  │
│                                             [ סיום ]          │
└───────────────────────────────────────────────────────────────┘
```

Interaction model, chosen because it is the only one that is simultaneously compact,
keyboard native and unambiguous:

* **One row per task, one radio group per row.** `role="radiogroup"` with
  `aria-label` = the task title; options = `ללא` (ungrouped) + one per existing group +
  a `＋` column that creates a new group and drops the task into it.
* Radios are rendered as **letter buttons**, coloured per group, letter always visible,
  `aria-checked` driving the state. Native arrow key navigation comes free from
  `role=radio` + roving `tabIndex`, so the whole editor is keyboard operable with **no**
  drag involved. This is deliberate: the grouping editor must never depend on DnD.
* A task can be in **at most one** group by construction (radio, not checkbox). That
  removes today's whole "disabled because taken by another group" concept and the
  `exclusiveTaskTaken` tooltip.
* Deleting a group is implicit: moving its last two members out leaves `< 2` members,
  which the data model already treats as inert; the normalizer (`§1.7`) drops empty
  groups on write, and a 1 member group is shown greyed with the note
  `b.exclusiveGroupInert` ("קבוצה עם משימה אחת אינה משפיעה"). An explicit
  `מחיקת הקבוצה` ✕ per group stays available in the summary footer for clarity.
* The footer recomputes `maxAttainableCompletions(stage)` **live** and shows the same
  amber warning text the header does, so the creator sees the consequence while editing
  rather than after closing.
* Column count grows with groups; realistically 2 to 4. Guard: cap the offered columns
  at 6 (`GROUP_STYLES.length`), beyond which the `＋` column hides and a hint appears.

Why not drag tasks into group buckets: it re creates the 2B accessibility problem in a
second place, and needs vertical space for the buckets. Radios cost one line per task
inside a scrollable modal, and are trivially testable.

### 1.6 Colourblind safe palette (static Tailwind classes only)

Fixed array in `TaskCard.tsx` (exported so `BuilderPage` reuses it) — **literal class
strings, no interpolation**, indexed by group index modulo 6:

```ts
export const GROUP_STYLES = [
  { badge: 'bg-cyan-500/20 text-cyan-200 border-cyan-400',       ring: 'ring-cyan-400/70'    },
  { badge: 'bg-amber-500/20 text-amber-200 border-amber-400',    ring: 'ring-amber-400/70'   },
  { badge: 'bg-violet-500/20 text-violet-200 border-violet-400', ring: 'ring-violet-400/70'  },
  { badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-400', ring: 'ring-emerald-400/70' },
  { badge: 'bg-pink-500/20 text-pink-200 border-pink-400',       ring: 'ring-pink-400/70'    },
  { badge: 'bg-orange-500/20 text-orange-200 border-orange-400', ring: 'ring-orange-400/70'  },
] as const;
```

Non colour redundancy, always on (no mode switch, see §0):

1. **Letter** inside every badge and every radio button — the primary carrier.
   `b.exclusiveGroupLetter(i)` → `א ב ג ד ה ו` in HE, `A B C D E F` in EN.
2. **Text label** in the summary chip and the modal footer ("קבוצה א · 3 משימות").
3. **Border** on the badge (a shape cue: grouped cards have a bordered square badge,
   ungrouped cards have none at all — presence/absence is itself non chromatic).
4. `title` + `aria-label` on every badge for screen readers and hover.

Beyond 6 groups the colour repeats but the **letter never does** (ז, ח, …), so identity
is still unambiguous. Contrast: all six are 200 level text on a 20% tint over
`--surface-1`, matching the existing `Badge` treatment in `ui.tsx`.

### 1.7 Pure logic to add (shared by UI and tests)

Put in `apps/creator-web/src/lib/reorder.ts` (already the Builder's pure lane and
already imported by BuilderPage), NOT in `packages/shared` (out of ownership, and this
is presentation state management, not a model rule):

```ts
export interface GroupLike { id: string; taskIds: string[] }

/** Normalize authored groups for WRITE: drop ids not in the stage, dedupe, drop an
 *  id already claimed by an earlier group, drop groups with 0 members, return
 *  undefined when nothing is left. Mirrors effectiveExclusiveGroups' claim rule but
 *  keeps 1 member groups (the creator is mid edit); the model already treats them
 *  as inert. */
export function normalizeGroups(groups: GroupLike[] | undefined, taskIds: string[]): GroupLike[] | undefined;

/** Assign one task to `groupId`, or to no group when null. Removes it from every
 *  other group first, so "at most one group" holds by construction. `newGroupId`
 *  lets the caller create a group and assign in one atomic update. */
export function setTaskGroup(groups: GroupLike[] | undefined, taskId: string, groupId: string | null): GroupLike[] | undefined;

/** Strip a task id from every group (used on delete and on cross stage move). */
export function removeTaskFromGroups(groups: GroupLike[] | undefined, taskId: string): GroupLike[] | undefined;
```

`BuilderPage`'s `toggleExclusiveMember` (L691–695) is replaced by `setTaskGroup`;
`addExclusiveGroup`/`removeExclusiveGroup` stay but route through `normalizeGroups`.
The delete path at L975–984 is rewritten to call `removeTaskFromGroups` (same behaviour,
one less inline reimplementation).

Badge lookup uses the **already tested** `effectiveExclusiveGroups(stage)` from
`@rushpoint/shared` (read only import, no change there) so the badge shows exactly what
the server will enforce, including "your 1 member group does nothing".

### 1.8 Files and line ranges (2A)

| File | Change |
|---|---|
| `BuilderPage.tsx` L683–695 | mutators re routed through the new pure helpers |
| `BuilderPage.tsx` L845–896 | **replaced** by the one line summary strip + modal opener |
| `BuilderPage.tsx` L898–904 | unchanged (warning kept) |
| `BuilderPage.tsx` L975–984 | delete path uses `removeTaskFromGroups` |
| `BuilderPage.tsx` (new, ~120 lines) | `ExclusiveGroupsModal` local component |
| `BuilderPage.tsx` L~772–780 | pass `groupOf` into `TaskCanvas` |
| `TaskCanvas.tsx` L25–39, L93–102 | forward `groupOf` to `TaskCard` |
| `TaskCard.tsx` L28–38, L73–106 | `group` prop + badge + ring; export `GROUP_STYLES` |
| `lib/reorder.ts` | `+3` pure exports (§1.7) |
| `i18n.ts` L524–538 (HE) / L1313–1327 (EN) | key edits below |

### 1.9 i18n keys (HE + EN, no hyphen or dash of any kind)

Removed: `exclusiveTaskTaken` (concept gone), `exclusiveGroupLabel` (superseded by
`exclusiveGroupLetter`). Kept: `exclusiveLead`, `exclusiveHint`,
`exclusiveRemoveGroup`, `exclusiveUnwinnableWarn`.

| key | HE | EN |
|---|---|---|
| `exclusiveLead` | `רק אחת מתוך:` (kept) | `Only one of:` (kept) |
| `exclusiveGroupLetter(i)` | `'אבגדהוזחטי'[i] ?? String(i+1)` | `String.fromCharCode(65+i)` |
| `exclusiveOpenEditor` | `קיבוץ משימות` | `Group tasks` |
| `exclusiveModalTitle` | `קיבוץ משימות חלופיות` | `Group alternative tasks` |
| `exclusiveModalIntro` | `בחרו משימות שהן גרסאות שונות של אותו אתגר. כל צוות יקבל רק אחת מהן, כך שצוותים שונים מקבלים גרסאות שונות ואי אפשר לצבור את כולן.` | `Pick tasks that are variants of the same challenge. Each team is given only one of them, so different teams get different variants and no team can collect them all.` |
| `exclusiveNoGroup` | `ללא` | `None` |
| `exclusiveNewGroup` | `קבוצה חדשה` | `New group` |
| `exclusiveTaskColumn` | `משימה` | `Task` |
| `exclusiveGroupSummary(letter, n)` | `קבוצה ${letter}: ${n} משימות, הצוות ישלים אחת` | `Group ${letter}: ${n} tasks, a team completes one` |
| `exclusiveGroupInert` | `קבוצה עם משימה אחת אינה משפיעה` | `A group with one task has no effect` |
| `exclusiveChipAria(letter, n)` | `קבוצת חלופות ${letter}, ${n} משימות` | `Alternatives group ${letter}, ${n} tasks` |
| `exclusiveBadgeAria(letter, n)` | `חלופה ${letter} מתוך ${n}, הצוות יקבל רק אחת מהן` | `Alternative ${letter} of ${n}, a team is given only one of them` |
| `exclusiveCeiling(max, total)` | `מקסימום השלמות בשלב הזה: ${max} מתוך ${total}` | `Most a team can complete in this stage: ${max} of ${total}` |
| `exclusiveMaxGroups` | `הגעתם למספר הקבוצות המרבי בשלב` | `You reached the maximum number of groups in a stage` |
| `exclusiveDone` | `סיום` | `Done` |

All strings above are dash free (checked against `scripts/test-no-dashes.ts`'s banned
set `[-‐‑‒–—―]`; the only allowed bar is U+2212 minus, unused here). The `…` in
`exclusiveOpenEditor` was deliberately dropped. `test-no-dashes.ts` invokes function
valued entries with sample args, so the parameterized keys are covered automatically.
`npm run i18n:check` must stay clean and **`i18n:check:strict` must show zero NEW
PART B warnings**: every literal in the modal goes through `t.builder.*`, and the
letters come from `exclusiveGroupLetter`, not from a hardcoded array in the component.

---

## 2. SDD — Point 2B: real drag and drop, and the `העברה לשלב…` select

### 2.1 Library comparison (React 18.3.1 installed)

| | `@hello-pangea/dnd` | `dnd-kit` (`@dnd-kit/core` + `sortable` + `utilities`) |
|---|---|---|
| Lineage / maintenance | maintained fork of the archived `react-beautiful-dnd`; steady releases, but the architecture is frozen (no new capabilities) | actively developed; v6 is the stable line, a v7 rewrite is in progress (watch for churn) |
| React 18 | yes (StrictMode safe since v16) | yes |
| React 19 | yes in recent majors (v17+) | yes in v6.1+ |
| Keyboard | **excellent, built in and non optional**: Space to lift, arrows to move, Space to drop, Esc to cancel, with live region announcements out of the box | **good but opt in**: `KeyboardSensor` + `sortableKeyboardCoordinates`, plus `@dnd-kit/accessibility` live announcer; the default announcements are generic and must be translated |
| Touch | long press to lift, good | `TouchSensor` / `PointerSensor` with `activationConstraint` (delay + tolerance) needed to not fight page scroll |
| Bundle (min+gzip, to be re measured at install) | ~30 to 35 kB | ~13 kB core + ~6 kB sortable + ~1 kB utilities ≈ **~20 kB** |
| Multiple containers (stage to stage) | native (`<Droppable>` per stage) but **all containers must be mounted** inside one `<DragDropContext>` | native (`useDroppable` per container), containers may be anywhere |
| **Virtualized lists** | supported **only** via `renderClone` + fixed height rows, and only with `react-window` / `react-virtualized` patterns; **no supported recipe for `@tanstack/react-virtual`**, and it takes over the DOM aggressively | works with virtualization because it never clones or reparents nodes: it measures via `useDroppable`/`useDraggable` refs and moves with CSS transforms; still needs manual handling for rows that unmount mid drag |
| RTL | `direction` prop, horizontal lists only | direction agnostic (transform based); we drag vertically, so RTL is a non issue |

**Recommendation: `dnd-kit`** (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`).

Reasons, in priority order:
1. It is the only one of the two that can coexist with `@tanstack/react-virtual`
   without ripping out our virtualizer. `@hello-pangea/dnd` would force us to either
   drop virtualization or switch to `react-window`, both large regressions.
2. Half the bundle.
3. `KeyboardSensor` gives real keyboard drag, which is the precondition for removing the
   select (see §2.2).

The honest cost: `dnd-kit`'s keyboard/screen reader story is **weaker than
hello pangea's out of the box** and we must supply translated `screenReaderInstructions`
and `announcements` ourselves (Hebrew + English, through `t.builder.*`). That work is
mandatory, not optional, and is listed in the task plan.

### 2.2 The accessibility question the user must decide

**Flagging this explicitly, as instructed.** The `העברה לשלב…` select is today the only
mechanism that works with:

* a keyboard alone,
* a screen reader,
* a touch device where a long press collides with scroll or with the browser's text
  selection / context menu,
* a creator with a motor impairment for whom press, hold, drag, release across a
  scrolling panel is genuinely hard.

`dnd-kit`'s `KeyboardSensor` restores case 1 and mostly case 2 (Tab to the card, Space
to lift, arrows to move, Space to drop) **only if we also**: (a) make every card a
focusable drag handle with an accessible name, (b) register the stage rail entries as
droppables that keyboard coordinates can actually reach, and (c) ship translated
announcements. Cross container keyboard movement in `dnd-kit` needs a custom
`coordinateGetter` or an explicit `KeyboardSensor` configuration; it is **not free**.

Two options for the user:

* **Option A (recommended): remove the select, keep an equivalent under the keyboard
  shortcut.** Delete the `<select>` from the card face and re expose the same operation
  as a **context menu on the card** (`⋯` button, opens the same stage list) shown only
  on hover/focus, `absolute` positioned so it costs **zero layout space**. Space cost
  is solved (the user's actual complaint), the a11y path survives, and DnD becomes the
  fast path. This is what I recommend.
* **Option B: remove it outright.** Cheaper, and it is a **real accessibility
  regression** for screen reader and motor impaired creators, and a usability risk on
  tablets where our own docs say the Builder is used. I will do it if the user says so,
  but it should be a conscious decision, not a side effect.

Everything below assumes **Option A** unless told otherwise; the only delta for Option B
is deleting the `⋯` menu.

### 2.3 Virtualization: the concrete answer

`TaskCanvas` renders two branches: a plain grid at `≤ 24` tasks and a
`@tanstack/react-virtual` absolute positioned window above that.

Plan:

* **Grid branch (`≤ 24` tasks, the overwhelming majority of real stages):** full
  `SortableContext` with `verticalListSortingStrategy` (the grid is 1 or 2 columns;
  `rectSortingStrategy` for the 2 column case). Everything works normally.
* **Windowed branch (`> 24`):** keep `SortableContext` but with
  `items={tasks.map(t => t.id)}` — the **full** id list, not the windowed slice. This
  matters: `SortableContext` only needs the id ordering, and `useSortable` registers
  only for mounted rows. Rows outside the window are simply not drop targets, which is
  acceptable **because we keep the StageRail drop targets and add edge autoscroll**
  (dnd-kit ships `autoScroll` on by default, on the nearest scrollable ancestor, so our
  hand rolled `onContainerDragOver` edge scroll at `TaskCanvas.tsx` L84–91 is deleted
  and replaced by it). As the container autoscrolls, react virtual mounts new rows and
  they register as droppables mid drag, which is exactly the behaviour dnd-kit's
  `measuring: { droppable: { strategy: MeasuringStrategy.Always } }` is for. That
  measuring strategy is required for the windowed branch and is a small perf cost we
  accept only when `!small`.
* **`DragOverlay`** renders the dragged card outside the scroll container, so the source
  row unmounting (window scrolls past it) does not kill the drag. This is the single
  most important detail and is the reason `@hello-pangea/dnd` cannot do this: it drags
  the real node.

**Do we keep the StageRail drop target? YES.** Reasons: it is always visible regardless
of canvas scroll position; it is the only sane target for a cross stage move in the
windowed branch; and it is already implemented and tested. It changes from a native
HTML5 `onDrop` to a `useDroppable({ id: 'stage:' + s.id })`, which also makes it a
**keyboard reachable** destination.

### 2.4 Stage reordering in StageRail

`StageRail`'s own stage reorder (`StageRail.tsx` L55–72, native HTML5) is migrated to
the **same** `DndContext` as a second `SortableContext` over stage ids. One context, two
sortable containers plus per stage droppables. The `TASK_DND_MIME` sniffing
(`reorder.ts` L11, `StageRail.tsx` L12–15) that disambiguates a task drag from a stage
drag is replaced by dnd-kit's `active.data.current.type` (`'task' | 'stage'`).
`TASK_DND_MIME` is then dead and gets deleted from `reorder.ts` (it has no other
consumer; grep confirms only `TaskCanvas` and `StageRail`).

Where the `DndContext` lives: `BuilderPage`, wrapping the rail + canvas flex row
(`BuilderPage.tsx` L757–...), because a cross container drag needs one shared context.
`onDragEnd` is the single place that decides:

| `active.type` | `over` | action |
|---|---|---|
| `stage` | another stage | `moveStage(from, to)` (existing) |
| `task` | a task in the same stage | `reorderTasks(stageId, from, to)` (existing L716–722) |
| `task` | a task in another stage | `moveTaskToStage(from, taskId, to, index)` |
| `task` | a stage rail entry | `moveTaskToStage(from, taskId, to)` (append) |
| anything | `null` | no op |

### 2.5 Bundle and lazy loading

`@dnd-kit/core` + `sortable` + `utilities` ≈ **20 kB gzip** (to be verified with
`npm run creator:build` output at implementation time). `BuilderPage` is **already**
behind `React.lazy` (`App.tsx` L12), and dnd-kit will only ever be imported from
`BuilderPage`/`StageRail`/`TaskCanvas`/`TaskCard`, all of which are in that chunk. So:

* **No additional `React.lazy` wrapper is needed** — the dependency is already route
  lazy, and the Builder chunk is exactly the chunk that needs it.
* Requirement for the implementation pass: capture the Builder chunk size before and
  after in this doc. If the Builder chunk crosses 500 kB, split `ExclusiveGroupsModal`
  and/or the map preview out rather than lazy loading the DnD context (a lazy DnD
  context would make the first drag fail).
* `maplibre-gl` stays behind its own lazy import; unaffected.

### 2.6 The invariant (non negotiable)

Every cross stage move continues to go through **`moveTaskBetweenStages`** in
`lib/reorder.ts` (L60–108), which already:

* re clamps **both** stages' `requiredTaskCount` via `clampRequiredTaskCount`,
* refuses to empty the source stage,
* returns the identical array reference on a no op.

Nothing is reimplemented in the drag handlers. **One extension is required**:

> A task that leaves a stage must also leave that stage's exclusive groups, because
> groups are stage scoped and a dangling id is silently inert (it would shrink a real
> group to one member with no UI trace).

So `moveTaskBetweenStages` gains: `ReorderStage` gets an optional
`exclusiveGroups?: { id: string; taskIds: string[] }[]`, and the cross stage branch
applies `removeTaskFromGroups(source.exclusiveGroups, taskId)` to the **source** stage
patch (never to the destination: the task arrives ungrouped). The same stage branch is
untouched (order within a stage does not affect membership). This is the one place where
2A and 2B intersect, and it is why they are planned together.

### 2.7 Migration plan (ordered, each step independently green)

1. `npm i -w @rushpoint/creator-web @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`.
2. Extend `lib/reorder.ts` with the group helpers + the `moveTaskBetweenStages` group
   pruning. **RED first** in `scripts/test-builder-dnd.ts`.
3. Ship 2A (modal, badges, strip). No DnD change yet. Gates green here.
4. Introduce `DndContext` in `BuilderPage` and convert `TaskCanvas` grid branch to
   `SortableContext`. Keep the native handlers alive behind nothing (delete them in the
   same commit; running both is worse than either).
5. Convert the windowed branch (`DragOverlay` + `MeasuringStrategy.Always`).
6. Convert `StageRail`: stage `SortableContext` + per stage `useDroppable`. Delete
   `TASK_DND_MIME` and `isTaskDrag`.
7. Delete `TaskCanvas.onContainerDragOver` (dnd-kit autoScroll replaces it).
8. Replace the card `<select>` with the `⋯` overflow menu (Option A) or delete it
   (Option B).
9. Add `screenReaderInstructions` + `announcements`, translated. Run `i18n:check` and
   `i18n:check:strict`.
10. Full gate sweep: `typecheck` · `lint` · `test` · `creator:build` · `play:build` ·
    `i18n:check`. (`e2e` is unaffected — no callable changes — but `npm run verify` is
    the right one command sweep.)

---

## 3. TDD plan

### 3.1 Pure lane — extend `scripts/test-builder-dnd.ts` (auto discovered by `scripts/run-unit-tests.mjs`, pattern `^test-.*\.ts$`)

Written **before** the implementation; the first run must fail on
`Cannot find module` / missing export (record the RED transcript in this doc, as
`docs/wave-b/mutually-exclusive-tasks.md` §6 did).

New sections, appended after the existing §6:

**§7 `normalizeGroups`**
* unknown task ids are dropped
* duplicate ids inside one group collapse
* an id claimed by an earlier group is removed from the later one
* an emptied group is dropped
* an all empty result returns `undefined` (so the stage patch clears the field)
* a 1 member group is **kept** (mid edit) but is inert per `effectiveExclusiveGroups`

**§8 `setTaskGroup`**
* assigning to a group removes the task from every other group (at most one, by construction)
* assigning `null` removes it from all groups
* assigning to a group it is already in is a no op returning the same reference
* assigning to a non existent group id is a no op
* creating a group and assigning in one call yields exactly one group with one member

**§9 `removeTaskFromGroups`**
* strips the id from every group
* a group reduced to 0 members disappears
* a group reduced to 1 member survives but `effectiveExclusiveGroups` reports it inert
* unknown id returns the same reference

**§10 `moveTaskBetweenStages` × groups (the intersection)**
* cross stage move strips the moved task from the SOURCE stage's groups
* the destination stage's groups are untouched, and the arriving task is ungrouped
* a source group reduced to 1 member no longer constrains (assert via
  `effectiveExclusiveGroups` imported from `packages/shared/src/mutualExclusion`
  **source**, never the shared `dist` — same rule as `test-mutual-exclusion.ts`)
* **both** stages' `requiredTaskCount` are still clamped (regression guard for the
  existing §4 assertions, re asserted with groups present)
* same stage reorder leaves `exclusiveGroups` byte identical (same reference)
* moving the last task out is still refused **and does not mutate groups**

**§11 group presentation helpers (pure)**
* `groupIndexOfTask(stage, taskId)` returns the index used to pick `GROUP_STYLES`
* index is stable under a same stage reorder (badge letters must not shuffle when the
  creator reorders cards)
* index modulo 6 wraps for a 7th group while the letter does not repeat
* `maxAttainableCompletions` after a cross stage move matches what the modal footer
  would render (guards the unwinnable warning against drift)

**§12 unwinnable invariant (property style, seeded)**
* for a few hundred seeded random stages: after any sequence of
  `setTaskGroup` / `moveTaskBetweenStages` operations,
  `requiredTaskCount === undefined || requiredTaskCount <= tasks.length`, and no task id
  appears in two groups. This is the cheapest possible guard against the exact class of
  bug the user is worried about.

### 3.2 What is honestly NOT testable in the pure lane

* **The drag gesture itself.** Pointer/keyboard sensors, `DragOverlay` positioning,
  autoScroll, and dnd-kit's collision detection all need a real DOM with layout.
  `jsdom` reports zero sized rects, so dnd-kit's measurement is meaningless there —
  a jsdom test would pass while the feature is broken. I will not write one and claim
  coverage.
* **Virtualized drop targets.** Whether a row mounts in time mid autoscroll is a
  timing + layout property. Not unit testable.
* **Colour contrast / colourblind legibility.** Not machine checkable here.

What we *can* do beyond the pure lane:

* **`npm run test:ui` (Playwright, from the 2026-07-05 bug hunt)** already exists as a UI
  render smoke lane. Realistic additions, in increasing cost:
  1. **Render smoke** (cheap, worth it): open the Builder on a seeded game, assert the
     group summary strip renders, open the modal, click a letter radio, assert the task
     card shows a badge with that letter, assert the `העברה לשלב…` select is gone.
     This is plain clicking, no dragging, and it covers all of 2A.
  2. **Keyboard drag** (worth it, and it is the *proof* for the §2.2 decision): focus a
     card, `Space`, `ArrowDown`, `Space`, assert the order changed. Playwright drives
     real keys against a real layout, so this is meaningful. It is the only automated
     evidence that removing the select did not strand keyboard users.
  3. **Pointer drag** (flaky, low value): `mouse.move` sequences against dnd-kit need
     several intermediate moves and are timing sensitive. I would add **one** happy path
     intra stage drag and no more, or skip it entirely. Cross stage pointer drag onto
     the rail should be verified manually.
* Manual checklist for the implementation pass: tablet touch (real device or Chrome
  device emulation), RTL Hebrew layout, a 60 task stage (windowed branch), and a
  cross stage drag while the canvas is scrolled to the bottom.

---

## 4. Regression risk list

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Unwinnable stage**: a cross stage move that skips `clampRequiredTaskCount` on either side | all moves funnel through `moveTaskBetweenStages`; §10 + §12 tests |
| 2 | **Silent group corruption**: moved task leaves a dangling id, shrinking a group to 1 member with no UI trace | `removeTaskFromGroups` inside `moveTaskBetweenStages`; §10 tests; inert group is now *shown* as inert in the modal |
| 3 | **Two groups claiming one task** | radio interaction makes it structurally impossible; `normalizeGroups` enforces on write; §7/§8 tests; `validateExclusiveGroups` still reports it as an error if legacy data has it |
| 4 | **Drag breaks in the windowed branch** when the source row unmounts | `DragOverlay` + `MeasuringStrategy.Always` only in the `!small` branch; StageRail droppables retained as the always available escape hatch |
| 5 | **A11y regression from deleting the select** | Option A `⋯` menu + `KeyboardSensor` + translated announcements + the Playwright keyboard drag test. **User decision required, see §5** |
| 6 | **Touch regression**: long press to drag fights page scroll on tablets | `PointerSensor` with `activationConstraint: { delay: 200, tolerance: 6 }`; explicit drag handle (`⠿`) rather than whole card draggable, so a tap still opens the panel |
| 7 | **Card click vs drag conflict**: the card root is `role=button` and opens the panel | activation constraint + restrict the drag listeners to the `⠿` handle; keep `onClick` on the body |
| 8 | **Bundle crosses 500 kB** in the Builder chunk | measure before/after; split the modal if needed; never lazy load the DnD context itself |
| 9 | **Tailwind purge drops group colours** because a class is built dynamically | fixed `GROUP_STYLES` literal array; no template class anywhere; add a lint note in the file header |
| 10 | **RTL breakage** from dnd-kit transforms or new modal chrome | vertical dragging only; logical classes only (`ms-/me-/ps-/pe-/text-start`); manual RTL pass |
| 11 | **i18n leak**: the modal is the largest new copy surface in months | every literal via `t.builder.*`; `i18n:check` clean, `i18n:check:strict` zero NEW PART B warnings; `test-no-dashes.ts` covers the parameterized keys |
| 12 | **Undo/redo**: a drag must be ONE `useHistory` step, not one per intermediate `onDragOver` | commit state only in `onDragEnd`; never call `setStages` from `onDragOver` |
| 13 | **Open task panel points at a stale (stageId, taskId)** after a cross stage drag | existing guard at `BuilderPage.tsx` L733 (`setEditing(null)`) must be preserved in the new handler |
| 14 | dnd-kit v7 rewrite churn | pin to the v6 line in `package.json`; do not use `^` across a major |
| 15 | Removing `TASK_DND_MIME` breaks an unseen consumer | grep confirmed only `TaskCanvas` + `StageRail`; re grep at implementation time |
| 16 | StrictMode double invoke of sensors in dev | dnd-kit v6 is StrictMode safe; verify with `npm run dev:all` manually |

---

## 5. Things I think are a bad idea, and decisions the user must make

**Decisions required before implementation:**

1. **[BLOCKING] The a11y trade off in 2B.** Removing `העברה לשלב…` with nothing in its
   place is a genuine accessibility regression for screen reader users, keyboard only
   users, and motor impaired creators, and a usability risk on the tablets this Builder
   is used on. dnd-kit's `KeyboardSensor` closes most of the gap **only after** we wire
   an explicit drag handle, keyboard reachable cross container targets, and translated
   announcements. My recommendation is **Option A** (§2.2): delete the select from the
   card face, keep the same operation behind a hover/focus revealed `⋯` menu that costs
   zero layout space. That gives the user exactly what they asked for (the space back)
   without the regression. **If the user insists on Option B (delete outright), I will
   do it, but it is on the record as a deliberate a11y regression.**
2. **Where the modal lives.** I plan `ExclusiveGroupsModal` as a local component inside
   `BuilderPage.tsx` to stay inside my file ownership, which pushes that file past 1200
   lines (there is already an open code review item about god files). Extracting it to
   `components/ExclusiveGroupsModal.tsx` is cleaner; it is a **new** file so it collides
   with nobody, but it is outside the listed ownership. Say which you prefer.
3. **Colourblind mode.** creator-web has **no** colorblind flag (only play-web does).
   My design is unconditionally colourblind safe (letter + border + text label always
   present), so no flag is needed. If you want a real creator side toggle for parity,
   that is a separate change touching `LanguageContext.tsx` and the Settings page, which
   are outside this scope.
4. **Group letters in Hebrew.** I propose `א ב ג` in HE and `A B C` in EN rather than
   `1 2 3` everywhere, because a number collides visually with the stage numbers
   (`שלב 1`) and with `requiredTaskCount`. If you would rather have language neutral
   numbers, that is a one key change, but say so now.

**Things I think are bad ideas (and am not planning):**

* **Dragging tasks into group buckets.** It looks appealing but reintroduces the whole
  2B accessibility problem inside 2A, needs permanent vertical space for the buckets
  (the exact bloat wave C removed), and is untestable in the pure lane. Radios are
  compact, keyboard native and fully testable.
* **`@hello-pangea/dnd`.** Its virtualization story would force us off
  `@tanstack/react-virtual` onto `react-window`. That is a much bigger, riskier change
  than the one the user asked for, for a better keyboard default we can reach with
  dnd-kit for far less.
* **Colour only group coding on the card's inline start rail.** That rail already
  encodes task type. Overloading it would make both signals unreadable, and colour alone
  fails the colourblind requirement.
* **Running native HTML5 DnD and dnd-kit side by side during the migration.** Two drag
  systems on the same nodes produce ghost drags and duplicated drops. Each conversion
  step deletes the native handlers it replaces, in the same commit.
* **A jsdom based "drag test".** It would pass while the feature is broken (zero sized
  rects), which is worse than no test. Keyboard drag goes to Playwright or nowhere.
* **Auto deleting a group the moment it drops to one member.** Destructive mid edit
  (the creator is about to add the second member). We keep it, show it greyed with
  "אינה משפיעה", and let the model's existing inertness rule do the rest.
* **Touching `packages/shared/src/mutualExclusion.ts`.** It is done, tested and server
  enforced. This whole change is presentation only.

---

## 6. Estimated task ordering for the implementation pass

RED → GREEN → REFACTOR, per the project's TDD rule:

1. RED: `scripts/test-builder-dnd.ts` §7 to §12 (fails: exports do not exist).
2. GREEN: `lib/reorder.ts` group helpers + `moveTaskBetweenStages` group pruning.
3. i18n keys (HE + EN), `i18n:check` + `test-no-dashes` green.
4. 2A: `TaskCard` badge + `GROUP_STYLES`, `TaskCanvas` forwarding, `BuilderPage` strip +
   modal. Gates green.
5. 2B steps 1 and 4 to 7 of §2.7 (dnd-kit migration). Gates green.
6. 2B step 8 (`⋯` menu or deletion, per the user's §5.1 decision).
7. Announcements + Playwright smoke/keyboard tests.
8. `npm run verify`, record the Builder chunk size delta in this doc, then commit.

---

## 7. Implementation record (2026-07-21)

### 7.1 User decisions applied

| § | Decision | What shipped |
|---|---|---|
| 5.1 | **Option A** | The labelled `העברה לשלב…` select is gone from the card face. The same operation survives as a **native `<select>` collapsed to a `⋯` glyph** (~2rem instead of 8rem), revealed by `opacity` on hover or focus with its width reserved so the row never shifts. A native select was chosen over a custom popover because its popup is browser rendered, so it can never be clipped by the canvas scroll container, it is a real listbox for screen readers, and it becomes the OS picker on a tablet. |
| 5.2 | dnd-kit | `@dnd-kit/core@^6.3.1` + `@dnd-kit/sortable@^10.0.0` + `@dnd-kit/utilities@^3.2.2`, pinned inside the v6 core line. Stage reordering moved into the same `DndContext`; `TASK_DND_MIME` and `isTaskDrag` deleted. |
| 5.3 | Three surface design | Shipped as designed: constant height summary strip, letter+colour+border badges, radio modal. |
| 5.4 | Hebrew letters | `א ב ג …` in HE, `A B C …` in EN, via `exclusiveGroupLetter(i)`. |

The modal was extracted to its own file, `components/ExclusiveGroupsModal.tsx`, rather
than growing `BuilderPage.tsx` past 1200 lines (a new file collides with nobody).

### 7.2 Bundle delta

Measured with `npm run creator:build`, before and after, with dnd-kit installed but
unimported for the baseline:

| | raw | gzip |
|---|---|---|
| before | 112.67 kB | 31.53 kB |
| after | 170.99 kB | 49.90 kB |
| **delta** | **+58.3 kB** | **+18.4 kB** |

That covers dnd-kit's three packages plus the modal and the strip. `BuilderPage` is
already `React.lazy` in `App.tsx` and dnd-kit is imported only from files inside that
chunk, so **no extra lazy boundary was added** — confirming §2.5. The chunk is far
under the 500 kB threshold at which the plan said to split the modal out.

### 7.3 Three real defects the browser pass caught

1. **Space on the ⠿ handle also opened the task editor.** The card root is
   `role="button"` with an Enter/Space handler, and the keydown bubbled into it from
   the handle. The first fix (`stopPropagation` on the handle) was **wrong**: it
   blocked the drop key from reaching dnd-kit's own listener, so a lift could never be
   committed from the keyboard. The correct fix is in the card root — it now ignores
   any keydown whose `target` is not the card itself, so nothing is swallowed and
   dnd-kit sees every key.
2. **The virtualized branch fought dnd-kit for the `transform` slot.** react-virtual's
   row positioning was rewritten from `transform: translateY()` to `top`, leaving
   `transform` free for the drag translation. With both on `transform`, the second one
   written silently wiped the first.

3. **Arrow keys barely worked.** dnd-kit's stock `sortableKeyboardCoordinates`
   navigates **geometrically**, which falls apart on a canvas that is a 2 column grid
   rendered right to left: the first ArrowDown landed between rows and read as a dead
   key, and after one horizontal step the walk got stuck. Replaced with
   `arrowKeyCoordinates` in `BuilderPage.tsx`, which walks the **sortable order**
   instead (Down/Up = next/previous always; Left/Right follow `document.dir`). It
   falls back to the containers' own rects when the measuring pass has not produced a
   `collisionRect` yet, because returning nothing there silently swallowed the
   creator's first arrow press. Also fixed in passing: the card's accessible name was
   being computed from its contents and therefore started with the ⠿ handle's drag
   instruction, so a screen reader announced the card AS the handle. It is now named
   after the task.

**Keyboard drag, as shipped:** Tab to the ⠿ handle, Space lifts (announced
`הרמתם את <task>`), Up/Down step through the stage's tasks (announced
`<task> נמצאת כעת מעל <other>`), Space drops (`<task> שוחררה במקום החדש`), Escape
cancels (`הגרירה של <task> בוטלה`). All six strings are `t.builder.dnd*`, HE and EN.
**Cross STAGE moves are not reachable by keyboard drag** — a list-order getter cannot
step into another container. That path is the card's ⋯ menu, which is a real native
listbox and works with a keyboard, a screen reader and a touch device.

### 7.4 Cross stage move and the source stage's groups

`moveTaskBetweenStages` now applies `removeTaskFromGroups` to the **source** stage's
patch, never the destination (the task always arrives ungrouped), and only when the
source actually had an `exclusiveGroups` field, so a group free stage never sprouts the
key. A group reduced to one member survives rather than being deleted mid edit, and the
modal shows it greyed with `קבוצה עם משימה אחת אינה משפיעה` — the model already treats
it as inert. Both stages are still `clampRequiredTaskCount`ed. Covered by §10 of
`scripts/test-builder-dnd.ts`.

### 7.5 Test lanes as promised in §3.2

* Pure lane: `scripts/test-builder-dnd.ts` grew §7 to §12 (43 new checks, including the
  400 iteration seeded property sweep). RED first, then GREEN.
* Playwright: `e2e-ui/builder-groups.creator.spec.ts` — the 2A render smoke, the modal
  round trip with the live ceiling warning, and the **keyboard drag**. Named
  `*.creator.spec.ts` so the existing `creator` project picks it up without editing
  `playwright.config.ts`. It self provisions its account and fixture game through the
  emulator and SKIPS when the emulator is down, so `npm run test:ui` stays green in the
  no emulator configuration.
* No jsdom drag test was written, exactly as §3.2 said.

Six Playwright cases: the 2A render smoke, the modal round trip with the live ceiling
warning, a 390x844 RTL + zero horizontal overflow check (page **and** modal), the
cross stage move stripping the source groups, one pointer drag, and the keyboard drag.

**Known flakiness, honestly:** the drag cases fail intermittently when the machine is
loaded, because Playwright can press the next key inside the same frame in which
dnd-kit is still flushing `over` to React state. The keyboard case now waits on the
live region before dropping, which fixed it. A human is never that fast. The `1 failed`
runs observed during development all correlated with 30s+ suite times, i.e. an emulator
that was mid restart, not with the feature.

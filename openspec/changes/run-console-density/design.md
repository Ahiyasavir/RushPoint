## Context

`runConsoleLayout.ts` already answers "what is on screen right now?" as DATA: `buildRunConsolePlan`
takes one state object and returns groups with their visible panels. What it does NOT answer is
where each panel sits horizontally. That half of the layout lives as literal Tailwind in
`RunConsolePage.tsx`: `grid lg:grid-cols-3` with a hardcoded `lg:col-span-2` main lane whose three
occupants are all conditional. When they are absent the lane is empty and the page wastes two thirds
of its width, while everything else queues below the fold.

The console is contended: a photo-review-throughput lane is editing the same page right now, and
recent lanes added an attention badge, an out-of-bounds release, a held-for-consent badge and a
task-availability panel. So the design has to put as much of the change as possible into the pure
module and keep the JSX diff to a container plus lane wrappers.

## Goals / Non-Goals

**Goals**
- Fill the width of a desktop viewport so more of the console is above the fold.
- Keep the phone layout byte-for-byte equivalent in ORDER: one column, the plan's own order.
- Make placement a pure function that can never silently drop a panel.
- Keep the JSX diff small and collision-tolerant.

**Non-Goals**
- No visual redesign, no colour changes, no new components, no changes to `components/ui.tsx`.
- No new or changed copy (a layout change should not touch the dictionaries at all).
- No change to which panels are visible: `buildRunConsolePlan` keeps sole ownership of visibility.
- No masonry / CSS `columns`: interactive panels must not be split across a column break.

The owner then rejected the accordion model outright and asked for "a side panel that opens like in
the builder web". So the disclosure model changes as well as the width.

## Decisions

### D0 — The accordions become a Builder style rail, and the pinned zone stays outside it

`StageRail.tsx` is the established pattern in this product: an `aside` that is a vertical rail at the
wide breakpoint and a horizontally scrolling strip below it, entries as bordered tiles with
`border-rp-fire bg-rp-fire/10` for the selected one. The run console adopts exactly that shape and
those classes, so the two consoles read as one product. It is NOT extracted into a shared component:
`StageRail` is a `dnd-kit` sortable/droppable stage list whose entries carry a drag activator and a
`PacingBar`, and pulling a generic rail out of it would mean editing a Builder file that is itself
under active development for no behavioural gain. The run console's rail is ~25 lines of the same
markup with no drag machinery.

The rail replaces the accordion list only. The PINNED zone (alerts, control bar, join/QR, station QR,
broadcast, live map) stays above the rail and always visible. An SOS behind a navigation click would
be a strictly worse console than the one being fixed, and "primary is never collapsible" was already
this module's rule.

The badge chips a folded `Advanced` header used to show move onto the rail entries unchanged, from
the same `GroupSummary` the panel renders, so a pending-photo count on a section you are NOT looking
at is still visible. That was the whole point of the folded summaries and it survives.

### D0a — Reachability replaces expansion, and is the property under test

With accordions, a mis-grouped panel was merely collapsed. With a rail, a panel in no section is
INVISIBLE and unreachable. So `panelPlacement(id)` is total over the catalogue by construction (it
reads `PANEL_GROUP`, the closed record that already fails typecheck if a panel is unranked), and the
test asserts that the pinned panels plus every section's panels equal the plan's visible panels
exactly, once each, at all three run statuses.

### D0b — Default section, and the stale-selection fallback

The default is `teamsAndScores`: who is stuck, who is out of bounds, who is held for consent, plus
the standings everyone asks about. That is the incident surface, not a consult-once one.
`resolveSection(sections, stored)` returns the stored id only if that section is currently rendered,
else the default if IT is rendered, else the first available, else `null`. A stale localStorage value
from a previous run state can therefore never leave the console blank. The staff-invite flow keeps
its old behaviour by navigating (`openSection('shareAndScreens')`) where it used to auto-expand.

### D1 — Placement is a second pure pass over the SAME plan

`buildRunConsolePlan` decides existence; `assignPanelColumns` decides position. Splitting them keeps
the existing test suite meaningful and means the placement rule can be exercised over
`ALL_PANEL_IDS` directly, independent of any run state.

Signature: `assignPanelColumns(panels: PanelId[], columns: ColumnCount): ColumnLayout` where
`ColumnLayout = { columns: PanelId[][]; spans: number[]; gridColumns: number }`.

`spans` and `gridColumns` exist because one panel — the live team map — is genuinely wide and looks
wrong in a third of the page. A lane's span is the max span of the panels in it; `gridColumns` is the
sum of the lane spans, which is what the grid template class is chosen from.

### D2 — The distribution algorithm: priority order, least-loaded lane, lowest index on tie

Round-robin was rejected: it scatters by input order rather than by importance, so a
low-priority panel can take the top of lane 0. Instead:

1. `columns === 1` → return `{ columns: [panels] }` with the input order **untouched**. The phone
   layout is defined as "exactly what the plan produced", so it cannot regress by construction.
2. `columns > 1` → stable-sort a copy by `panelPriority`, then walk it and drop each panel into the
   lane with the smallest accumulated `panelWeight` (ties → the lowest lane index).

That is deterministic (no randomness, no Date, no Math.random), stable (a stable sort plus a
deterministic tie-break), and balanced (greedy least-loaded is the standard number-partitioning
heuristic and is good enough for six-to-ten boxes). The highest-priority panel always lands at the
top of lane 0, which in RTL is the top of the inline-START lane, i.e. where a Hebrew reader looks
first.

Lane count is `min(columnCount, panels.length)`, so two panels never produce a third empty lane, and
an empty panel list produces no lanes at all rather than a row of empty grid cells.

### D3 — The priority order, and why

Ranked by "what does the organizer reach for while something is going wrong", which is the only
moment the console's layout actually matters:

1. `alerts` — an SOS. Nothing outranks a participant in trouble.
2. `startTeams` — the control bar. If the run has not started, nothing else in the console matters.
3. `teams` — who is stuck, out of bounds, held for consent, needing attention. The single most-read
   surface during a run.
4. `liveStandings` — the second most-read surface, and the one everyone asks about.
5. `broadcast` — the fastest way to act on what the two panels above just told you.
6. `liveMap` — where everyone is. High value, but consulted after the roster, not before.
7. `photoReview`, `chat` — human-in-the-loop queues; they are work, not incident response.
8. `taskAvailability` — taking a dead stop out of play. Rarer than the above, but it IS an incident
   control, so it leads the optional game systems.
9. `hotZone`, `flashMission`, `zones`, `trackables`, `feed` — optional game systems and the photo
   feed: enrichment, never urgent.
10. `joinShare`, `stationQr`, `shareScreens`, `staffInvite` — setup artifacts. Needed intensely for
    five minutes and then not again.
11. `finalStandings`, `runSummary`, `analytics`, `heatmap`, `feedback`, `survey` — post-run reading.
    By definition nothing is going wrong any more.

**The join/QR card is the one state-dependent rank.** The brief explicitly asked for a decision and a
justification, and the honest answer is that its importance inverts: while `teamCount === 0` it is
the ONLY thing the organizer is doing (reading the code out, holding the QR up), and once anybody has
joined it becomes reference material. So `buildPrimaryLayout(plan, columns, { teamCount })` promotes
`joinShare` to the head of the ordering when `teamCount === 0`, and otherwise leaves it at its
catalogue rank. It is never hidden and never collapsed — a run can gain a late joiner at any time,
and a host who cannot find the code mid-event is a worse failure than a wasted card. Re-ranking is
reversible and costs nothing; collapsing would have needed new copy, new state and a new way to be
wrong.

### D4 — Unknown panel ids are placed, not dropped

`panelPriority(id)` returns `PANEL_PRIORITY.length` for anything it does not know, and
`panelWeight(id)` returns the median weight. So a panel added to the catalogue by a future lane that
forgets to rank it still renders, at the tail of the ordering, instead of disappearing from a live
console. The closed `PanelId` union plus the catalogue test makes forgetting loud at build time; this
makes it harmless at run time. Silent omission is the exact regression class this repo has paid for
before (the payload-omission class), so the tests assert it directly.

### D5 — The section pane gets one lane fewer than the pinned zone

`sectionColumnCount(columns) = max(1, columns - 1)`. The section pane sits BESIDE the rail, so it is
about 13rem narrower than the full-width pinned zone; giving it the same lane count would make each
lane too tight for the roster and the standings tables. So: 3 lanes pinned / 2 in the pane on the
widest viewport, 2 / 1 in the middle band, 1 / 1 on a phone.

### D6 — The column count comes from the existing hook, and CSS is the backstop

`useMediaQuery` (added by the mobile-responsive pass) is the only breakpoint mechanism in the app and
is reused as-is. Two queries feed a pure `consoleColumnCount({ medium, wide })` → `1 | 2 | 3`. The
hook returns `false` with no `window`, so the no-JS / pre-hydration answer is 1 column, the phone
layout.

The query boundaries are deliberately the SAME ones the emitted classes use: `(min-width: 1024px)` is
Tailwind's `lg`, and `(min-width: 1536px)` is `2xl`. Had the hook flipped at 640px while the classes
flipped at 1024px, a 800px viewport would have been told "two lanes" by JS and rendered one by CSS.

Belt and braces: the emitted grid classes are `grid grid-cols-1 lg:grid-cols-N`, static strings from
a lookup (never `grid-cols-${n}`, which Tailwind cannot see). Even if the hook were wrong, a phone
viewport renders one column and the lanes stack in priority order: degraded, never broken. The rail
uses the same `lg` boundary, so below it the navigator is a horizontal strip and nothing on a phone
is ever a side panel.

### D7 — RTL

Everything here is logical by construction: CSS Grid lane order follows the writing direction, so
lane 0 is the inline-start lane in both directions, and no physical `ml-`/`left-` utility is
introduced. The `col-span-2` utility is direction-neutral. The one existing physical-looking class on
the page, `ms-auto`, is already logical. creator-web has no RTL scanner (only play-web's
`scripts/lib/playA11yScan.ts`), so this is asserted by review, not by a gate.

### D8 — Vertical tightening is a rhythm step, not a redesign

`space-y-5` → `space-y-4` and `gap-5` → `gap-4` on this page's own containers, and the `/run/` route
gets the wider shell container the Builder route already uses. No panel's internal padding, no card
radius, no colour, no font size, and nothing in `components/ui.tsx` changes.

## Risks / Trade-offs

- **No visual verification is possible.** A live playtest stack serves from this tree, so browser,
  preview and emulator tools are all off limits. Mitigation: the placement rule is fully unit-tested,
  the JSX change is structural (lanes over a hardcoded span), no copy moves, and the phone path is
  pinned by both the pure test and the CSS backstop.
- **Contended page.** The pinned blocks move into the existing `renderPanel` switch as new cases
  ahead of `case 'teams'`, which is a different region from the photo-review case, and the accordion
  list is replaced in one contiguous block of the return statement. Nothing inside any panel body is
  touched, so a lane still editing `case 'photoReview'` merges cleanly. The page was re-read
  immediately before the edit and was not mid-edit.
- **Every recent capability survives.** The task-availability panel, the attention badge, the
  out-of-bounds release, the held-for-consent badge and the photo-review panel are rendered by the
  same `renderPanel` switch, unmodified, and the coverage test proves each is still reachable. What
  changed is only which container calls `renderPanel`.
- **The accordion state API is deleted, not deprecated.** `readGroupState` / `writeGroupState` /
  `groupStateKey` / `DEFAULT_GROUP_OPEN` had exactly one consumer (this page) and their tests are
  replaced by the section tests. Leaving them would leave dead code plus tests that assert a UI that
  no longer exists. A creator's stored accordion preference is simply ignored, which is correct: the
  accordions are gone.
- **Greedy balancing is not optimal packing.** With six boxes it does not need to be; determinism and
  stability matter more than a perfect balance, and both are asserted.
- **Weights are estimates.** They are declared constants with a documented default, so a lane that
  reads badly is a one-line constant change, not an algorithm change.

## Test Strategy

Pure lane, vitest, extending `apps/creator-web/src/lib/__tests__/runConsole.test.ts` (the existing
catalogue assertions are reused, not duplicated). RED before GREEN.

1. **Catalogue totality of the ordering** — `PANEL_PRIORITY` contains exactly `ALL_PANEL_IDS`, once
   each, and every panel has a defined weight and span.
2. **Placement totality** — for every column count, `assignPanelColumns(ALL_PANEL_IDS, n)` flattens
   back to exactly `ALL_PANEL_IDS` (no drop, no duplicate). The failure mode this exists to prevent.
3. **Phone identity** — `columns === 1` returns one lane whose contents are the input array in the
   input order, for the catalogue and for a real live plan.
4. **Determinism and stability** — two calls with the same input are deeply equal; a pinned expected
   distribution for a real live plan and for the pre-start plan, so a change to the rule has to be
   deliberate.
5. **Priority is honoured** — `alerts` leads lane 0 on a live plan with an alert; no post-run panel
   is ever placed ahead of an incident panel.
6. **The join card's inversion** — `joinShare` leads when `teamCount === 0` and does not when teams
   have joined, and is present in both cases.
7. **Unknown ids** — an id absent from the ordering is still placed exactly once, at the tail, and
   does not throw; `panelPriority`/`panelWeight`/`panelSpan` are total over arbitrary strings.
8. **Empty input** — no lanes, `gridColumns` still a valid grid width, no throw.
9. **Spans** — a lane holding `liveMap` spans 2, others span 1, and `gridColumns` is the sum.
10. **Lane count** — never more lanes than panels; never more than the requested column count.
11. **Section coverage** — `panelPlacement` is total and single-valued over the catalogue; the pinned
    panels plus every section's panels equal the plan's visible panels exactly, once each, at all
    three statuses; no pinned panel appears in a section; empty sections are suppressed; sections
    come out in `SECTION_ORDER`, which is `GROUP_ORDER` minus the pinned group.
12. **Section selection** — the default is the incident section; a valid stored id is honoured; an
    empty, stale, junk or pinned-group id falls back to a section that exists; `null` only for an
    empty rail; the storage key is per run.
13. **Section pane lanes** — `sectionColumnCount` is one less, floored at one.
14. **Class lookup** — every reachable `gridColumns` and span maps to a non-empty static class string
    containing no `${` interpolation, and always keeps `grid-cols-1` as its base.

Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`, `npm run play:build`,
`npm run bundle:budget`, `npm run i18n:check:strict`. No emulator lane is run (a live stack owns it).

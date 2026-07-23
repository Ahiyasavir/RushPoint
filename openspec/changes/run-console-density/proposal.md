## Why

The product owner, looking at a live run on a desktop, reported: "in the game panel all of the area
on the right side on top is empty, try to do as less scrolling as possible."

The screenshots back it up. The Run Console's primary zone is a fixed
`grid lg:grid-cols-3` with a hardcoded `lg:col-span-2` main lane
(`apps/creator-web/src/pages/RunConsolePage.tsx:790`). That main lane holds three panels that are all
CONDITIONAL: alerts (only when a team raised one), the routine control bar (one thin row of buttons)
and the live team map (only once at least one team has reported a position). In the state the owner
was looking at — a run that has just launched, nobody joined yet — the two-thirds lane contains a
single button row and then nothing at all, while the one-third lane carries the whole join card.
Two-thirds of the widest part of the page is empty, and because the app is Hebrew-first RTL that
empty two-thirds sits on the RIGHT. Exactly what was reported.

Underneath that, every collapsible group (`Advanced`) is rendered full width, one under the other,
so the teams list, the moderation queue, the game systems and the share surface queue vertically
even on a 2560px screen. And the whole console is capped at the shell's `max-w-6xl` (1152px), which
was chosen for the Dashboard and the Gallery, not for an operations console.

The cost is paid at the worst possible moment: during a live event, the organizer scrolls to reach
controls that a wide screen could show all at once.

Shown the accordions themselves (`מערכות משחק`, `שיתוף ומסכים`, `אחרי הריצה`), the owner then added:
"i also dont like these panels that are opening, it also takes a lot of time to scroll and really
annoying, try doing something like a side panel that opens like in the builder web". So the accordion
model goes too: reaching a control means scrolling to find a header and then scrolling again through
whatever it unfolds, twice, during a live event.

## What Changes

**The console's column placement becomes a pure, tested decision, not a hardcoded span.**
`apps/creator-web/src/lib/runConsoleLayout.ts` already owns "which panels exist and in which group"
for exactly this reason. It gains the second half of the layout question: given the visible panels
and a column count, WHICH LANE does each panel go in, and in what order.

- A total priority ordering over the panel catalogue, ranked by what an organizer needs during an
  incident, plus a per-panel vertical weight and a per-panel span.
- `assignPanelColumns(panels, columnCount)`: one column returns the input order UNCHANGED (the phone
  layout is defined as "whatever the plan already produced"); more than one column distributes by
  priority into the least-loaded lane, deterministically and stably.
- Totality is the property the tests defend: every visible panel is placed EXACTLY ONCE. A panel id
  the module has never heard of gets a defined position at the tail instead of vanishing, which is
  the failure mode a silently-dropped live-ops control would be.
- The join/QR card is promoted to the front of the ordering while `teamCount === 0` and demoted
  behind the incident controls once anybody has joined. It is the first thing needed and then never
  needed again; it is not deleted or hidden, only re-ranked.

**The accordions are replaced by the Builder's rail.** The same module gains the section model:
`SECTION_ORDER` (derived from `GROUP_ORDER` minus the pinned group, so the two cannot drift),
`panelPlacement` (pinned or exactly one section), `buildRunConsoleSections`, a `DEFAULT_SECTION` of
teams-and-standings, and `resolveSection`, which degrades a stale or malformed stored selection to a
section that actually exists instead of a blank console. The console renders `StageRail`'s pattern: a
vertical rail at `lg` and up, a horizontally scrolling strip below it, `aria-current` on the selected
entry, and the badge chips the folded headers used to carry now living on the rail entries. The
pinned zone (alerts, control bar, join/QR, station QR, broadcast, live map) stays outside the rail
and always on screen, because an SOS must never be one navigation away.

**The Run Console renders lanes instead of a fixed 2/1 split.** The pinned zone and the selected
section each map over computed lanes. Column count comes from the EXISTING `useMediaQuery` hook (no
second breakpoint mechanism), and the grid classes are static Tailwind strings with a
`grid-cols-1 lg:grid-cols-N` shape whose breakpoint is the SAME 1024px the hook uses, so the JS
answer and the CSS answer cannot disagree and a phone stays single column either way.

**Vertical waste on this page only** is reduced: the page's own `space-y-5` / `gap-5` rhythm drops
one step to `space-y-4` / `gap-4`, and the console route gets the wider shell container the Builder
already uses instead of the Dashboard's `max-w-6xl`.

## Impact

- Affected specs: `run-console-density` (new capability, ADDED requirements).
- Affected code: `apps/creator-web/src/lib/runConsoleLayout.ts` (the pure placement rule),
  `apps/creator-web/src/lib/__tests__/runConsole.test.ts` (extends the existing catalogue
  assertions), `apps/creator-web/src/pages/RunConsolePage.tsx` (the rail plus the lane containers,
  and moving the three inline pinned blocks into the existing `renderPanel` switch),
  `apps/creator-web/src/i18n.ts` (ONE new key, HE and EN), `apps/creator-web/src/App.tsx` (one shell
  width branch for the `/run/` route).
- NOT touched: `components/ui.tsx` and every other shared primitive (other pages depend on them), the
  colour scheme, every existing string (the section titles reuse the `group*` keys already in both
  dictionaries), any callable, any Firestore rule, `runConsoleActions.ts`, `photoReviewQueue.ts`,
  `teamAttention.ts`, and `scripts/e2e-verify.mjs`.
- Preserved by construction: the task-availability panel, the attention badge and count, the
  out-of-bounds release, the held-for-consent badge and the photo-review panel are all still rendered
  by the same `renderPanel` switch and are all still reachable, which the coverage test asserts.
- NOT verified visually: a live playtest stack is serving from this tree, so no browser, preview or
  emulator tool could be used. Every change is therefore deliberately conservative and the placement
  rule is proven by unit test rather than by looking at it.

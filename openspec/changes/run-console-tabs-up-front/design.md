## Decisions

### D1: sections first

`RunConsolePage` renders, in order: run header → signals chip row → `ConsoleTabs` → the (small)
pinned zone → the active section. `ConsoleTabs`:
- `lg` and up: a sticky (`top-0`) horizontal tab bar across the content width; five tabs fit at
  1024 px with icon + name + badge.
- below `lg`: `fixed bottom-0` bar with `env(safe-area-inset-bottom)` padding, five equal cells
  (375 px ⇒ 75 px each), icon above a SHORT name, badge on the icon. The page gets bottom padding
  equal to the bar so no content hides under it.
Short names (new keys, he/en): קבוצות · מהשטח · שליטה · שיתוף · דוחות (Teams · Field · Control ·
Share · Reports). The long names stay as the section heading inside the pane.

### D2: a smaller pinned zone (data change in `runConsoleLayout.ts`)

| Panel | Today | New group | Pinned when |
|---|---|---|---|
| alerts | primary | primary | only while at least one alert is unacknowledged (rendered as a strip) |
| startTeams | primary | primary | only while some team is not started |
| joinShare | primary | shareAndScreens | never |
| broadcast | primary | gameMechanics | never |
| liveMap | primary | teamsAndScores | never |

Everything remains reachable (`buildRunConsoleSections` still covers the catalogue; the existing
completeness test enforces it). The "needs you now" signals row already deep-links to panels; its
jump targets must be updated for the moved panels (the jump opens the section, then scrolls).

### D3: badges on every size, plus "new since you looked"

The badge text comes from the existing `summaryChips`. "New since you looked": the console stores,
per section, the counts it last displayed while that section was active (component state + a
`sessionStorage` mirror, try/catch); a section whose relevant count grew shows a dot. Pure:
`sectionHasNew(prev, now)`.

### D4: shortcuts

`1`–`5` on desktop when focus is not in a text field. Announced in each tab's `title`.

## Acceptance measurements (the numbers that failed on 2026-09-25)

- 375×812: every tab fully visible, the tab bar's top edge within the viewport at scroll 0.
- 1400×860: the tab bar's top edge ≤ 200 px at scroll 0.
- Both: the pinned zone during play with no alerts and all teams started is ZERO panels.

## Test strategy

- Unit (`apps/creator-web/src/lib/__tests__/runConsole.test.ts`, vitest, existing): new grouping table,
  pinned conditions (alerts only when unacknowledged; startTeams only while unstarted), completeness
  still holds, signals' jump targets map to the moved panels. `sectionHasNew` table.
- Tap targets: `scripts/test-creator-tap-targets.ts` must stay green (tabs use `TAP_TARGET`).
- UI via preview, the acceptance measurements above re-run with the same script used to find the
  problem (`getBoundingClientRect` on the nav), plus a screenshot at each size. `i18n:check:strict`.

## Context (verified 2026-09-28)

- Launched return of `PlayScreen`: `Header` (with the ✕ `onLeave`, `t.play.leaveAria`),
  `MissionProgressRow`, `LiveOps`, `NavMap className="h-52"` when `locationRelevant`, `TaskRunner`,
  `LockedTasksList`, `MoreDrawer` (feed, chat, trackables, zones, devices; `planMoreDrawer` pure).
- Overlays already share one fixed column (`components/TopOverlays.tsx`, `.rp-top-stack`) and safe
  areas have `.rp-safe-t`.
- `NavMap` accepts `className` for its height and resizes with MapLibre `resize()` on mount.

## Decisions

### D1: layout

`<div class="h-[100dvh] flex flex-col overflow-hidden">` → header (compact: game name, score,
progress dots, ⋯) → body `relative flex-1 min-h-0`. With a map, the map is `absolute inset-0` in the
body and the sheet overlays it; without, the mission card is the body with `overflow-y-auto` on the
card's text region only. `body`/`html` get `overflow: hidden` while this screen is mounted (and only
then), so iOS rubber-banding cannot scroll the page.

### D2: sheet snap points are pure

`lib/sheetSnap.ts`: `snapHeights(viewportH)` → `{ peek: 132, half: 0.5·H, full: H − header − 12 }`;
`nextSnap(current, dragDeltaY, velocityY)` → nearest point in the drag direction, with a velocity
flick rule. Pointer events on the handle area; `touch-action: none` on the handle only; content
scroll only at `full`; `prefers-reduced-motion` ⇒ no spring. The sheet opens at `half` when a new
mission arrives and at `peek` when the player pans the map. The map's camera padding bottom tracks
the sheet height so `fitBounds` (from `located-mission-arrival`) frames above the sheet.

### D3: live-ops over the map

`LiveOps` renders into the top overlay column, collapsed to one line per item with tap-to-expand,
so it never changes the sheet's geometry.

### D4: the leave action

`Header` loses the ✕; a ⋯ button (`aria-label` "תפריט") opens a small menu: "יציאה מהמשחק בטלפון
הזה" (existing confirm) and the drawer tabs. The drawer stays as is; the menu is its door.

## Test strategy

- **Pure** `scripts/test-sheet-snap.ts`: snap heights for 640/740/844 px; drag + velocity rules;
  never outside [peek, full].
- **Source guard** extended in `scripts/test-top-overlay-stack.ts`: the launched return declares
  `h-[100dvh]` + `overflow-hidden`, and no bare `✕` leave button remains in `Header`.
- **UI** preview at 375×667, 390×844 and 360×640: `document.scrollingElement.scrollHeight ===
  innerHeight` on the launched screen with a long mission; sheet drag/tap; locationless game;
  ⋯ menu leave with the confirm. `npm run i18n:check:strict`, `npm run bundle:budget`.

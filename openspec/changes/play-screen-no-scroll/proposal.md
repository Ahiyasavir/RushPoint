## Why

Field report 2026-09-27 items 3 and 4.

- *"The player interface scrolls. I don't like it at all. Design it so there is no scrolling at
  all."* The active screen (`apps/play-web/src/screens/PlayScreen.tsx`, launched return) is a
  vertical stack: header, progress, live-ops banners, a 208 px map (`h-52`), the mission card
  (`TaskRunner`), the locked-missions list, and a "more" drawer. Secondary panels already moved into
  `MoreDrawer`; what still scrolls is the map + mission + locked list stacked one under another.
- *"The ✕ in the corner: not clear whether it leaves the mission, the game or the app."* It is
  "leave the game on this phone" (`t.play.leaveAria`, confirm "you can rejoin with the same code"),
  drawn as a bare ✕, which conventionally means "close this".

The standard answer for a map app with no page scrolling is the Google Maps / Uber bottom sheet:
a full-screen interactive map with a sheet at a peek, a middle and a full height (NN/g, Material;
see `docs/field-report-2026-09-27.md`).

This change supersedes `fix-play-screen-hierarchy` (reordering inside a scrolling page).

## What Changes

- The launched game screen is exactly one screen tall (`100dvh`, safe areas respected). **The page
  never scrolls.**
- With a map: the map fills the screen under a compact header; the mission lives in a **bottom
  sheet** with three heights: **peek** (mission name, distance or status, the main action),
  **half** (the mission card), **full** (the mission card plus the locked-missions list). Drag or
  tap the handle to change height. Only the full sheet's content may scroll inside itself, as in
  Google Maps, for a mission whose text is longer than the phone.
- Without a map (locationless game): the mission card fills the space under the header; long
  mission text scrolls inside the card only.
- Live-ops banners (announcements, flash missions, score notices) float over the top of the map
  instead of pushing content down.
- The ✕ is replaced by a **⋯ menu** in the header whose items are labelled: "יציאה מהמשחק בטלפון
  הזה" (same confirm as today), plus the drawer's existing entries.

## Capabilities

### New Capabilities
- `play-screen-layout`: a single-screen game layout with a map + bottom sheet and a labelled
  leave action.

## Non-goals

- Changing what any panel does, any callable, routing or scoring.
- The pre-launch, finished and staff screens.
- A new dependency for the sheet (hand-built on pointer events; the bundle budget stays green).

## Surfaces

play-web only: `PlayScreen.tsx`, a new `components/MissionSheet.tsx`, a pure
`lib/sheetSnap.ts` (snap decision), `Header`, i18n. `openspec/changes/fix-play-screen-hierarchy`
marked superseded.

# Tasks — map-recenter-thumb-reach

## 1. Move the recenter button to the bottom corner (UI lane)

- [x] 1.1 In `apps/play-web/src/components/NavMap.tsx`, on the recenter `<button>`
  className, change `top-14` → `bottom-14`. Keep every other utility unchanged,
  including the logical inline edge `start-2`.
- [x] 1.2 Update the adjacent positioning comment so it describes the button
  sitting in the **bottom** inline-start corner, clearing the `bottom-2`
  attribution and the `bottom-2` search-area legend (not "directly under
  MapModeToggle").

## 2. Verify (UI/visual lane)

- [ ] 2.1 Preview play-web: the recenter control renders in the bottom inline-start
  corner, is tappable, and does not overlap the map attribution or the search-area
  legend.
- [ ] 2.2 Confirm RTL: under the Hebrew default the button hugs the bottom-**right**
  (reading-start) corner and mirrors correctly.
- [ ] 2.3 Run `npm run i18n:check:strict` — must stay clean (no string change; a
  presentation-only class edit adds no PART B warning).

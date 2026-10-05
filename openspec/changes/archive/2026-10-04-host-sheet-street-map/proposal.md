## Why

The host sheet's map was a drawing: numbered dots on white, at true scale, with no streets
(plan part D item 5, a default chosen overnight). Ahiya, 2026-10-04: "הם לא יראו את המפה עצמה? זה
לא מקובל". A host on foot needs to see the streets the stations are on.

The reason for the drawing was real: a live map (MapLibre, WebGL) often prints blank. That is a
property of a live canvas, not of map tiles. Plain `<img>` tiles laid out at fixed positions print
like any other picture.

## What Changes

- The map section shows real street map tiles behind the numbered station markers, framed to fit
  every located station, north up, with the map's credit line.
- The layout (zoom, which tiles, where each marker sits) is a pure function, tested without a
  browser.
- Print waits for the tiles to finish loading (bounded), so a fast tap on "print" does not print a
  half-loaded map.
- If tiles cannot load, the numbered markers still show on a plain background: never worse than
  the drawing.

## Impact

- `apps/creator-web/src/lib/printMap.ts` (new, pure), `apps/creator-web/src/lib/hostSheet.ts`
  (`plot` → `map`), `apps/creator-web/src/pages/HostSheetPage.tsx`, i18n HE + EN,
  `scripts/test-print-map.ts` (new), `scripts/test-host-sheet.ts`.
- Tiles: MapTiler `streets-v2` raster when `VITE_MAPTILER_KEY` is set, keyless OpenTopoMap otherwise
  (the same fallback the live maps use). No server change.

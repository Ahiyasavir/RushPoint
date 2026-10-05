## Decisions

**D1. Static tiles, not a live map.** Web Mercator math picks the largest zoom at which the
stations' bounding box plus a margin fits the frame (at most 680 x 680 px, 256 px tiles), then
lists every tile the frame touches with its offset. Markers get the same pixel coordinates. All
positions are emitted as fractions of the frame, so the frame scales to a phone or to A4 without
recomputing anything.

**D2. One station.** A single point (or all points at one spot) uses zoom 16, centred.

**D3. Zoom bounds.** Zoom is clamped to 3..17 (OpenTopoMap's top level is 17).

**D4. Tile source.** `printTileUrl(z, x, y, key)`: MapTiler `streets-v2` 256 px PNG with a key,
OpenTopoMap a/b/c by `(x + y) % 3` without. Tile x wraps modulo 2^z. The credit line names
OpenStreetMap, plus MapTiler or OpenTopoMap.

**D5. Printing.** The print button waits for every map `<img>` to load or fail, at most 8 s, then
calls `window.print()`. Tiles are `loading="eager"` so the browser fetches them before the section
scrolls into view.

**D6. Failure.** The frame has a light background; a tile that fails is hidden, and the markers and
the numbered list stay.

## Test strategy

`scripts/test-print-map.ts` (RED first): every marker lies inside the frame; the frame never
exceeds the maximum; the chosen zoom is the largest that fits (one more level would not); tiles
cover the frame with no gap; one point gives zoom 16; junk gives no map; tile x wraps; the URL
switches on the key. `scripts/test-host-sheet.ts`: `map` replaces `plot`, null when the map is off
or nothing is located.

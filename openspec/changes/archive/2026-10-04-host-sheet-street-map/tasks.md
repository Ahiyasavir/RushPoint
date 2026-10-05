## 1. RED

- [x] 1.1 `scripts/test-print-map.ts`: framing, largest fitting zoom, tile coverage, single point, wrap, tile URL, junk. Run it, watch it fail.
- [x] 1.2 `scripts/test-host-sheet.ts`: the sheet carries `map` (markers per located card, null when off). Watch it fail.

## 2. GREEN

- [x] 2.1 `lib/printMap.ts`: `printMapLayout`, `printTileUrl`.
- [x] 2.2 `buildHostSheet` returns `map` instead of `plot`.
- [x] 2.3 `HostSheetPage`: tiles + markers + credit; print waits for tiles; i18n HE + EN.
- [x] 2.4 Plan doc part D item 5 records Ahiya's answer.

## 3. Verify

- [x] 3.1 Browser: the map shows streets at 375 px and in the A4 print preview.
- [ ] 3.2 Gates: `npm run verify` green.

# Design — mobile-dashboard-runconsole-reflow

## 1. Current code, audited

`DashboardPage.tsx:681` (real content, gated on `games.length > 0`):
```tsx
<div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-8">
  {[/* 3 stat tiles */].map((s) => (...))}
</div>
```
`DashboardPage.tsx:1037` (loading skeleton, rendered while games are still
loading):
```tsx
<div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-8">
  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[68px] rounded-2xl" />)}
</div>
```
Both must carry the exact same responsive classes — the skeleton is a
literal stand-in for the real grid while data loads, and a mismatch would
make the page visibly reflow the instant loading finishes.

Three lines below the real grid, the games list already does this
correctly: `DashboardPage.tsx:726` /
`:1041`: `grid sm:grid-cols-2 lg:grid-cols-3` (implicitly 1 column below
`sm`) — the stat-tile grid is the odd one out on this same page.

`RunConsolePage.tsx:1746-1753`:
```tsx
<div className="space-y-2">
  <Label>{t.runConsole.hotZoneCenter}</Label>
  <LocationStep coordinates={{ lat, lng }} onChange={...} mapClassName="h-52" />
  <div className="grid grid-cols-3 gap-2">
    <div><Label>{t.runConsole.hotZoneRadius}</Label><Input type="number" .../></div>
    <div><Label>{t.runConsole.hotZoneMultiplier}</Label><Input type="number" .../></div>
    <div><Label>{t.runConsole.hotZoneDuration}</Label><Input type="number" .../></div>
  </div>
  <Button ...>{t.runConsole.activate}</Button>
</div>
```
No `sm:`/responsive variant on the `grid-cols-3` — unlike the console's
stage rail (`:1317`, `flex lg:flex-col ... overflow-x-auto lg:overflow-visible`),
which deliberately reflows.

## 2. The fix

Dashboard (both `:681` and `:1037`, identically):
```tsx
className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-8"
```

Hot Zone (`:1749`):
```tsx
className="grid grid-cols-1 sm:grid-cols-3 gap-2"
```
(No intermediate 2-column step needed here — three related fields belong
together as one group; either all in a row (room permits) or all stacked
(room doesn't), unlike the stat tiles which read fine as a 2×2-ish grid at
an intermediate width.)

## 3. Test strategy

No pure logic changes — className grid-column tokens only. Per CLAUDE.md's
UI lane:
- Preview check at 375px: Dashboard stat tiles render single-column (both
  the loaded and, if reachable, the loading-skeleton state look identical
  in layout); Hot Zone form's three number inputs stack vertically with
  each `<Label>` staying attached to its own input.
- Preview check at `sm`–`lg` widths: stat tiles show 2 columns, Hot Zone
  inputs show 3 columns in a row — matches today's behavior at those
  widths.
- Preview check at desktop (`lg`+): both grids unchanged from today
  (3-column stat tiles, 3-column Hot Zone).
- `npm run i18n:check:strict` — no new strings, should no-op.

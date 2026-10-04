## Why

The Run Console's flash mission panel lists every recent flash mission with its claims and a
"לתת N נקודות ל: בחרו קבוצה" picker listing every team, including flashes that ended long ago
and already have a winner. Each flash sent makes the panel longer, and during a live event the
open flash and the one waiting for approval sit among settled ones. Found in the overnight
pass of 2026-10-03 (`docs/OVERNIGHT-2026-10-03.md`, proposal 3), approved by Ahiya 2026-10-04.

## What Changes

- The panel splits flashes into **current** and **past**, decided by one pure function:
  current = still open, or a submission is waiting for approval, or it ended in the last 15
  minutes with nobody rewarded (so an organizer can still award an "announcement only" flash
  after it ends). Everything else is past.
- Current flashes render as today: claims, approve / reject, and the award picker.
- Past flashes fold into one closed line ("N משימות בזק קודמות"); opened, each is one line with
  its title and who won (or that nobody did). No picker and no actions.

## Capabilities

### New Capabilities
- `flash-console-history`: which flash missions the console shows in full and which it folds.

## Impact

- New pure module `apps/creator-web/src/lib/flashConsoleList.ts`; `RunConsolePage.tsx`
  (`FlashMissionCard`); i18n HE + EN. Test: `scripts/test-flash-console-list.ts`.
- No server or data change.

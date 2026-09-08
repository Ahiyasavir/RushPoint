## Why

The Builder's map picker decides its opening view from **one task's own coordinates and nothing
else**. A mission that already has a pin opens on it; a mission that has none — i.e. every mission
a creator adds — opens at zoom 8 over central Israel, because the picker has no idea which game it
belongs to or where that game happens. So a creator who has already pinned the first mission on a
street in Ramot must pan and zoom back down to that same street by hand for the second mission, and
the third, and every one after it. The work of finding the neighbourhood is repeated once per
mission even though the game answered the question the first time.

## What Changes

- When the mission being edited has **no** coordinates and the game it belongs to has at least one
  mission that **does**, the map opens on those existing pins instead of the country default:
  fitted to their bounds, and clamped so a single pin — or a cluster of pins closer together than
  that — yields roughly a 100 m-radius neighbourhood view rather than a rooftop-level zoom.
- A game with nothing pinned anywhere still opens on the existing central-Israel default. This is
  the only case that keeps it.
- A mission that already has coordinates is untouched: it still opens centred on its own pin, and
  the "reflect external numeric edits" behaviour is unchanged.
- The Run Console's two operational pickers (hot zone centre, discovery POI) get the same anchor
  from the run's game, for the same reason — a host placing a hot zone is standing in the same
  neighbourhood the missions are in.
- **Non-goals**: no change to how a location is CHOSEN (click, drag, search, typed pair), no change
  to what is stored on the task, no new stored "game centre" field, no change to the participant
  map, the gallery map or the route preview, and no callable added or altered.

## Capabilities

### New Capabilities
- `location-picker-anchor`: what initial view the Builder/Run-Console map picker opens on, derived
  from the coordinates the surrounding game already holds.

### Modified Capabilities
<!-- None. `locationpicker-a11y` governs the picker's keyboard/labelling behaviour, which this
     change does not touch; no existing spec states what the picker's initial view is. -->

## Impact

- **Surfaces touched**: `apps/creator-web` only (plus one new pure helper). No shared types, no
  callable, no `functions/`, no `firestore.rules`, no `play-web`.
- **Code**: a new pure `apps/creator-web/src/lib/mapAnchor.ts` (the initial-view verdict);
  `components/LocationPicker.tsx` (accept and honour the anchor);
  `components/LocationStep.tsx` (pass it through); `components/TaskWizard.tsx` and
  `pages/BuilderPage.tsx` (supply the game's pinned coordinates); `pages/RunConsolePage.tsx`
  (supply the run's game coordinates).
- **Tests**: a new `scripts/test-map-anchor.ts` in the pure-logic lane. No emulator lane change —
  nothing server-side moves.
- **i18n**: no new user-facing strings, so PART B gains nothing; `i18n:check:strict` still runs.

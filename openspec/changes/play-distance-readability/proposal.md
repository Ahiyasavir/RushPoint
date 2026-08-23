# Make the live distance numbers readable outdoors

## Why

A walking participant glances at ONE thing more than anything else on the play
screen: the live distance to the next task ("how much closer do I need to walk?").
Today that number is styled like throwaway metadata — small and low-contrast
(`text-zinc-500`, the reversed-scale metadata gray `#78716c`) — so it is hard to
read at arm's length in direct sun, exactly the condition it exists for. It also
uses proportional digits, so the value visibly jitters and reflows as it updates
every few seconds.

Two spots in `apps/play-web/src/components/TaskRunner.tsx` carry this live number:
the `DistanceBadge` and the geofence "walk closer" line.

## What Changes

Presentation-only class updates on those two elements:

- **Larger** type so the number reads at arm's length.
- **Higher contrast** ink (the near-black `text-zinc-100`, `#1c1917` on the
  reversed light theme — AA-strong) instead of the metadata gray `text-zinc-500`.
- **`tabular-nums`** so the digits keep a fixed width and don't jitter/reflow as
  the distance updates.

## What does NOT change

- The distance value, its computation, rounding, units, and update cadence — untouched.
- No behavior change (no geolocation, routing, or submit-path change).
- No i18n change — the copy strings (`metersAway`, `kmAway`, `walkCloser`,
  `findingLocation`) and their `t.*` calls are untouched; only Tailwind classes change.

## Impact

- Affected code: `apps/play-web/src/components/TaskRunner.tsx` (two lines).
- Affected specs: `play-task-distance` (new capability delta — the live-distance
  presentation contract).

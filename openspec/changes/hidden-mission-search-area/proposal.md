## Why

A player whose active mission is a hidden-location ("treasure hunt") target looks at the game map
and sees **nothing about that mission at all**. Not a coarse circle, not a hint of direction —
nothing. The product owner's words: *"I still don't see the hidden missions on the map."*

That is exactly what today's code does, deliberately, in three places that agree with each other:

- `functions/src/runs/sanitizeTask.ts:40` builds a **sealed stub** for a not-yet-arrived hidden task
  by CONSTRUCTION — id, `locationHidden`, `arrivalPending`, the clue, the paid-hint affordance and
  non-revealing chrome. Nothing locational, coarse or exact.
- `apps/play-web/src/screens/PlayScreen.tsx:445` drops any `arrivalPending` task from the map
  targets, because there is no coordinate in the payload to drop it at.
- `apps/play-web/src/i18n.ts` (`task.hiddenHelp`) tells the player, as a feature, that there is
  no pin.

The result is a hunt where the map is dead weight: the player's own GPS dot floats over a blank
neighbourhood with no indication of where to even begin walking. A treasure hunt is meant to be a
**search**, and a search needs a search area. "Somewhere in this city" is not a game, it is a dead
end — the same defect class the platform already fixed one level up for the creator's library map
(`hidden-location-map-visibility`), now visible on the player's map.

## What Changes

**A sealed hidden mission gains a coarse SEARCH AREA on the participant map.**

- The participant payload for a still-sealed hidden task carries a new `searchArea`
  `{ lat, lng, radiusMeters }`: a deterministic grid-snapped circle that is GUARANTEED to contain
  the real spot and that reveals only the ~440 m cell the spot sits in. It is derived server-side by
  a new pure function and is the ONLY locational value a sealed hidden task has ever shipped.
- The play map draws it as a distinct dashed circle (not a pin), so "there is something in here,
  go look" is legible without claiming a spot. The map now stays alive for a sealed mission because
  the circle is a real overlay, not because a flag props it up.
- The sealed task card's help copy stops saying the map shows nothing and starts saying it shows a
  search area.

## What explicitly does NOT change

Each of these is held by a test, not by assertion:

- **The exact authored coordinate still never reaches a sealed participant payload.** No
  `coordinates`, no `geofenceRadiusMeters`, no `smart.stationCoords`, no `smart` object at all. The
  sealed stub is still built by construction from an allowlist, so a `Task` field added tomorrow
  still defaults to WITHHELD.
- **The seal itself.** `reportArrival` is still the only thing that unseals a hidden task, and it is
  still the server's GPS verdict that decides. A player standing inside the search circle is not
  "arrived".
- **The distance is still never leaked.** `evaluateTrigger`'s hidden branch still returns a generic
  clue-driven refusal with no metres figure, so the circle cannot be sharpened by polling.
- **The public/creator projection.** `publicTaskLocation` (the ~1 km world-readable cell) is a
  different code path for a different audience and is untouched. The two coarsenings are deliberately
  different sizes and neither is derived from the other.
- **Non-hidden tasks, locationless tasks and unplaced tasks.** Byte-identical payloads and
  byte-identical maps.
- **No new callable, no rules change, no index, no env var.**

## Surfaces touched

- `packages/shared` — **NEW** `src/hiddenSearchArea.ts` + a barrel export. **The shared package must
  be rebuilt** before `functions/` typechecks.
- `functions/` — `runs/sanitizeTask.ts` (the sealed stub gains one conditional field) and its
  co-located vitest. No callable added or changed.
- `apps/play-web` — **NEW** `src/lib/searchAreas.ts` (pure selector), `components/NavMap.tsx`
  (a new overlay), `screens/PlayScreen.tsx` (wiring), `services/calls.ts` (the `SafeTask` shape),
  `i18n.ts` (HE + EN).
- `scripts/` — **NEW** `test-hidden-search-area.ts`; `e2e-verify.mjs`'s participant-payload
  allowlist gains `searchArea` (a new sanitizer field fails that guard loud by design).
- **Not touched:** `firestore.rules`, `apps/creator-web`, `packages/shared/src/publicTaskLocation.ts`.

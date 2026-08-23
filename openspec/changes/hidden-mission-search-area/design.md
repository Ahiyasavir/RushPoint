## 1. What a search area is allowed to be

The whole change is one new sentence in the privacy contract, so the sentence has to be exact.

**The construction.** `hiddenSearchArea(task)` floors the task's real coordinate onto a global grid
of `HIDDEN_SEARCH_CELL_DEG = 0.004°` cells and returns that cell's CENTRE plus a CONSTANT radius
`HIDDEN_SEARCH_RADIUS_M = 320`. 0.004° of latitude is ≈ 445 m, so the half-cell is ≈ 222.6 m on each
axis and the worst-case distance from the cell centre to any point inside it is the half-diagonal,
`222.6 × √2 ≈ 314.8 m`. 320 m therefore **contains the real spot for every input, at every
latitude** (longitude cells only shrink away from the equator, which shrinks the diagonal further).
Containment is not an aspiration here; it is arithmetic, and §5 pins it with a randomized property.

**Why a grid snap and not jitter.** Identical to the argument already written into
`publicTaskLocation.ts`: random jitter is a fresh sample around the truth on every call, so N
observations average down to the exact point, and a participant polls `getMyTeamState` every few
seconds. A grid snap is a PURE FUNCTION of its input, so the thousandth read carries exactly as much
information as the first. The determinism is the security property.

**Why the grid is anchored at (0, 0).** A per-task anchor (e.g. "centre the circle on the task and
round the radius") leaks the true point through the geometry itself: the centre *is* the answer. An
absolute grid means the circle's centre is a property of the CELL, not of the task, and the task can
sit anywhere inside it.

**Why the radius is a constant and not computed per latitude.** A latitude-dependent radius would be
a second, finer channel of the same coordinate — `radiusMeters` would quietly encode `cos(lat)`.
A constant leaks nothing and is over-wide by at most 5 m at the equator.

**What it discloses.** The ≈ 445 m cell containing the spot, and nothing finer. Roughly a
neighbourhood block. That is a search, which is the point: a hunt with a 445 m starting box still has
to be walked and still has to be solved from the clue, and the server still refuses arrival until the
GPS verdict says so.

**What it does NOT disclose.** Distance (`evaluateTrigger`'s hidden branch is unchanged and still
returns a generic refusal), bearing, the geofence radius, the station coordinates, the title, the
type, or any answer key.

**Residual risk, stated.** A hidden task at the edge of its cell is bounded to a 445 m box a player
could sweep on foot in a few minutes. Accepted: that is the product owner's explicit ask, and it is
still a physical search under a server-verified arrival gate. Anyone who wants a *harder* hunt gets
it from the clue and the geofence, which are unchanged.

## 2. Why the number is 0.004° / 320 m and not the public one

`PUBLIC_LOCATION_CELL_DEG = 0.01` (≈1.11 km) exists for a world-readable document read by strangers
who are not in the game. A 1.11 km circle on a phone held by a player standing inside it is
indistinguishable from no circle at all — it fills the viewport and says nothing.

These are two audiences, two threat models and two code paths, so they get two constants in two
modules. Deriving one from the other would couple a participant UX decision to a public-privacy
decision and guarantee that a future tuning of either silently moves the other. `hiddenSearchArea.ts`
therefore does **not** import from `publicTaskLocation.ts`, and its header says so.

## 3. Where the derivation lives, and where it must not

Server-side, in `sanitizeTaskForParticipant`'s sealed-stub branch, because that function is the
security boundary: the exact coordinate exists on one side of it and must not exist on the other.
Deriving the circle in `play-web` would require shipping the exact coordinate to the device to
coarsen it there, which is the entire bug the seal exists to prevent.

The function itself lives in `packages/shared/src/hiddenSearchArea.ts` rather than in `functions/`
because play-web needs the TYPE (`SearchArea`) to render it, and a duplicated interface is how two
sides of a wire drift. **Consequence: `packages/shared` must be rebuilt before `functions/`
typechecks.** Reported loudly.

The sealed stub gains exactly one conditional key:

```ts
...(area ? { searchArea: area } : {}),
```

built by construction like every other key in that object, so the allowlist discipline is intact.

**Coordinate source.** `smart?.stationCoords ?? coordinates`, mirroring what `PlayScreen` already
uses to place a normal pin, so a hidden smart-station's circle sits over the station and not over a
stale template coordinate. Each candidate is independently usability-checked, so a garbage
`stationCoords` falls through to `coordinates` instead of poisoning the result.

**Unplaced / locationless.** `undefined` ⇒ the key is omitted ⇒ the map is byte-identical to today.
`checkHiddenLocationTask` already refuses to save a hidden task without coordinates, so this is
defence in depth for legacy and hand-crafted data, not a live path.

## 4. The client half

**`apps/play-web/src/lib/searchAreas.ts` (new, pure).** `selectSearchAreas(tasks)` turns the
`activeStageTasks` array into the circles the map should draw. It is **total and never throws** —
it runs on a callable response on the participant hot path, and a selector that throws blacks out
the whole game screen:

- a nullish array, nullish entries and non-object entries yield `[]`;
- only entries whose `arrivalPending` is `true` contribute (a REVEALED hidden task has its real
  coordinates back and gets a real pin — drawing a circle too would be a second, contradictory
  answer on the same map);
- `lat`/`lng` must pass `isValidCoord` and must not be null island `(0, 0)` — the same "unplaced"
  rejection the rest of the codebase makes by name;
- `radiusMeters` must be finite and `> 0`, and is clamped into
  `[SEARCH_AREA_MIN_RADIUS_M, SEARCH_AREA_MAX_RADIUS_M]` = `[25, 5000]`. A malformed radius yields
  NO circle rather than a continent-sized one: an over-wide circle is a worse lie than no circle;
- ids are de-duplicated (first wins) and input order is preserved, so the map's marker diff is
  stable across polls.

**`NavMap.tsx`.** A new `searchAreas` prop drawn as a GeoJSON fill + **dashed** line in violet
(`#8B5CF6`), deliberately not the accent colour a real target pin uses — a dashed circle reads as
"area", a solid pin reads as "spot", and the player must never confuse the two. Re-applied inside the
same `styledata` handler the hot zone and capture zones use, because a tile-style switch wipes
GeoJSON layers. The circle centres join `overlayPts`, which is what keeps the map ALIVE and frames
the initial fit — the existing `keepMapWithMe` escape hatch stays for the case where a sealed mission
has no derivable area at all.

**`PlayScreen.tsx`.** One `selectSearchAreas(state.activeStageTasks)` call and one prop. The
`arrivalPending` targets filter is unchanged: a sealed mission still gets no pin.

## 5. Test strategy

All lanes are pure / no-emulator.

**5.1 `scripts/test-hidden-search-area.ts` (tsx, auto-discovered by the aggregator)** — both pure
modules in one suite, because the guarantee spans them:

*The derivation (`packages/shared/src/hiddenSearchArea.ts`):*
- a placed hidden task yields an area whose centre is NOT the authored point;
- the centre is on the grid (a multiple of the cell, offset by a half-cell);
- **containment property**: over a seeded sweep of ≈2000 coordinates spanning latitudes -80…80 and
  longitudes -179…179, `haversineKm(area, authored) * 1000 <= area.radiusMeters` — always;
- **determinism**: 50 repeated calls on the same task return identical values (the anti-averaging
  property);
- **non-inversion**: two distinct points inside the same cell produce the IDENTICAL area, so the
  area cannot be inverted to a point;
- `radiusMeters` is the constant, for every latitude;
- locationless ⇒ `undefined`; absent / `NaN` / `Infinity` / string / out-of-range / null-island
  coordinates ⇒ `undefined`; a nullish task ⇒ `undefined` (never a throw);
- `smart.stationCoords` wins over `coordinates`, and a garbage `stationCoords` falls back to
  `coordinates`;
- a NON-hidden task also derives an area if asked (the function is about coordinates, not policy) —
  the POLICY that only sealed hidden tasks ship one is asserted on the sanitizer, below.

*The selector (`apps/play-web/src/lib/searchAreas.ts`):*
- null / undefined / non-array / entries of `null`, `0`, `'x'` ⇒ `[]`, no throw;
- a sealed task with a valid area ⇒ one circle; a REVEALED (`arrivalPending` absent/false) task with
  an area ⇒ none;
- invalid lat/lng, null island, `NaN` radius, `0` radius, negative radius ⇒ dropped;
- an absurd radius is clamped to the max, a tiny one to the min;
- duplicate ids collapse to one, input order preserved.

**5.2 `functions/src/runs/sanitizeTask.test.ts` (vitest)** — the boundary. The existing
`hidden-location-map-visibility` boundary describe block asserted "nothing locational at all" in the
sealed payload; that sentence is now false BY DESIGN, so it is rewritten rather than deleted, to
assert the new, stronger and more specific contract:
- a sealed hidden task's payload HAS `searchArea` (RED: currently absent);
- and STILL has no `coordinates`, no `geofenceRadiusMeters`, no `smart` at all, no `title`, no
  `type`, no `answers`/`hint`/`numericAnswer`;
- and the `searchArea` centre is NOT the authored coordinate, on either axis;
- and `haversine(searchArea, authored) <= radiusMeters` — the same containment guarantee, restated
  at the boundary so a future re-plumbing that forwards the WRONG point fails here;
- and the sealed payload still contains no value equal to the PUBLIC `publicTaskLocation` cell
  (the two projections stay independent);
- a REVEALED hidden task's payload has the real `coordinates` and NO `searchArea` (no second,
  contradictory answer);
- a NON-hidden task's payload is unchanged and has no `searchArea`;
- a hidden task with no usable coordinates seals with NO `searchArea` key.

**5.3 `scripts/test-play-a11y-scan.ts`** — already runs over every play-web `.tsx`; the new NavMap
markup must add zero findings (no physical-direction classes, no unlabelled icon button).

**5.4 `scripts/e2e-verify.mjs`** — `ALLOWED_TASK_KEYS` gains `searchArea` with the reason inline.
Not run here (emulator-bound); the change is required for the existing hidden-location scenario to
stay green, and is exactly the "a new sanitizer field fails loud" workflow CLAUDE.md prescribes.

**5.5 i18n** — `npm run i18n:check:strict` must stay clean; the one new/one changed key is added to
both dictionaries.

## 6. Copy (HE + EN, no dash separators)

`task.sealedHelp` (under the sealed mission card) — replaces wording that implied no map presence:
- HE: `המפה מסמנת אזור חיפוש בלבד, לא את הנקודה. המשימה עצמה תיפתח כשתגיעו למקום.`
- EN: `The map marks a search area, not the spot. The task itself opens once you reach it.`

`play.searchAreaLegend` (a small chip over the map, shown only while a circle is drawn):
- HE: `אזור חיפוש`
- EN: `Search area`

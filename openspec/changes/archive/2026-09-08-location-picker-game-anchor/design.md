## Context

`apps/creator-web/src/components/LocationPicker.tsx` builds its MapLibre map with

```ts
center: hasCoord ? [lng, lat] : DEFAULT_CENTER,   // DEFAULT_CENTER = [35.21, 31.77]
zoom:   hasCoord ? 14 : 8,
```

`hasCoord` is `isValidCoord(lat, lng) && (lat !== 0 || lng !== 0)` — a property of the ONE task
being edited. The component has no other input: `LocationStep` passes only `coordinates`,
`onChange` and layout props, and `TaskWizard`/`RunConsolePage` pass only that. So an unplaced
mission can only open on the platform default, which is central Israel at zoom 8, and the creator
re-finds the neighbourhood by hand once per mission.

Neighbouring components already answer the "where should this map open" question, each with its own
inline copy of the same three-branch logic — `GalleryMap.tsx:116`, `HeatmapMap.tsx:76`,
`LiveTeamMap.tsx:138`, `RoutePreviewMap.tsx:106` all read "one point ⇒ easeTo at a fixed zoom,
several ⇒ fitBounds with a maxZoom, none ⇒ a hardcoded country view". This change does not unify
those (they are post-load animations on maps whose data arrives asynchronously); it extracts the
*decision* for the picker, which is a construction-time, one-shot verdict, into a pure module.

`TaskWizard` already receives `siblings` — but that is the tasks of the SAME stage, supplied for the
prerequisite multi-select. A creator's second mission is frequently in a different stage from the
first, so the anchor must be game-wide and cannot reuse that prop.

## Goals / Non-Goals

**Goals:**
- An unplaced mission's picker opens on the neighbourhood the game is already in, at a scale where a
  street is choosable, without a pan-and-zoom hunt.
- All of the game's placed missions remain inside the opening view — a route spread over a kilometre
  is not cropped to the first pin.
- The "~100 m" claim in the proposal is a measurable property of the code, not a magic zoom constant
  chosen by eye.
- Absent or malformed coordinates degrade to today's behaviour rather than to a wrong place.

**Non-Goals:**
- No unification of the four other maps' fit logic.
- No stored "game centre"/"game bounds" field, and no change to what a task persists.
- No constraint on where a pin may be dropped — this is an opening view only.
- No change to the picker's search, click, drag or typed-pair paths, or to its a11y behaviour
  (`openspec/specs/locationpicker-a11y`).
- No callable, no shared type, no Firestore index, no rules change, no new env var.

## Decisions

### D1 — One pure module owns the verdict: `apps/creator-web/src/lib/mapAnchor.ts`

`resolveInitialView({ self, anchors, viewportPx })` returns a discriminated union:

```ts
type InitialView =
  | { kind: 'point';  center: [number, number]; zoom: number }
  | { kind: 'bounds'; bounds: [[number, number], [number, number]]; maxZoom: number; padding: number };
```

Branches, in order: the edited task's own valid coordinates ⇒ `point` at today's zoom 14 (identical
to today's behaviour, so a placed mission cannot regress); else the valid anchors' bounds ⇒ `bounds`
with `maxZoom` = the neighbourhood zoom (a single anchor, or a tight cluster, therefore lands exactly
at the ~100 m scale instead of at rooftop level); else `point` at `DEFAULT_CENTER`/zoom 8 — the
existing default, expressed as a branch rather than as an absence.

*Alternative rejected:* leaving the decision inline in `LocationPicker` as a fourth conditional. The
neighbourhood-zoom arithmetic below has to be asserted rather than eyeballed, and creator-web has no
component test runner — a pure module is the only shape this project can actually test (same
reasoning as `lib/recenter.ts`, `lib/searchAreas.ts`).

*Alternative rejected:* centre on the mean of the anchors at a fixed zoom. Cheaper, but it crops a
spread-out game: the second mission of a route whose first two pins are 800 m apart would open
showing neither of them at the edges. `fitBounds` with a `maxZoom` gets both behaviours from one
expression.

### D2 — The neighbourhood zoom is DERIVED, not a constant

Web-Mercator resolution is `156543.03392 * cos(lat) / 2^z` metres per pixel, so the zoom that puts a
`radiusMeters` circle across a `viewportPx`-wide viewport is

```
z = log2(156543.03392 * cos(lat) * viewportPx / (2 * radiusMeters))
```

with `radiusMeters = 100` and `viewportPx` the map container's SHORTER side (measured from the
container at construction; `LocationStep` renders the map at `h-44`/`h-52` ≈ 176–208 px, and taller
in `fill` mode). At Jerusalem's latitude and 200 px that is ≈ 17.0. Clamped to `[8, 18]` so a
degenerate measurement (a container reporting 0 px, a hidden panel) cannot produce a nonsense zoom.

Writing `zoom: 17` instead would be shorter, but "100 metres" would then be a claim no test could
check, and false at any container size or latitude other than the one it was tuned on. Deriving it
lets `scripts/test-map-anchor.ts` assert the property directly: the opening view spans at least
200 m and no more than ~3× that.

### D3 — Anchors reach the picker as a prop, computed by the surface that owns the game

`LocationPicker` stays ignorant of games, stages and runs; it takes `anchors?: {lat, lng}[]`.

- `BuilderPage` computes the game-wide list (`useMemo` over `game.stages.flatMap(s => s.tasks)`,
  keeping only placed coordinates) and passes it through `ContextPanel` → `TaskWizard` →
  `LocationStepBody` → `LocationStep` → `LocationPicker`. Those are existing prop drills that
  `gameId`/`siblings` already take; a React context for one optional array is not worth it.
- `RunConsolePage` collects the same list inside the `getGame` effect that already walks every stage
  and task to build `taskTitles` (line ~490) — **no extra Firestore read** — and passes it to the
  hot-zone and zone-create pickers, which live in the same component scope as that state.

The edited task is not filtered out of the list: when it is placed the `point` branch wins before the
anchors are consulted, and when it is unplaced it contributes nothing.

### D4 — The anchor is applied ONCE, at map construction

The verdict is consumed inside the existing mount-only `useEffect(..., [])`, via MapLibre's `bounds`
+ `fitBoundsOptions` map options — not by a post-load `fitBounds`, which would show the default view
for a frame and then jump. The `[lat, lng]` effect that reflects external numeric edits is untouched,
and still early-returns while `hasCoord` is false.

Deliberately NOT reactive to `anchors`: the array changes whenever any mission in the game is placed
(the Builder autosaves ~1.5 s after every edit), and a camera that re-fits itself while the creator
is aiming at a rooftop would be worse than the bug being fixed. Same posture as `lib/recenter.ts` —
a starting verdict, not a standing constraint.

### D5 — Total and non-throwing, with the sentinel handled

`resolveInitialView` never throws and never invents a location. It reuses `isValidCoord` from
`@rushpoint/shared` plus the existing `(lat !== 0 || lng !== 0)` sentinel rule — the `{0,0}`
placeholder a new task carries is *inside* the valid lat/lng range, so a helper that only checked
`isValidCoord` would anchor every new game to the Gulf of Guinea. Non-finite values, missing objects,
a `null` in the array and an empty array all fall through to the default branch.

## Test Strategy

- **Pure lane (RED first):** new `scripts/test-map-anchor.ts`, auto-discovered by
  `scripts/run-unit-tests.mjs`. One assertion per spec scenario: self-placed ⇒ `point`/zoom 14
  regardless of anchors · one anchor ⇒ opening span ≥ 200 m and under ~3× that (the derived-zoom
  property, checked by converting the returned zoom back to metres-per-pixel) · two anchors ~1 km
  apart ⇒ `bounds` containing both, zoom below the clamp · two anchors metres apart ⇒ clamped at the
  neighbourhood zoom, not rooftop · `{0,0}` / `NaN` / out-of-range / missing / empty ⇒ `point` at
  `DEFAULT_CENTER` zoom 8 · mixed valid and invalid ⇒ computed from the valid ones alone · degenerate
  `viewportPx` (0, NaN) ⇒ clamped, never NaN · no input at all ⇒ the default, not a throw.
- **UI:** preview-based. Open the Builder on the seeded demo game, place mission 1, open mission 2's
  location step, confirm the map opens on mission 1's street rather than on the country; then open a
  brand-new game's first mission and confirm the central-Israel default is unchanged.
- **i18n:** no new user-facing strings; `npm run i18n:check:strict` must stay clean (it runs inside
  `npm run verify`).
- **Gates:** the full `npm run verify` (nine gates). No emulator lane change is needed — nothing
  server-side, no callable and no stored field moves.

## Risks / Trade-offs

- **A creator deliberately building across two cities gets a first view fitted to city A when adding
  a mission in city B** → the anchor is a starting view only (D4/spec): pan and search work exactly
  as before, and the search box sits directly above the map. Strictly better than today's country
  view, which is centred on neither city.
- **The container may report 0 px at construction (hidden panel, `fill` before layout)** → the
  derived zoom clamps to `[8, 18]` and falls back to a 200 px reference, so the worst case is
  today's-or-better framing, never a NaN passed to MapLibre.
- **Five-hop prop drill through `TaskWizard`** → the prop is optional at every hop, so a caller that
  does not supply it gets exactly today's behaviour. No call site can be broken by omission.
- **`fitBounds` padding on a very short map (`h-44` = 176 px)** → padding is part of the verdict and
  kept small (24 px) so it cannot invert the viewport on the shortest container MapLibre is given.

## Migration Plan

None. Client-only, no stored data, no deploy ordering: shipping the creator-web bundle is the whole
migration, and reverting the bundle is the whole rollback.

## Open Questions

None. The two questions raised with the user before this proposal — *fit-vs-fixed* and *which
anchor* — are settled by D1/D3: fit all placed missions, clamped at the ~100 m neighbourhood scale.

## 1. RED — the location contract as failing tests

- [x] 1.1 Create `packages/shared/src/publicTaskLocation.test.ts` covering `approximatePublicPoint`
      (within `cell/2` of the input on both axes including negative inputs; output lands on the
      grid; **50 identical calls return 50 identical values**; two inputs in one cell collapse to
      one output; range extremes stay valid coordinates).
- [x] 1.2 In the same file, cover `publicTaskLocation` — `hideLocation` + valid coords ⇒
      `undefined`; ordinary located task ⇒ a coarsened point that is **not equal** to the input;
      missing / `NaN` / out-of-range / `(0, 0)` ⇒ `undefined`.
- [x] 1.3 In the same file, cover `isPlottablePublicTask` — absent, invalid and `(0, 0)`
      `approxLocation` ⇒ false; a legacy `PublicTask` with exact `coordinates` and no
      `approxLocation` ⇒ **false**; valid `approxLocation` ⇒ true.
- [x] 1.4 Run **only** this test file. Confirm it fails because the module does not exist — not
      because of a typo or an unrelated red already in the tree.

## 2. GREEN — the shared module

- [x] 2.1 Create `packages/shared/src/publicTaskLocation.ts` exporting `PUBLIC_LOCATION_CELL_DEG`,
      `approximatePublicPoint`, `publicTaskLocation`, `isPlottablePublicTask`, with a header comment
      stating why the coarsening is a grid snap rather than random jitter (repeated publishes must
      not be averageable). Re-export from `packages/shared/src/index.ts`.
- [x] 2.2 Re-run the same test file. Confirm green. Do not run the full gate set.

## 3. Server — stop publishing exact coordinates

- [x] 3.1 `packages/shared/src/types/index.ts`: make `PublicTask.coordinates` optional and mark it
      deprecated with a comment naming this change; add `approxLocation?: GeoPoint`.
- [x] 3.2 `functions/src/games/index.ts` — `publishGame`: build the public task with
      `...(publicTaskLocation(task) ? { approxLocation: publicTaskLocation(task) } : {})` and remove
      the `coordinates: task.coordinates` line. Verify by reading that no other line in the publish
      loop reintroduces a coordinate.
- [x] 3.3 `functions/src/gallery/index.ts` — `searchTaskLibrary`: strip `coordinates` from each
      ranked result before returning, so legacy stored documents stop serving exact points.
- [x] 3.4 Author (do not run) the two `scripts/e2e-verify.mjs` assertions from design §Test strategy:
      a published hidden task has neither location field; no search result carries `coordinates`.
      Mark them clearly as UNVERIFIED in this change's completion notes.

## 4. Generalise the map component

- [x] 4.1 `apps/creator-web/src/components/GalleryMap.tsx`: change the props to
      `points: MapPoint[]`, `onSelect`, `emptyLabel`, optional `notice`, optional `markerColor`.
      Move all domain filtering out of the component. Keep the single-mount effect, the
      `setStyle`-on-mode-change effect, the marker rebuild and the fit-bounds framing as they are.
- [x] 4.2 Update the existing games caller in `GalleryPage.tsx` to build `MapPoint[]` from
      `approxLocation` + `isValidCoord`, preserving today's popup text exactly. Confirm the games
      map is unchanged in behaviour.

## 5. The mission library map

- [x] 5.1 `apps/creator-web/src/i18n.ts`: add the new `gallery.*` keys to **both** dictionaries —
      the approximate-pins notice, the empty-map label for tasks, and any marker subtitle text.
      Hebrew must be real Hebrew.
- [x] 5.2 `GalleryPage.tsx`: render the list/map toggle for both tabs; render the tasks map from
      `isPlottablePublicTask`-filtered results; give each task card an `id` and the focus ring the
      game cards have; reset `focusId` when the tab changes so focus cannot leak across tabs.
- [x] 5.3 `apps/creator-web/src/components/TaskLibrary.tsx`: `toTask` seeds `coordinates` from
      `pt.approxLocation`, leaving it unset when absent.
      **Deviation as built:** `Task.coordinates` is a REQUIRED field, so "unset" is expressed as
      the `{lat: 0, lng: 0}` placeholder `blankTask()` already uses for "not placed yet" — which
      the Builder's placement validation rejects, so the spec's observable outcome ("the task is
      unplaced and treated as needing placement") holds.

## 6. Verify (scoped — the tree is red for unrelated reasons)

- [x] 6.1 Run the new test file once. Green.
- [x] 6.2 Run `npm run i18n:check` once. PART A clean; no new PART B finding from the files this
      change touched.
- [x] 6.3 Record what is UNVERIFIED: the e2e assertions from 3.4 and the preview pass from design
      §Test strategy (no emulator, no dev server started in this change). The full gate set
      (`typecheck` · `lint` · `test` · `creator:build` · `play:build` · `e2e`) must be run and green
      before this change is archived.

## UNVERIFIED — must be run before archive

Ran and green: `packages/shared/src/publicTaskLocation.test.ts` (15/15) and `npm run i18n:check`
(PART A and PART B both clean). Nothing else was executed — other agents were live in this tree and
`packages/shared/dist` is rewritten in place by `shared:build`, so no gauntlet and no emulator was
started from this change.

Outstanding:
- **The e2e scenario added at `scripts/e2e-verify.mjs` — "public task library publishes an AREA, and
  nothing for hidden tasks" — has never been executed.** It is marked UNVERIFIED in the file itself.
- `npm run typecheck` / `lint` / `creator:build` / `play:build` — not run. `packages/shared` was not
  rebuilt, so consumers of the new `publicTaskLocation` export and the changed `PublicTask` type
  compile against a stale `dist` until someone runs `shared:build`.
- The preview pass (Tasks tab → map toggle → markers → marker click focuses the card → the
  approximate-pins notice is visible → switching tabs clears the focus ring) — not performed.

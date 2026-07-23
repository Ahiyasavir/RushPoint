## 1. RED — failing tests first

- [x] 1.1 `packages/shared/src/publicTaskLocation.test.ts`: flip the two `hideLocation` writer cases
      to expect the same coarsened area a non-hidden task gets, and add hidden + `locationless`,
      hidden + `NaN` / out-of-range / string / absent coordinates, hidden + null island, and hidden +
      determinism (design.md §5.1). Rename the `hidden()` coverage fixture to `unplaced()` and add a
      hidden-WITH-area fixture.
- [x] 1.2 `packages/shared/src/publicTaskBackfill.test.ts`: legacy doc + hidden source ⇒ an area;
      bare doc + hidden source ⇒ an area; bare doc + locationless / unplaced / unresolvable source ⇒
      `null`; unusable stored area ⇒ repaired; explicit re-feed idempotence (design.md §5.2).
- [x] 1.3 `functions/src/games/gameArea.test.ts`: an all-hidden game derives an area; a mixed game
      derives the mean of both tasks; `resolveGameArea`'s underivable case re-expressed with
      `locationless` (design.md §5.3).
- [x] 1.4 `functions/src/runs/sanitizeTask.test.ts`: one new boundary test holding both halves at
      once (design.md §5.4).
- [x] 1.5 `scripts/test-public-task-seed.ts`: add the publish path (`functions/src/games/index.ts`)
      as a checked source, anchored on the `const publicTask: PublicTask = {` literal (design.md §5.5).
- [x] 1.6 Run the vitest files and the tsx script; confirm each fails for the intended reason.
      Record the output VERBATIM.

## 2. GREEN — the writer's rule

- [x] 2.1 `packages/shared/src/publicTaskLocation.ts`: delete the `if (task.hideLocation) return
      undefined;` branch. Leave `locationless`, `usableCoord` and the grid untouched.
- [x] 2.2 Rewrite the module comment block and the `publicTaskLocation` docblock: state the new rule,
      and state WHY participant-facing secrecy is unaffected (the sanitizer is the boundary, and it is
      a different code path). Fix the closing sentence of the header block, which still claims a task
      whose location is the puzzle publishes nothing.
- [x] 2.3 Re-run the shared vitest files; confirm GREEN.

## 3. GREEN — the consumers

- [x] 3.1 `functions/src/games/gameArea.ts`: update the comment block (it asserts hidden tasks
      contribute nothing, and that an all-hidden game derives nothing). No logic change — the
      delegation to `publicTaskLocation` is the point.
- [x] 3.2 `packages/shared/src/publicTaskBackfill.ts`: add `mayNeedPublicTaskRepair(doc)` and widen
      `repairPublicTask` per design.md §4, keeping both new no-op branches so the sweep stays
      idempotent. Update the module comment.
- [x] 3.3 Export `mayNeedPublicTaskRepair` from `packages/shared/src/index.ts` if the module is not
      re-exported wholesale.
- [x] 3.4 `functions/src/maintenance/publicTaskBackfill.ts`: use `mayNeedPublicTaskRepair` as the
      cheap pre-check instead of `hasLegacyCoordinates`, and update the comment that explains the
      pre-check (it now also buys the area fill-in, at one cached game read per area-less doc).
- [x] 3.5 `functions/src/games/index.ts`: update the publish-path comment so it no longer says a
      `hideLocation` task gets NOTHING. No logic change.
- [x] 3.6 Re-run the functions vitest files and the tsx script; confirm GREEN.

## 4. GREEN — creator copy

- [x] 4.1 `apps/creator-web/src/i18n.ts`: replace `gallery.approxPinsNote` and
      `gallery.noLocatedTasksHelp` in BOTH dictionaries with the wording in design.md §6. Hebrew in
      the Hebrew map, English in the English map, no em-dashes, no component-level literals.
- [x] 4.2 Re-read the file immediately before editing (contended by other lanes) and keep the edit
      to those two keys in each dictionary.

## 5. REFACTOR / verify

- [x] 5.1 Re-read the read path: `isPlottablePublicTask` still reads ONLY `approxLocation`, and no
      `coordinates` fallback was introduced anywhere.
- [x] 5.2 Re-read `functions/src/runs/sanitizeTask.ts` and confirm it is byte-for-byte unchanged.
- [x] 5.3 Gates, verbatim: `npm run typecheck`, `npm run lint`, `npm test`,
      `npm run creator:build`, `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`.
- [x] 5.4 Do NOT run `e2e` / `verify:emulator` / `test:rules` / `simulate` / `shared:build`, and do
      not start or stop any emulator, Vite, tunnel or backup process. Report the two e2e assertions
      that now contradict the rule, and report that existing `publicTasks` documents need
      `npm run backfill:public-tasks` (or a re-publish) before the map fills in.

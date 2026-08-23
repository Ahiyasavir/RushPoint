## 1. The privacy rationale for the new boundary

The change moves one line of policy, so the argument for why the boundary is still sound has to be
explicit rather than implied.

**What a published area actually is.** `approximatePublicPoint` floors the coordinate onto a global
grid of `PUBLIC_LOCATION_CELL_DEG = 0.01°` cells (≈1.11 km of latitude, at most that much longitude)
and returns the cell centre. The grid is anchored at `(0, 0)`, never at the task, so the cell
boundaries themselves leak nothing. It is a pure function, so republishing writes the identical
value and N observations carry exactly as much information as one — no averaging attack.

**What the old rule was actually protecting.** The stated threat was "an unauthenticated reader
scouts the answer to a hidden-location puzzle". Against a ~1 km cell that threat does not survive
contact with the rest of what is already public: the game's own `publicGames` document carries an
`approxLocation` for the whole game (derived from its visible tasks, at the same resolution), its
title, its description and its promo page. A hidden mission inside a hunt that is publicly framed as
"the Old City" was never secret at neighbourhood resolution. The old rule bought no secrecy the
platform had not already spent, and charged the creator their own map for it.

**Where the real boundary is, and that it does not move.**
`functions/src/runs/sanitizeTask.ts:40` seals a `hideLocation` task for the participant until the
server has latched arrival (`reportArrival` → `RunTaskRecord.arrivedAt`), and builds the sealed stub
by CONSTRUCTION from an allowlist — so a Task field added tomorrow defaults to withheld. Post-seal it
still strips `coordinates`, `geofenceRadiusMeters` and `smart.stationCoords` for the unrevealed case.
That is the control that makes the puzzle a puzzle, and it is a *different code path* from the
publish projection. Nothing in this change touches it, and §5.4 pins it with a test that fails if it
ever does.

**Two distinct audiences, two distinct payloads.** The creator browsing the mission library is
shopping for missions to copy; the coarse area is the only thing that makes that browsing
geographic. The player in a run is solving a puzzle; they get a clue. Conflating the two is what
produced the defect.

**Residual risk, stated.** A hidden task alone in its cell is narrowed to that cell for a
world-readable reader. Same non-guarantee `publicTaskLocation` already documents for every other
task (no k-anonymity). Accepted, unchanged, and now applied uniformly.

## 2. The shape of the change

One predicate governs everything: `publicTaskLocation(task)`. Deleting the `hideLocation` branch
from it is the whole behavioural change; every consumer inherits it because none of them re-derives
the rule:

| Consumer | Path | Effect |
|---|---|---|
| publish path | `functions/src/games/index.ts:775` | hidden task's public doc gains `approxLocation` |
| game area | `functions/src/games/gameArea.ts:40` | hidden task now contributes to the game pin (§3) |
| backfill rule | `packages/shared/src/publicTaskBackfill.ts:74` | a repaired hidden doc now gets an area |
| seeders | `scripts/seed-*.mjs` | seeded hidden tasks gain an area, no code edit needed |
| reader | `isPlottablePublicTask` | unchanged — still reads only `approxLocation` |

That is the reason the fix is one line plus its consequences, and the reason the tests are where the
real work is.

## 3. DECISION: hidden-location tasks now contribute to the game-level area

**Yes, they should — and the code should be left to do it automatically.**

`deriveGameArea` averages the *already coarsened* per-task cell centres and snaps the mean back onto
the same grid. Three reasons it is correct here:

1. **It discloses strictly less than its inputs.** Every input is now itself a published
   `approxLocation` on a world-readable `publicTasks` document. A mean of published values, re-snapped
   to the same cell size, cannot narrow anything past one cell. Including hidden tasks adds no
   information that is not already readable one document over.
2. **The alternative is the same defect one level up.** A game built entirely of hidden-location
   missions — a treasure hunt, i.e. the exact game type this platform is for — currently derives
   *nothing*, so it is invisible on the gallery map too. Fixing the task map while leaving the game
   map blank for hunts would be an incoherent rule that neither the code nor a creator could explain.
3. **One predicate, not two.** `gameArea.ts` deliberately delegates eligibility rather than restating
   it, precisely so the two can never drift. Re-introducing a `hideLocation` filter *only* in
   `gameArea` would recreate the drift that comment exists to prevent.

An authored `approxLocation` on the game still wins verbatim (`resolveGameArea`), so a creator who
wants to state a different area keeps that control. `gameArea.ts`'s comment block is updated so it no
longer claims hidden tasks contribute nothing.

## 4. DECISION: the backfill must also repair *bare* documents

The existing sweep triggers on `hasLegacyCoordinates(doc)` — the presence of the deprecated exact
`coordinates` key. That is a complete rule for the exposure it was written for, and an **incomplete**
one for this change:

- A hidden task published *before* `task-library-map-view` → doc has legacy `coordinates` → already
  triggers → now repairs to an area for free.
- A hidden task published *after* it → doc has **no** `coordinates` and **no** `approxLocation` →
  never triggers → stays off the map forever, even after a full sweep.

So the trigger widens to: *legacy coordinates present* **OR** *no usable area present*. Expressed as
a new exported predicate `mayNeedPublicTaskRepair(doc)` = `hasLegacyCoordinates(doc) ||
!isPlottablePublicTask(doc)`, reusing the reader's own usability rule so a stored `NaN` or
null-island area is also considered "no usable area".

`repairPublicTask` then has to stay **idempotent**, which requires two new no-op branches:

- bare doc + source task yields no area (locationless / unplaced) ⇒ `null` (skip, nothing to do);
- bare doc + source task unresolvable (orphan) ⇒ `null` — there is no exact point to strip, so
  writing nothing is both fail-closed and churn-free.

After one sweep, every repaired doc carries a usable area ⇒ `mayNeedPublicTaskRepair` is false ⇒ the
second pass reports `repaired: 0`. Cost: the sweep now spends a (per-game cached) read on
area-less documents it previously skipped. Bounded by the number of area-less public tasks, which is
exactly the set the operator is running the sweep to fix.

## 5. Test strategy

All lanes are pure/no-emulator, per the constraint that a live playtest stack is serving from this
tree.

**5.1 `packages/shared/src/publicTaskLocation.test.ts` (vitest)** — the writer's rule.
- hidden + valid coordinates ⇒ the same coarsened area a non-hidden task would get (RED: currently
  `undefined`);
- hidden ⇒ never the authored point, and on the grid;
- hidden + `locationless` ⇒ `undefined`;
- hidden + `NaN` / out-of-range / string / absent coordinates ⇒ `undefined`;
- hidden + null island `(0, 0)` ⇒ `undefined`;
- hidden ⇒ deterministic across repeated calls (the anti-averaging property must hold for the newly
  published class too).
- `publicTaskMapCoverage` fixtures: the helper named `hidden()` meant "the writer emitted nothing";
  it is renamed `unplaced()` and a genuinely-hidden-with-area fixture is added to a `partial`/
  `all-plottable` case, so the classifier's cases keep meaning what their names say.

**5.2 `packages/shared/src/publicTaskBackfill.test.ts` (vitest)**
- legacy doc + hidden source ⇒ `{ approxLocation }`, not `{}` (RED);
- bare doc (no coordinates, no area) + hidden source ⇒ `{ approxLocation }` (RED: currently `null`);
- bare doc + locationless/unplaced source ⇒ `null` (idempotence);
- bare doc + unresolvable source ⇒ `null`;
- doc whose stored area is `NaN` / null island ⇒ repaired;
- conformant doc ⇒ `null`, and the repaired output re-fed ⇒ `null` (explicit idempotence case);
- the repair still never returns the exact authored point, for hidden tasks too.

**5.3 `functions/src/games/gameArea.test.ts` (vitest)**
- an all-hidden game now derives an area (RED: currently `undefined`);
- a mixed game derives the mean of *both* tasks (RED: currently the visible one alone);
- the derived area is still on the grid and still never an authored point;
- `resolveGameArea`'s "nothing derivable" case is re-expressed with `locationless`, which is still
  genuinely underivable.

**5.4 `functions/src/runs/sanitizeTask.test.ts` (vitest)** — the boundary, stated as one test that
holds both halves at once: for the same hidden task, `publicTaskLocation()` yields an area **and**
`sanitizeTaskForParticipant()` yields no `coordinates`, no `geofenceRadiusMeters`, and no coarse
area either. A future edit that "helpfully" forwards the published area to the player fails here.

**5.5 `scripts/test-public-task-seed.ts` (tsx assertion script)** — extended with the publish path
itself (`functions/src/games/index.ts`), anchored on the `const publicTask: PublicTask = {` literal:
it must contain no `coordinates:` key, must spread `approxLocation` conditionally, and must derive it
from `publicTaskLocation(task)` with no `hideLocation` guard of its own. This is the structural stand-in
for "a hidden task's published doc contains `approxLocation` and NOT `coordinates`" in a lane that
cannot touch the emulator.

**5.6 e2e (NOT run, NOT edited — reported instead).** `scripts/e2e-verify.mjs` asserts the OLD rule in
two scenarios; the exact assertions are named in the report so the e2e-owning lane can flip them.

## 6. UI copy (HE + EN, no em-dashes)

`gallery.approxPinsNote` — shown under the mission-library map:
- HE: `הסיכות מראות אזור משוער בלבד, לא מיקום מדויק. גם משימות עם מיקום מוסתר מופיעות כאזור, השחקנים עצמם לא רואים אותו.`
- EN: `Pins show an approximate area, not an exact spot. Missions with a hidden location appear as an area too, and players still do not see it.`

`gallery.noLocatedTasksHelp` — shown only when nothing in the result set is plottable:
- HE: `אזור מפורסם נוצר כשמפרסמים את המשחק. משימות שפורסמו לפני העדכון הזה לא יופיעו במפה עד שהמשחק שלהן יפורסם מחדש.`
- EN: `A published area is created when a game is published. Missions published before this update stay off the map until their game is published again.`

Both keep the "publish again" remedy, which is now the *only* reason a located mission is missing.

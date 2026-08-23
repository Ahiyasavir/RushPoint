# Change: hidden-mission-map — plot the completed-mission trail while the active mission is a sealed hidden target

## Why (proposal)
When a player's ACTIVE mission is a hidden-location (treasure-hunt) task that is still
SEALED (pre-arrival), the play map has no pin to draw and falls back to a placeholder
("המפה תופיע ברגע שלמשימה יהיה מיקום" / "the map appears once the task has a location").
A blank placeholder is a dead, disorienting screen at exactly the moment the player is
wandering to find a hidden spot.

The user wants the map to STILL render for a hidden mission, showing ONLY:
1. the player's own current GPS location, and
2. pins for the missions they have ALREADY COMPLETED (a trail of where they've been).

Explicitly NOT shown: the hidden active target's pin, or any uncompleted / other task.

## Why it is safe (leak-safety argument)
A completed mission is a place the player has physically been — the same principle by
which a hidden task's coordinates are released to the player only AFTER arrival ("you
can't un-find a spot you've stood on"). So completed-mission pins reveal nothing new.
The hidden ACTIVE target stays sealed (no coords/title on the wire) until `reportArrival`.

## Design

### Server — `getMyTeamState` (functions/src/runs/index.ts)
New response field `completedTaskPins: { id, coordinates:{lat,lng}, title }[]`.

Built by a new pure helper `buildCompletedPins(teamStages, gameTasks)` in
`functions/src/runs/completedPins.ts`:
- Iterates the team's OWN RunTaskRecords across ALL stages and emits a pin ONLY for
  records whose `status === 'completed'`.
- Joins to the game task's coords + title (smart `stationCoords` preferred over the
  top-level coordinate, mirroring the live NavMap target logic).
- Omits locationless / missing / (0,0) / out-of-range completed tasks (nothing to pin).
- Deduped by task id; tolerant of undefined inputs.

**By-construction leak-safety:** the helper reads from the completed-records list only —
there is NO code path that reads a non-completed record — so a hidden-not-arrived task,
an unassigned task, or the active sealed target is *structurally incapable* of appearing
in `completedTaskPins`. This is the wave-D lesson made mechanical: "withheld" = absent
from the wire, and the new channel cannot ship a non-completed task's location.

The existing sealed-stub omission for the active hidden task
(`sanitizeTaskForParticipant` early return) is UNCHANGED — it still ships no coords/title
until `reportArrival` latches `arrivedAt`.

### Client
- `apps/play-web/src/services/calls.ts` — `MyTeamState.completedTaskPins` field added.
- `apps/play-web/src/screens/PlayScreen.tsx` — when the ACTIVE mission is sealed
  (`state.activeStageTasks.some(c => c.arrivalPending)`), build NavTargets from
  `completedTaskPins` (active:false) and pass them + `keepMapWithMe` to NavMap. The
  hidden active target is still NOT plotted (the existing `arrivalPending` → null guard
  in the `targets` builder is untouched). For a NORMAL active task, `completedPins` is
  empty and the map is byte-identical to before (its own target pin).
- `apps/play-web/src/components/NavMap.tsx` — new opt-in `keepMapWithMe` prop: with no
  target pin and no overlay, a valid `me` alone keeps the map alive (GPS dot) instead of
  the placeholder. Off by default, so every other caller (e.g. a locationless-only stage)
  keeps its placeholder-when-empty behavior unchanged.

### Graceful degradation
- GPS present, completed pins present → map with trail + me dot.
- GPS present, no completed pins → map centered on the me dot (keepMapWithMe).
- No GPS, completed pins present → map framed on the completed pins.
- No GPS, no completed pins → the existing placeholder (no crash, no spin).

### i18n
No new UI strings (the pin popup uses the task's own authored title, `dir="auto"`).
`npm run i18n:check` PART A + PART B both clean.

## TDD

### Pure lane (DONE, green)
`scripts/test-completed-pins.ts` (auto-discovered by `npm test`). RED proven first by
stubbing the helper to `return []` (7 assertions failed / threw), then GREEN with the
real helper: **12/12 passed**. Asserts: only completed+plottable tasks pin; the assigned
sealed active target is EXCLUDED; an unassigned task is EXCLUDED; a completed locationless
task is omitted; a completed (0,0) task is omitted; coords+title come from the GAME task;
smart `stationCoords` win; a hidden task not-yet-completed → no pin (the definitive
leak check); undefined inputs → empty (no throw); a completed record with no matching
game task → skipped.

### Typecheck (DONE, green)
`tsc --noEmit -p functions/tsconfig.json` → 0 errors.
`tsc --noEmit -p apps/play-web/tsconfig.json` → 0 errors.

## STAGED e2e assertion (NOT YET ADDED — owned by parent / needs the emulator)
Add to `scripts/e2e-verify.mjs` (the hidden-location / play-gating scenario). Intent:

> In a run with a hidden-location active task and at least one already-completed
> located mission, call `getMyTeamState` for that team and assert:
> 1. `completedTaskPins` is a non-empty array containing an entry `{ id, coordinates:
>    {lat,lng}, title }` for the completed located mission, with coordinates equal to
>    the game task's real coordinates.
> 2. `completedTaskPins` contains NO entry for the still-sealed hidden active task
>    (its id is absent), and NO entry for any unassigned task.
> 3. The active hidden task's entry in `activeStageTasks` still carries NO
>    `coordinates` and NO `title` (arrivalPending stub) — the seal is intact.
> 4. A completed LOCATIONLESS mission does not appear in `completedTaskPins`.
> After `reportArrival` unseals the hidden task, its coords appear in
> `activeStageTasks` (existing behavior) — completedTaskPins is unaffected by that.

Sketch:
```js
const st = await callAs(teamToken, 'getMyTeamState', { ownerUid, gameId, runId });
assert(Array.isArray(st.completedTaskPins), 'completedTaskPins present');
const pin = st.completedTaskPins.find((p) => p.id === completedLocatedTaskId);
assert(pin && pin.coordinates.lat === REAL_LAT && pin.coordinates.lng === REAL_LNG,
  'completed located mission is pinned with its real coords');
assert(!st.completedTaskPins.some((p) => p.id === hiddenActiveTaskId),
  'sealed hidden active target is NOT in completedTaskPins');
assert(!st.completedTaskPins.some((p) => p.id === locationlessDoneTaskId),
  'completed locationless mission is omitted');
const sealed = st.activeStageTasks.find((c) => c.id === hiddenActiveTaskId);
assert(sealed && sealed.coordinates == null && sealed.title == null,
  'hidden active task stub still carries no coords/title');
```
Also worth: extend the e2e ALLOWED response-shape checks — `completedTaskPins` is a
response-level field (not a Task payload) so it is outside the `ALLOWED_TASK_KEYS`
sanitizer allowlist, but a coverage note keeps a future reviewer from mistaking it for a
task-payload leak.

## Status
Server + client + pure test + typechecks: DONE, green, uncommitted on `topographic-maps`.
e2e assertion: STAGED here, pending the emulator + `scripts/e2e-verify.mjs` being free.
Not committed.

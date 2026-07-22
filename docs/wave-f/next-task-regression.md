# wave-f — "stuck player" next-task regression (P0)

A real player mid game (score 17, a multi task stage with at least one hidden
location task, having completed ≥1 task) got dead ended on the Play screen: the
red terminal error `t.task.routingError` ("לא הצלחנו לאחזר את המשימה הבאה") with a
"נסו שוב" button, and at other poll moments the `t.task.lockedOnly*` card
("המשימה הבאה עדיין נעולה / השלימו את המשימות שמופיעות למטה כדי לפתוח אותה") — with
nothing shown below. Routing could and should have handed the player their next
task.

Regression source: the wave D task visibility gating (commit `0b6a0bb`).
`getMyTeamState` now OMITS every non assigned task from `activeStageTasks` (only
the team's ASSIGNED + COMPLETED tasks ship). Two client sites still tried to look
up UNASSIGNED tasks inside `activeStageTasks`, so their lookups now always return
`undefined`.

---

## Bug A — false "everything is locked" (confirmed by code analysis)

`apps/play-web/src/components/TaskRunner.tsx:92-95`

```ts
const allRemainingLocked = unassigned.length > 0 && unassigned.every((rec) => {
  const c = state.activeStageTasks.find((x) => x.id === rec.taskId);
  return !c || !isUnlocked(c, completedTaskIds);   // ← !c is now ALWAYS true
});
```

Since every unassigned task is now absent from `activeStageTasks`, `c` is always
`undefined`, so `!c` is `true`, so EVERY unassigned task is classified "locked" —
including a task routing could assign this instant. When nothing is assigned yet
(normal between completing one task and being routed the next), `!task` is true
and the component renders the `lockedOnly` card (`TaskRunner.tsx:217-225`). That
is a dead end: the card tells the player to "complete the tasks shown below", but
`LockedTasksList` (`apps/play-web/src/screens/PlayScreen.tsx:830-862`) is ALSO
driven by `activeStageTasks.find(...)` for unassigned tasks, so it renders nothing
(and by wave D privacy it MUST stay empty — re throwing task titles onto the wire
would reopen the leak wave D closed).

The code comment at `TaskRunner.tsx:88-91` rationalised "treat no content as
locked", but "unassigned because routing has not picked it yet" is NOT
"unlock gated". The presence/absence of sanitized CONTENT is no longer a valid
signal for lock state.

### Fix A
The lock decision must come from the SERVER's authoritative game rule + team
record state, never from whether content happens to be on the wire.

`getMyTeamState` now returns a response level `lockedTaskIds: string[]` — the ids
of active stage tasks that are genuinely gated (unassigned AND
`!isReleased || !isUnlocked`). Ids only, no content: the client already holds
these ids in `team.stages[].tasks[].taskId`, and `unlockAfterTaskIds` is already
classified non secret, so nothing new leaks. It is a RESPONSE field, not a task
field, so `ALLOWED_TASK_KEYS` / the sanitizer allowlist guard is unaffected (that
guard only inspects per task payloads).

The pure computation is extracted to `packages/shared/src/gating.ts`
`lockedTaskIds(candidates, completedTaskIds, runStartedAt, nowMs)` and unit tested
(`scripts/test-locked-task-ids.ts`), so the "locked vs merely awaiting routing"
decision no longer depends on the omitted content payload.

Client:
```ts
const lockedIds = state.lockedTaskIds ?? [];
const allRemainingLocked = unassigned.length > 0
  && unassigned.every((rec) => lockedIds.includes(rec.taskId));
```
If any unassigned task is NOT in `lockedTaskIds` it is routable (or transiently
station full, handled separately) → `allRemainingLocked` is false → the neutral
"finding your next task" spinner shows and the routing effect assigns it, instead
of the false lock dead end.

`lockedOnlyBody` copy is corrected: it no longer promises a visible list (there
is none by wave D design) — "More tasks open up as you complete others."

---

## Bug B — the red `routingError` terminal state — REPRODUCED

`routingError` is set in TWO places in the routing `useEffect`
(`TaskRunner.tsx:101-129`):
1. `requestNextTask(...).catch(...)` — the callable REJECTED, and
2. `withLocation(..., onDenied)` — geolocation was denied / timed out / absent.

Reproduction verdict: **it is the geolocation path, not a server throw.**
`requestNextTask` does NOT require coordinates. Server side
(`functions/src/runs/index.ts:2915`):

```ts
const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
```

Routing degrades gracefully with no coords — `transitMinutes` guards
`isValidCoord` and falls back to a constant, and a hidden location task's transit
is already a constant regardless of coords. The e2e scenario
"stuck-next-task-regression" calls `requestNextTask` with NO lat/lng on a multi
task stage (that still holds a hidden location task) after the team completed one
task, and asserts it ASSIGNS the next task and does NOT reject. That proves the
server is innocent — the terminal error was the CLIENT making a GPS fix a hard
prerequisite for routing and mapping any GPS failure to "Could not get your next
task." On a real phone a 5 s GPS timeout (indoors, permission prompt, urban
canyon) is common, so the retry button just re times out → a permanent dead end.

### Fix B
Routing must not treat a geolocation failure as a routing failure. Since the
server routes fine without coordinates, the `onDenied` branch now issues the SAME
`requestNextTask` WITHOUT coords (degraded routing: load only, transit constant)
instead of setting `routingError`. The player keeps moving; precise GPS becomes an
optimisation, not a gate. `routingError` now fires ONLY on a genuine
`requestNextTask` rejection — which is what "Could not get your next task" honestly
means. The GPS prompts on `field()` / `checkArrival()` / geofence are unchanged —
those genuinely need proximity; ROUTING specifically does not.

---

## Files touched
- `packages/shared/src/gating.ts` — new pure `lockedTaskIds()` helper.
- `scripts/test-locked-task-ids.ts` — RED first unit test for the helper.
- `functions/src/runs/index.ts` — `getMyTeamState` computes + returns `lockedTaskIds`.
- `apps/play-web/src/services/calls.ts` — `MyTeamState.lockedTaskIds`.
- `apps/play-web/src/components/TaskRunner.tsx` — Fix A (server driven lock) + Fix B (GPS non fatal).
- `apps/play-web/src/i18n.ts` — corrected `lockedOnlyBody` (HE + EN).
- `scripts/e2e-verify.mjs` — "stuck-next-task-regression" scenario (asserts the wire).

## Not reopening the wave D leak
No non assigned task title / question / choice / coordinate is re shipped.
`lockedTaskIds` is ids only (already known to the client) and lives at the response
top level. `LockedTasksList` stays empty by design.

## Why

`team.outOfBounds` is a **latch**. Once set it blocks task assignment, and there is exactly **one**
code path in the whole repo that can unset it: a later `updateLocation` call carrying a position
inside the zone. A player whose phone stops producing usable GPS therefore cannot clear it — by any
means, by anyone. Verified in this working tree:

1. **Set on a single unfiltered fix.** `functions/src/index.ts:340-350` — `isOutsideSafeZone({lat,lng}, safeZone)`
   on whatever the client last sent, then `teamRef.set({ outOfBounds: true }, { merge: true })`. No
   accuracy input, no hysteresis, no "two consecutive fixes", no timestamp recorded.
2. **Accuracy is never even transmitted.** `apps/play-web/src/services/calls.ts:256` types
   `updateLocation` as `{ lat, lng }`; `apps/play-web/src/screens/PlayScreen.tsx:167-176` reads only
   `p.coords.latitude` / `p.coords.longitude` and drops `p.coords.accuracy`. A cell-tower fix with a
   500 m accuracy radius is treated as authoritative proof of a boundary violation. A team standing
   *inside* a 150 m zone can be flagged by a fix that is physically consistent with them being inside.
3. **Cleared only by a good fix.** `functions/src/index.ts:351-352` is the sole writer of
   `outOfBounds: false`. Nothing else in `functions/` writes the field (repo-wide grep: the only two
   writers are those two lines). There is **no** timeout, **no** auto-expiry, and the flag carries no
   timestamp that a timeout could even be computed from.
4. **The device going quiet latches it forever.** `PlayScreen.tsx:191` passes `() => undefined` as
   the `watchPosition` error callback — no restart, no signal. Permission revoked mid-run, battery
   saver, an indoor `POSITION_UNAVAILABLE`, or simply backgrounding the PWA all end the ping stream.
   `requestNextTask` (`functions/src/runs/index.ts:3025`) keeps returning `{ taskId: null,
   outOfBounds: true }` off a location that may be hours old, and `TaskRunner.tsx:337-345` renders a
   blocking card with no action on it. The team is done for the run.
5. **No human can rescue them.** `assertStaffOrOwner`-gated callables were audited one by one: none
   writes `outOfBounds`. `acknowledgeAlert` (`functions/src/index.ts:510-528`) marks the *alert* doc
   acknowledged and nothing else. `listRunTeams` (`functions/src/runs/index.ts:2393-2410`) does not
   even project the field, and `apps/creator-web/src/**` contains **zero** occurrences of
   `outOfBounds` — the run console cannot see the condition, let alone clear it. The only existing
   bypass is `run.isTestDrive` (`functions/src/runs/index.ts:3025`), which is unavailable on a real run.

Concrete trap, end to end: a team crosses 5 m past the boundary of a 150 m zone (or never leaves it
at all and gets one 400 m-accuracy fix). `outOfBounds` latches. They walk back in, but by then the
phone has been pocketed and the PWA backgrounded / the GPS has dropped to `POSITION_UNAVAILABLE`, so
no further `updateLocation` ever fires. They finish their assigned task, tap for the next one, and
get the amber "You're outside the play area" card — permanently. Staff cannot clear it, the creator
cannot see it, and the only escape is reinstalling / re-granting location and getting a confident fix
inside the zone. This is the same "stranded in a field" outcome as the geofence-watch bug, routed
through the server instead of the client.

## What Changes

**The out-of-bounds verdict becomes a pure, total, fail-open function.**
- A single function takes the last known fix (coordinates, accuracy, timestamp), the safe zone, a
  staff override, and the server's clock, and returns an explicit verdict plus the *reason* for it.
- It **fails open** on every low-information input: no fix, missing/NaN coordinates, a stale fix, or
  a fix whose accuracy radius is large enough that "outside" is indistinguishable from "inside" all
  return "not out of bounds". Absence of evidence stops being treated as evidence of a violation.
- On-boundary stays inside; one metre beyond, with a confident fix, is still outside. Genuine
  breaches are unaffected.

**Accuracy is carried end to end and respected.**
- The participant app sends the fix's accuracy radius with the position; the server stores it and
  feeds it into the verdict. A fix is only "outside" when it is outside *by more than its own
  accuracy radius*, and a fix whose accuracy exceeds a trust ceiling can never flag anyone.

**The latch can no longer survive the signal that created it.**
- Before honouring the latch, the assignment path re-evaluates it against the team's last known fix.
  If that fix is stale, low-confidence, absent, or now inside, the latch is released and the team is
  routed normally. The latch persists only while fresh, confident, out-of-zone fixes keep arriving —
  which is exactly the case it was designed for.

**Staff and the creator get a visible, auditable override.**
- The run console shows which teams are flagged out of bounds and offers a one-tap "let them back
  in" control, scoped to staff-or-owner, written to the audit log, and honoured for a grace window so
  a rescued team is not immediately re-latched by the same bad fix.

### Non-goals

- **Not a relaxation of the safe zone.** A team that is genuinely, verifiably outside is still
  flagged, still alerts the organizer, and still gets no new tasks.
- **No client-side authority.** The verdict stays entirely server-side; the client gains only the
  ability to *report* accuracy, never to assert whether it is in bounds.
- **No change to the alert surface.** `safe_zone_breach` alerts, their shape, and `acknowledgeAlert`
  are untouched.
- **No change to `isOutsideSafeZone`.** The existing predicate and its tests stay exactly as they are;
  the new evaluator wraps it.
- **No play-web copy changes.** The participant card is left to the i18n lane that owns
  `apps/play-web/src/i18n.ts`; the rescue surface added here is the creator run console.
- **No geofence-task changes.** `Task.geofenceRadiusMeters` check-in is a separate mechanism.

## Capabilities

### Modified Capabilities
- `safe-zone`: breach detection becomes a pure, fail-open evaluation over the last known fix
  (coordinates + accuracy + age) instead of an unconditional verdict on raw coordinates; the
  `outOfBounds` latch is re-evaluated before it is allowed to block assignment, so it cannot outlive
  the location stream that produced it; and a staff/owner override is added so a human can release a
  team the system cannot verify.

## Impact

- **Surfaces touched:** `packages/shared/src/safeZone.ts` (new pure evaluator, existing predicate
  untouched), `functions/src/index.ts` (`updateLocation`, new `clearTeamOutOfBounds` callable),
  `functions/src/runs/index.ts` (`requestNextTask` latch re-evaluation, `listRunTeams` projection),
  `packages/shared/src/types/index.ts` (`RunTeam` fields), `apps/play-web/src/services/calls.ts` +
  `screens/PlayScreen.tsx` (send accuracy), `apps/creator-web/src/**` (calls, run console UI, HE/EN
  i18n).
- **New callable:** `clearTeamOutOfBounds` — staff-or-owner, audit-logged. The e2e callable-coverage
  guard requires every callable to be exercised, so the safe-zone scenario in `scripts/e2e-verify.mjs`
  gains assertions for it.
- **Backwards compatibility:** `outOfBounds` keeps its meaning and its type. New team fields
  (`outOfBoundsAt`, `outOfBoundsOverrideUntil`) and the new location field (`accuracyMeters`) are all
  optional; a team document written before this change evaluates exactly as one written after it,
  with the missing timestamp treated as "unknown age" → fail open.
- **Risk:** the change biases toward releasing teams. A team that is genuinely outside but whose phone
  stops reporting will be released after the staleness window. That is the deliberate trade: an
  unverifiable violation must not strand a player, and the organizer still has the breach alert.
- **Testing:** pure-logic lane (vitest in `packages/shared`) for the evaluator, including the
  boundary ±1 m, low-accuracy, no-fix, stale-fix, clock-skew and NaN cases. e2e assertions for the new
  callable are **written but deliberately not run** — a live playtest stack is serving from this tree
  and no emulator may be started.

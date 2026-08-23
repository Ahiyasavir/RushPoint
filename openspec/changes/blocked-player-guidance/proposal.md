## Why

A blocked participant is told nothing they can act on, so they stand in a field with a card that
never changes.

Two dead ends were confirmed by reading this working tree:

1. **The out-of-bounds card is actionless.** `TaskRunner.tsx:337-345` renders "You're outside the
   play area / Head back into the play area" whenever `state.team.outOfBounds` is true. That is the
   whole card: no distance, no retry, no way to reach a human. Meanwhile the server ALREADY knows
   more than that and already puts it on the wire — `requestNextTask` returns
   `{ taskId: null, outOfBounds: true, reason }` (`functions/src/runs/index.ts:3052`) and
   `updateLocation` returns `{ ok, outOfBounds, reason }` (`functions/src/index.ts:389`), where
   `reason` is `evaluateSafeZoneStatus`'s verdict (`packages/shared/src/safeZone.ts`): `outside`,
   `low_confidence`, `stale_fix`, `no_fix`, `invalid_fix`, `override`, `inside`, `no_zone`. **No
   client reads it.** So the four situations below are rendered as the same sentence:
   - the team really did walk out of the play area (they can walk back);
   - the phone's last fix was too imprecise or too old to place them at all (the card blames them
     for something that is not their doing, and no amount of walking changes it);
   - staff already released them (they are free to continue and do not know it);
   - the game has no boundary at all and something else is going on.
2. **A `geofence` task can dead-end with no help affordance.** The escape hatch in `GeofenceAuto`
   (`TaskRunner.tsx:1218`) is gated on `stuckOutside = dist != null && dist > radius && stuckTooLong`.
   When the watcher never produces a fix AND never reports an error — a permission prompt left
   open, a webview that silently never calls back — `dist` stays `null`, `gpsError` stays `false`,
   and the card sits on "Finding your location…" forever with no button on it. A `geofence` task has
   no manual submit for a real player (the "I'm here" button renders only under
   `session.isTestDrive`), so that screen is a terminal state.

## What Changes

**The server's `reason` becomes actionable guidance, decided by a pure function.**

- A new `blockedGuidance()` in `apps/play-web/src/lib/stuckGuards.ts` maps the server's verdict to
  ONE of four kinds and to whether a distance may be shown, covered by
  `scripts/test-stuck-player-guards.ts` in the no-emulator `npm test` lane:
  - `outside` — a fresh, confident fix outside the boundary. Show how far back they must walk.
  - `unconfirmed` — `low_confidence` / `stale_fix` / `no_fix` / `invalid_fix` / `unverifiable`. The
    copy states plainly that WE cannot place them and that it is not their fault, and no distance is
    shown, because a distance computed from a fix the server itself does not trust would send a
    player walking in a direction nobody can vouch for.
  - `released` — `override` / `inside` / `no_zone`: the server says nothing is blocking them.
  - `unknown` — a missing, unfamiliar or malformed reason falls here (fail open in COPY too: never
    assert a violation we cannot substantiate).

**The blocking card gets the two things a stranded player needs: information and a human.**

- It tells them what happens next, that staff can release them, and (for `outside` only) roughly how
  many metres back it is.
- It reuses the EXISTING host-help affordance (`triggerSOS` via `requestHelp`, remembered with
  `helpAlreadySent`) so the alarm can be raised from the blocking card itself.
- It offers a "check again" button that re-asks the SERVER (`requestNextTask`). This is not a
  bypass: the server re-evaluates and answers, so a staff release or a recovered fix clears the card
  on the server's say-so, not the client's.

**The geofence card offers help whenever it is stuck, including when no fix ever arrives.**

- The escape hatch condition drops the `dist != null` requirement, so "we never located you" reaches
  the same help affordance as "you are outside the radius".

**The server ships the one number the card needs.** `requestNextTask`'s out-of-bounds response gains
`metersOutside` (metres BEYOND the boundary, computed server-side from the same evaluated fix, never
the raw zone geometry), so the client can state a distance without being told where the zone is and
without deciding anything about it.

## Impact

- Affected specs: `play-stuck-guards` (one ADDED requirement).
- Affected code: `apps/play-web/src/lib/stuckGuards.ts` (add `blockedGuidance`, `BLOCKED_HELP_KEY`),
  `apps/play-web/src/components/TaskRunner.tsx` (the out-of-bounds card, the `GeofenceAuto` help
  condition, `requestHelp` takes the id it latches), `apps/play-web/src/services/calls.ts`
  (`requestNextTask` result type), `apps/play-web/src/i18n.ts` (new keys, HE + EN),
  `functions/src/runs/index.ts` (`evaluateTeamOutOfBounds` also returns `metersOutside`),
  `scripts/test-stuck-player-guards.ts` (new assertions).
- NOT touched: the safe-zone evaluator itself, every server gate, and the client's authority — the
  client still never decides it is in bounds and `geofence` still has no manual completion for a
  real player. This change adds information and a route to a human, nothing else.

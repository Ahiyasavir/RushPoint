# Bring the participant hot path inside the Spark READ ceiling

## Why

`spark-tier-location-load` fixed the write ceiling and, by adding a server-side op counter,
made it possible to measure the read ceiling for the first time. Measured against **production**
(`api.rush-point.com`, `RUSHPOINT_FS_OPCOUNT=1`, walking teams at the app's real 20 s cadence),
the picture is:

| | 100 teams, 75 min | Spark ceiling | |
|---|---|---|---|
| writes | 13,500 | 20,000 | **0.68× — fits** |
| reads | ~93,600 | 50,000 | **1.9× — does not fit** |

Writes are solved. Reads are not, and the cause is not location:

| source | reads at 100 teams | share |
|---|---|---|
| `getMyTeamState` polled every 12 s | 61,125 | **65%** |
| `updateLocation` at 20 s | 22,500 | 24% |
| everything else | ~10,000 | 11% |

A real event of ~100 teams is scheduled in a week. On the current numbers it would exhaust the
day's read quota roughly 40 minutes in and every participant would start seeing
`RESOURCE_EXHAUSTED` — the same failure the 2026-08-26 run hit, from a different direction.

Two facts make this cheap to fix:

1. **The 12 s poll is a FALLBACK, not the state channel.** `PlayScreen` already attaches an
   `onSnapshot` listener to the team document that calls `getMyTeamState` on every change, so
   mission state is push-driven and stays instant. The interval exists to keep the leaderboard
   fresh and to recover if the listener never attaches — neither needs 12 seconds.
2. **The client already throttles pings to 20 s, but the server now suppresses most of them
   anyway.** After `spark-tier-location-load` the server writes a pin at most once per 60 s
   unless the team moved beyond the jump threshold. A ping the server will suppress still costs a
   full callable invocation and a Firestore read. The client can decline to send it using the
   SAME pure verdict the server uses.

## What Changes

- **Slow the participant fallback poll** from 12 s to a value that keeps the leaderboard usably
  fresh without paying for it 375 times per team per run. Push-driven state is unaffected.
- **Gate the client's own ping** on `shouldWritePin` (already written and tested in
  `packages/shared/src/locationPingEconomy.ts`) plus a **safety floor**: the client MUST NOT stay
  silent longer than the floor, because the server's safe-zone verdict only runs when a ping
  arrives. Suppressing a ping must never delay a breach alert beyond that floor.
- **Keep the server's guard exactly as it is.** The client gate is an optimisation; the server
  remains the authority. A client that ignores the gate is still correct, just more expensive.

## Impact

- Affected specs: `participant-read-budget` (new)
- Affected code: `apps/play-web/src/screens/PlayScreen.tsx`, new
  `apps/play-web/src/lib/pingGate.ts`, new `scripts/test-play-ping-gate.ts`
- **Not** affected: every server callable, `firestore.rules`, scoring, routing. No payload or
  return shape changes, so no `services/calls.ts` wrapper moves.

## Risk

The one real risk is **staleness the participant can feel**. It is bounded deliberately:
mission state is pushed by the existing snapshot listener and does not depend on the poll; the
leaderboard is the only thing the poll uniquely refreshes, and it is not a real-time surface.
The safe-zone floor is the hard constraint — it is chosen so a breach is still detected within
the same window the server's own suppression already allows, not widened to save reads.

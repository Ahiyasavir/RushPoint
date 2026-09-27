# Design — participant read budget

## The arithmetic this change is accountable to

Measured against production with `RUSHPOINT_FS_OPCOUNT=1`, walking teams, the app's real 20 s
ping cadence and the real client payload shape (`{ownerUid, gameId, runId}`, not `{code}` —
sending `code` adds an `accessCodes` lookup and overstates the hot path by ~1 read):

| callable | reads/call (production) |
|---|---|
| `getMyTeamState` | **1.63** |
| `updateLocation` | **1.00** |
| `reportArrival` | 2.00 |
| `requestNextTask` | 5.13 |

Per team, 75-minute run, today:

- poll: `75 × 60 ÷ 12 = 375` calls × 1.63 = **611 reads**
- ping: `75 × 60 ÷ 20 = 225` calls × 1.00 = **225 reads**
- everything else ≈ 100 reads

⇒ ~936 reads/team ⇒ **93,600 at 100 teams** against a 50,000 ceiling.

## D1 — Poll interval: 12 s → 45 s

`PlayScreen` holds BOTH an `onSnapshot` listener on the team document (which calls
`getMyTeamState` on every change) and a 12 s interval. The comment at the interval already calls
it a *"slow fallback poll"* whose job is the leaderboard and listener recovery — gameplay state
arrives on the listener.

45 s was chosen, not 30 s or 60 s, because:

- it takes the poll from 375 to **100 calls/team** (163 reads), a 3.75× cut, which is what the
  budget needs;
- the leaderboard is not a real-time surface — a standing that is up to 45 s old is
  indistinguishable to a player from one that is 12 s old, because their own progress arrives
  instantly on the listener regardless;
- 60 s would save only another 40 reads/team while making a genuinely failed listener take a
  minute to recover, which is the case where the poll actually matters.

**Rejected: removing the poll.** It is the only recovery path when the listener never attaches
(the code already documents that `ensureAuth()` can reject on a transient first-auth failure and
skip attaching). Trading a rare hard-stuck player for ~160 reads is a bad trade.

## D2 — The client applies the server's own verdict

`shouldWritePin` (`packages/shared/src/locationPingEconomy.ts`) is already pure, total,
clock-injected and unit-tested, and `packages/shared` is framework-free, so play-web can import
it directly. Reusing it means the client and server can never disagree about what a "significant"
move is — the alternative, a second threshold constant in the client, is exactly the drift that
produces "the app thinks it moved but the server doesn't".

The client keeps its OWN last-sent fix (a ref), not the server's last-written fix. These can
diverge after a server restart, which is fine and deliberate: the server's guard is authoritative,
and divergence can only cause the client to send a ping the server then suppresses — the safe
direction.

## D3 — The safety floor is the constraint, and it is not negotiable for reads

The server evaluates the safe zone **only when a ping arrives**. So client-side suppression
directly bounds how late a breach can be noticed. The floor is 60 s — numerically equal to the
server's current minimum write interval, so the change does not widen the safety window at all:
before this change a stationary team outside the zone was evaluated every 20 s but only written
every 60 s; after it, the evaluation also drops to 60 s.

**The floor is its own literal, NOT an alias of `PIN_MIN_WRITE_INTERVAL_MS`.** Writing
`PING_MAX_SILENCE_MS = PIN_MIN_WRITE_INTERVAL_MS` was the first attempt and it is subtly wrong:
the two are equal today but they mean different things, and aliasing them makes the floor unable
to do its only job. Someone raising the server's write interval later — a reasonable thing to
want, since writes are the scarcer quota — would drag the safety bound up with it and silently
extend how long a team can stand outside the boundary unnoticed. Kept separate, the floor holds
while the interval moves. `shouldSendPing` therefore accepts an optional `minWriteIntervalMs`
purely so that independence is **provable**: with the default interval the two coincide and the
floor never fires on its own, which would leave an untested guard indistinguishable from a broken
one.

That IS a real reduction in evaluation frequency, and it is stated rather than hidden. It is
accepted because:

- the out-of-bounds verdict is already deliberately conservative and fails open
  (`evaluateSafeZoneStatus`: absent, stale, malformed or low-accuracy ⇒ not a violation), so it
  was never a sub-minute safety mechanism;
- a team walking OUT of the zone crosses the jump threshold long before the floor elapses, so a
  team in actual motion is detected on the very next fix, not after 60 s;
- the case the floor governs is a team standing still outside the boundary, which the 60 s floor
  still catches.

**Rejected: keeping the ping at 20 s and buying the reads elsewhere.** There is nowhere else to
buy them — the poll cut alone leaves ~26,000 reads at 120 teams and the ping is the next largest
line. Rejected also because a ping whose only outcome is a suppressed write is pure waste; the
right fix is not to fund the waste.

## D4 — Where the gate lives

A new `apps/play-web/src/lib/pingGate.ts`, pure and clock-injected, wrapping `shouldWritePin`
with the floor. It goes in play-web rather than `packages/shared` because the floor is a property
of THIS client's send policy, not of the server's write policy — putting it in shared would
imply the server enforces it, which it does not.

Tested by `scripts/test-play-ping-gate.ts`, which the unit-test aggregator auto-discovers.

## Projected result

| | today | after | ceiling |
|---|---|---|---|
| poll reads / team | 611 | 163 | |
| ping reads / team | 225 | 75 | |
| other | ~100 | ~100 | |
| **100 teams** | **93,600** | **33,800** | 50,000 |
| **120 teams** | **112,300** | **40,560** | 50,000 |

Both fit, with the 120-team case at 81% of the ceiling. That remaining headroom is thin enough
that it should be measured after the change, not assumed — which is what the production
simulator exists to do.

## Files to touch

- `apps/play-web/src/lib/pingGate.ts` — new, pure.
- `apps/play-web/src/screens/PlayScreen.tsx` — poll constant; ping gated.
- `scripts/test-play-ping-gate.ts` — new pure suite.

**Untouched:** every callable, `firestore.rules`, `services/calls.ts`.

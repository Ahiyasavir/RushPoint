# Baseline — measured before any behavior change

Captured with `RUSHPOINT_FS_OPCOUNT=1` against the emulator (port-offset lane), via
`scripts/measure-location-cost.mjs --pings=30` and `scripts/fs-ops-report.mjs`.
Game configured **with a safe zone**, which is what most outdoor runs use and what makes
`updateLocation` read the game document.

## Per-callable, as measured

| callable | calls | reads | writes | per call |
|---|---|---|---|---|
| `updateLocation` | 30 | 90 | 60 | **3.00r / 2.00w** |
| `joinRun` | 1 | 7 | 0 | 7.00r / 0.00w |
| `startTeams` | 1 | 6 | 1 | 6.00r / 1.00w |
| `launchRun` | 1 | 2 | 2 | 2.00r / 2.00w |
| `updateGame` | 1 | 1 | 1 | 1.00r / 1.00w |
| `createGame` | 1 | 0 | 1 | 0.00r / 1.00w |

## Projection — location alone, 120 participants, 75-minute run

Denominator: 3.00 reads and 2.00 writes per ping, measured over 30 pings, scaled by
225 pings/participant (75 min at the 20 s client cadence) × 120 participants.

```
projected:  81,000 reads / 54,000 writes
quota:      50,000 reads / 20,000 writes  (Spark, daily)
headroom:  -31,000 reads / -34,000 writes
⇒ DOES NOT FIT
```

## The finding the measurement produced

**Reading the code predicted 2 reads per ping. The measured cost is 3.**

`functions/src/index.ts:335-427` shows two explicit reads — the game doc at `:380` and the
team doc at `:385`. The third is `resolveCallerTeam(uid, …)` at `:360`, which reads the team
document *before* the safe-zone block reads it again.

So the team document is fetched **twice per ping**, and the projected read cost is 81,000
rather than the 54,000 estimated in the proposal — 1.6× over the read ceiling, on top of
2.7× over the write ceiling.

This is exactly why the baseline was taken before touching anything: the estimate in
proposal.md was wrong in the direction of optimism, and a "we fixed it" claim measured
against that estimate would have overstated the improvement.

## Consequence for the design

Design D5 (route both reads through `cachedGetDoc`) is now known to be addressing *three*
reads, not two — and the duplicate team-doc read is worth collapsing outright rather than
merely caching, since the two reads are within microseconds of each other in the same
invocation. Follow-on in task 4.4.

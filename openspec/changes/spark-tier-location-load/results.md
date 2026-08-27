# Results — measured before and after

Same harness both times: `scripts/measure-location-cost.mjs` under the emulator with
`RUSHPOINT_FS_OPCOUNT=1`, aggregated by `scripts/fs-ops-report.mjs`. Game configured **with a
safe zone**, which is the configuration that makes `updateLocation` read the game document.

The "after" runs use `--cadence-ms=20000`, spacing pings 20 s apart exactly as play-web does.
This matters: the pin write is rate-limited on the server's clock, so firing pings back to
back would suppress nearly all of them and report a saving no real run would ever see.

## `updateLocation`, per ping

| | reads | writes | note |
|---|---|---|---|
| **Before** | 3.00 | 2.00 | measured baseline |
| After — duplicate read removed | 2.00 | 0.43 | no cache required |
| **After — with `RUSHPOINT_DOC_CACHE=1`** | **1.52** | **0.43** | the VPS configuration |

## Projected to 120 participants, 75-minute run

Denominator: 225 pings per participant (75 min at the 20 s cadence) × 120 participants.

| | reads | writes |
|---|---|---|
| **Before** | 81,000 | 54,000 |
| After, no cache | 54,000 | 11,571 |
| **After, cache on** | **41,143** | **11,571** |
| Spark daily ceiling | 50,000 | 20,000 |
| Headroom (cache on) | **+8,857** | **+8,429** |

**Location alone now fits, with headroom on both ceilings.** Before, it exceeded both.

## Where the saving came from

1. **Writes: 2.00 → 0.43 per ping (4.7×).** The pin is written at most once per 60 s, or
   immediately on a move beyond 75 m; the history track is retained per 100 m travelled
   rather than per ping. A stationary team now writes almost nothing.
2. **Reads: 3.00 → 2.00 without any cache.** The baseline measurement found the team document
   was being read **twice** per ping — once by `resolveCallerTeam`, then again by the
   safe-zone block. `resolveCallerTeam` already returns the team, so the second read was
   pure waste. This fix needs no cache to be enabled and cannot go stale.
3. **Reads: 2.00 → 1.52 with the document cache on.** The game document (`safeZone`) does not
   change during a run, so re-reading it every ping was waste the cache can absorb.

## Two honest caveats

- **1.52 is pessimistic, not optimistic.** The Functions emulator runs a `RuntimeWorkerPool`
  of separate processes, so a game document cached by one worker is not available to
  another. The VPS API is a single process (`functions/server.js`, no `cluster`), where that
  read should collapse further — toward ~1.00 read/ping, or ~27,000 reads. The emulator
  cannot demonstrate that; the number above is the floor, not the ceiling.
- **This measures location only.** Missions, the photo feed, chat, announcements and
  leaderboard refreshes are not included, and the remaining headroom (~8,400 writes,
  ~8,900 reads) is what they have to fit inside. Whether a full 120-person media-heavy run
  fits is still an open question — but it is now a question with a measurable denominator
  rather than an estimate.

## A correctness improvement that came with it

`scripts/test-heatmap-sampling-fidelity.ts` measured something that was wrong before this
change, independent of cost: under per-ping retention, the place teams **stood still** — at a
task, in a queue — became the hottest cell on the movement heatmap, at **>10× a typical
moving cell**. A movement heatmap was reporting the opposite of movement.

Distance-based retention takes that to **≤1.5×**, a >5× reduction in the distortion, while
preserving the busy-vs-quiet corridor ratio within 35% of the unsampled map. Retaining by
distance is more truthful here, not merely cheaper.

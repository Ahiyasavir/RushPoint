# Stop re-reading the whole field on every scoring event

## Why

`participant-read-budget` fixed the participant hot path and projected ~40,600 reads for 120
teams. That projection was **wrong**, and the production op counter is what showed it: it
measured per-call costs in a *compressed* simulation, where wall-clock-throttled work fires far
less often per unit of game time than it does in a real 75-minute run.

Modelled at real time-scale, with production per-call costs:

| source | reads, 120 teams / 75 min |
|---|---|
| **leaderboard auto-refresh (every 20 s, ALL teams)** | **27,450** |
| `getMyTeamState` (45 s poll) | 18,480 |
| run console `listRunTeams` (churn-driven) | 14,220 |
| other player actions | 11,794 |
| `updateLocation` (gated) | 10,908 |
| **total** | **82,852** vs a 50,000 ceiling — **1.66×** |

The largest single consumer is invisible. `maybeRefreshLeaderboardSnapshot` runs inside player
callables on a 20-second throttle and does `db.collection(teamsCol(...)).get()` — an **uncached
read of every team document**. Its cost is billed to whichever player action happened to trigger
it, which is why `submitTaskAnswer` measures 10.53 reads/call and `completeTask` 10.69 while
their own logic touches three documents.

`listRunTeams` already solved this exact problem: it reads the same collection through
`cachedGetCollection`, which re-reads only documents that were actually written. The leaderboard
refresh simply never adopted it.

## What Changes

- **Route the leaderboard refresh's team read through `cachedGetCollection`**, the same helper
  and the same cache `listRunTeams` uses. Cost stops scaling with team count and starts scaling
  with churn: ~2,700 instead of ~27,450.
- **Throttle the `teamLocations` read inside `listRunTeams`.** It exists to supply
  `lastLocationAt`, a freshness signal used to tell a dead GPS watch from a slow team — a
  minutes-scale judgement being refreshed every 5 seconds, and re-read constantly because every
  location ping invalidates it.
- **Route the remaining hot-path game-document reads through `cachedGetDoc`.** The game template
  cannot change mid-run; ~20 call sites still read it uncached, two already do not.
- **Lengthen the participant fallback poll to 60 s.** 45 s was chosen against a budget that has
  since been shown to be wrong.

## Impact

- Affected specs: `firestore-quota-budget`
- Affected code: `functions/src/runs/index.ts` (leaderboard refresh, `listRunTeams`, hot-path
  game reads), `apps/play-web/src/screens/PlayScreen.tsx` (poll interval)
- No callable signature changes, no schema changes, no rules changes.

## Risk

The cache is correct **only** because the API is the sole writer and runs as one process — the
precondition `docCache.ts` already documents. A team's score change invalidates that team's entry,
so the next refresh reads it fresh; the leaderboard cannot serve a stale ranking for a team that
just scored. The `teamLocations` throttle trades freshness of a staleness indicator: bounded and
stated, and it never gates a safety decision (the safe-zone verdict runs in `updateLocation`, not
here).

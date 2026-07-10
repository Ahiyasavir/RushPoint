# Design: live-leaderboard-auto-refresh

## Context

`run.leaderboard` is a snapshot written only by `refreshLeaderboard` (manual button in
RunConsole) and `finalizeRun`. Every scoreboard surface renders that snapshot:

- RunConsole standings panel — Firestore listener on the run doc.
- TV screen (`?tv=`) and public board (`?board=`) — poll `getPublicLeaderboard` every ~15 s,
  which just reads the snapshot (gated on `published`).
- play-web FinalScreen — reads `run.leaderboard` from `getMyTeamState`.

Observed in a live playtest: a team finished with 194 points (team doc correct) while the
snapshot still showed `score: 0` from before its first completion; a −50 staff adjustment went
into `team.bonusPenalty` and was visible nowhere (leaderboard stale, and the console teams
table shows raw `team.score`, which by design excludes `bonusPenalty`).

Constraints: run/team docs are server-write-only; `buildRankings` is shared by
`refreshLeaderboard` + `finalizeRun` and must not fork; `completeTaskForTeam` is the hot path —
past lesson: no extra transactions inside it (memory: competitive-upgrades).

## Goals / Non-Goals

**Goals:**
- The snapshot stays fresh during a live run with zero organizer action.
- `adjustTeamScore` is visible immediately (leaderboard + console teams table).
- Sharing the TV/public link publishes the board so it never shows "not available" to the
  organizer's own projection.

**Non-Goals:**
- No realtime push; polling cadence of existing surfaces unchanged.
- No change to `buildRankings`, scoring math, or the `published` privacy gate semantics.
- No auto-publish at launch.

## Decisions

### 1. Server-side post-completion refresh, not console polling
A console-driven `refreshLeaderboard` poll only works while the console tab is open; TV/public
boards would still go stale. The server refreshing after scoring events fixes every surface at
once. Alternative rejected: Firestore trigger on team docs (v1 triggers add cold-start latency
and an always-on cost; an explicit call in the two mutation sites is simpler and testable).

**New internal helper** in `functions/src/runs/index.ts` (NOT exported from `functions/src/index.ts`,
like `completeTaskForTeam`):

```ts
async function maybeRefreshLeaderboardSnapshot(
  ownerUid: string, gameId: string, runId: string, opts?: { force?: boolean },
): Promise<void>
```

- Reads the run doc; **skips when `leaderboard.frozen`** (freeze means "stop updating" — a
  suspense reveal must not be overwritten by an auto-refresh).
- Skips when `!opts.force` and the snapshot is fresh (pure helper decision, below).
- Otherwise reads game + teams, `buildRankings`, and updates `run.leaderboard`
  **preserving `published`/`frozen`** (same merge logic as `refreshLeaderboard`).
- Entirely best-effort: wrapped in try/catch; a refresh failure must never fail the
  completion/adjustment that triggered it. Plain reads + one `update()` — **no transaction**
  (concurrent refreshes are idempotent recomputes; last write wins and both are correct).

Call sites:
- `completeTaskForTeam` epilogue (after the transaction + slot release, only when
  `didComplete`): throttled (`force: false`).
- `adjustTeamScore` (after its transaction + audit log): `force: true` — the operator expects
  to see the result now.
- `skipStage` (after its transaction): `force: true` — owner-triggered, rare.

### 2. Throttle as a pure shared function (TDD lane: vitest)
`packages/shared/src/scoringPresets.ts` is scoring-only; put the helper in a small pure module
`functions/src/runs/leaderboardThrottle.ts`:

```ts
export const LEADERBOARD_REFRESH_MIN_MS = 20_000;
export function shouldRefreshLeaderboard(
  lastUpdatedAt: string | undefined, nowMs: number, minIntervalMs = LEADERBOARD_REFRESH_MIN_MS,
): boolean
```

Returns true when `lastUpdatedAt` is absent/unparsable or older than `minIntervalMs`.
Co-located `leaderboardThrottle.test.ts` (vitest, no emulator) — this is the RED-first test.
Trade-off: a completion inside the throttle window is reflected up to 20 s late — acceptable
(TV polls at 15 s anyway) and the next scoring event or manual refresh catches it up.

### 3. `listRunTeams` returns `bonusPenalty`; console shows effective score
Add `bonusPenalty: t.bonusPenalty ?? 0` to the row in `listRunTeams`
(functions/src/runs/index.ts:1714). Do **not** change the meaning of the existing `score`
field — the e2e invariant oracle asserts `team.score == Σ earnedScore`; changing `score`
semantics would break Σ-earned parity. The console (`RunConsolePage.tsx` teams table +
`RunTeamRow` type in `apps/creator-web/src/services/calls.ts`) displays
`score - bonusPenalty` as the effective score. Any new label goes through `t.*` in
`apps/creator-web/src/i18n.ts` (both HE + EN) — `npm run i18n:check` must stay clean.

### 4. Share actions publish first
In `RunConsolePage.tsx`, the "copy TV link" / "copy public leaderboard link" handlers call
`refreshLeaderboard({ ...ctx, publish: true })` before copying when the board isn't already
published. Reuses the existing wrapper; no callable change. The existing hidden/visible toggle
remains the way to un-publish.

## Test strategy (up front)

1. **Pure (RED first):** `functions/src/runs/leaderboardThrottle.test.ts` — vitest: fresh
   snapshot → false; stale → true; undefined/garbage `updatedAt` → true; boundary at exactly
   `minIntervalMs`.
2. **e2e (`scripts/e2e-verify.mjs`, extend the lifecycle scenario):**
   - After a participant task completion (no manual refresh), the run doc's
     `leaderboard.rankings` contains that team with `score > 0` and a fresh `updatedAt`.
   - `adjustTeamScore(delta: -50)` → next `listRunTeams` row has `bonusPenalty` reflecting the
     delta AND `run.leaderboard` shows the team's score reduced by 50 (still Σ-earned on
     `team.score` — oracle untouched).
   - Frozen board: freeze via `refreshLeaderboard({frozen:true})`, complete a task, assert the
     snapshot did NOT change.
   - No new callable → the coverage guard stays 66/66 with no scenario additions required for
     coverage (assertions extend existing scenarios).
3. **UI:** preview-verify the console teams table shows the adjusted score; `npm run
   i18n:check` (mandatory — UI touched).

## Risks / Trade-offs

- [Extra run-doc write per scoring event] → 20 s throttle; write is small (rankings capped by
  team count) and transaction-free.
- [Concurrent completions both refresh] → idempotent recompute from current team docs; last
  write wins, both correct. No transaction needed.
- [Auto-refresh racing a manual freeze] → the helper re-reads the run doc right before
  computing and skips when frozen; a sub-second race can still overwrite a *just*-frozen board
  once, after which freezes hold. Accepted (freeze is a presentation nicety, not integrity).
- [Large runs (50 teams) re-reading all teams per refresh] → same cost as today's manual
  refresh; bounded by `maxParticipants`; throttle caps frequency.

## Migration Plan

Pure additive backend behavior + console UI; no schema/rules/index changes; no new env vars.
Deploy functions + creator-web together (console works either way — the button remains).
Rollback = revert; snapshot simply goes back to manual-only.

## Open Questions

None.

# Proposal: fix-nonfinite-callable-payload

## Why

A family playtest run produced **51 callable failures** where a callable returned `Infinity` and the
firebase-functions serializer threw `Data cannot be encoded in JSON: Infinity`, so the player got an
error instead of a response (47× `getMyTeamState`, 4× `refreshLeaderboard`, from
`.firebase/playtest-forever.log`).

Root cause: `durationSeconds(startedAt, finishedAt)` in `packages/shared/src/scoringPresets.ts`
returns `Infinity` when `startedAt` is missing. In `buildRankings` (`functions/src/runs/index.ts`)
that value flows straight into every leaderboard entry's `durationSeconds` and `totalMinutes`. **Any
team that joined but was not yet started** (normal when participants join at different times) makes
`durationSeconds === Infinity`, poisoning `run.leaderboard`. `getMyTeamState` embeds
`run.leaderboard` in its response and `refreshLeaderboard` returns it, so both crash at JSON-encode.
This is the dominant defect of the run: it manifests as "teams stuck at 0", frozen player screens,
a dead live leaderboard, and broken post-game analytics — all from one non-finite number.

## What Changes

- **Root fix:** `buildRankings` writes `durationSeconds` / `totalMinutes` only when the computed
  duration is finite; otherwise it omits them (both fields are already optional on `LeaderboardEntry`).
  An unstarted/unfinished team therefore contributes no non-finite value to `run.leaderboard`.
- **Class-eliminating backstop:** a pure shared helper `sanitizeFinite(value)` deep-walks a callable
  result and replaces any non-finite `number` (`Infinity`, `-Infinity`, `NaN`) with `null`, leaving
  everything else untouched. `loggedCallable` applies it to every callable's return value, so no
  callable can ever again crash the JSON encoder — the failure becomes a benign `null` field.

## Non-goals

- No change to `durationSeconds`' own contract (it still returns `Infinity` for the missing-input
  case; callers that use it purely for sorting rely on that). We fix the *serialized* boundary.
- No backfill of already-written `run.leaderboard` snapshots; the next scoring event rewrites them
  cleanly.
- No change to ranking order, scoring math, or callable signatures.

## Capabilities

### New Capabilities
- `callable-payload-integrity`: no callable return value may contain a non-finite number; the live
  leaderboard snapshot written to a run is always JSON-encodable.

## Impact

- **Surfaces touched:** shared (`packages/shared/src/sanitizeFinite.ts` + index export), functions
  (`obs/log.ts` wrapper, `runs/index.ts` `buildRankings`). No client change.
- **Callables affected (behavior, not signature):** all (backstop); `getMyTeamState`,
  `refreshLeaderboard`, `finalizeRun` most directly.
- **Tests:** pure-logic (`scripts/test-sanitize-finite.ts`) for the helper; co-located vitest for
  `buildRankings` with an unstarted team; an e2e assertion that a run containing a joined-but-not-
  started team returns a finite leaderboard + team state.

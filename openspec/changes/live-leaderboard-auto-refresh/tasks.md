# Tasks: live-leaderboard-auto-refresh

## 1. Throttle helper (pure logic — RED → GREEN)

- [x] 1.1 RED: create `functions/src/runs/leaderboardThrottle.test.ts` (vitest) asserting
      `shouldRefreshLeaderboard`: undefined/garbage `lastUpdatedAt` → true; stale (older than
      interval) → true; fresh → false; boundary at exactly `minIntervalMs` → true. Run
      `npx vitest run leaderboardThrottle` in functions/ and confirm it fails (module missing).
- [x] 1.2 GREEN: implement `functions/src/runs/leaderboardThrottle.ts`
      (`LEADERBOARD_REFRESH_MIN_MS = 20_000`, `shouldRefreshLeaderboard(lastUpdatedAt, nowMs,
      minIntervalMs?)`). Confirm the vitest file passes.

## 2. Server auto-refresh (e2e RED → GREEN)

- [x] 2.1 RED: extend `scripts/e2e-verify.mjs` lifecycle scenario with failing assertions:
      (a) after a task completion with NO manual refresh, the run doc's `leaderboard.rankings`
      contains the completing team with its updated score and a fresh `updatedAt`;
      (b) `adjustTeamScore({delta:-50})` → run doc `leaderboard` shows that team's score reduced
      by 50 AND the next `listRunTeams` row includes `bonusPenalty` with the delta;
      (c) freeze via `refreshLeaderboard({frozen:true})`, complete another task, assert the
      snapshot rankings are byte-identical (frozen board never auto-overwritten);
      (d) `published` flag unchanged by an auto-refresh.
      Run `npm run e2e` and confirm these specific assertions fail.
- [x] 2.2 GREEN: implement internal `maybeRefreshLeaderboardSnapshot(ownerUid, gameId, runId,
      {force?})` in `functions/src/runs/index.ts` (best-effort try/catch; re-reads run doc;
      skips when `leaderboard.frozen`; skips when `!force` and `shouldRefreshLeaderboard` says
      fresh; recomputes via `buildRankings`; `update()`s `run.leaderboard` preserving
      `published`/`frozen`). Do NOT re-export it from `functions/src/index.ts`.
- [x] 2.3 GREEN: call it from the three sites — `completeTaskForTeam` epilogue (after slot
      release, only when `didComplete`, throttled), `adjustTeamScore` (after audit log,
      `force:true`), `skipStage` (after transaction, `force:true`). Add `bonusPenalty:
      t.bonusPenalty ?? 0` to the `listRunTeams` row. Re-run `npm run e2e` until the 2.1
      assertions pass and the whole suite (incl. leaderboard invariant oracle + coverage guard
      66/66) is green.

## 3. Creator console UI

- [x] 3.1 Add `bonusPenalty` to the `RunTeamRow` type in
      `apps/creator-web/src/services/calls.ts`; render the effective score
      (`score - bonusPenalty`) in the RunConsole teams table (show the raw earned score +
      adjustment only if a distinct label is needed — any new text via `t.*` in both HE/EN
      dictionaries in `apps/creator-web/src/i18n.ts`).
- [x] 3.2 Make the "TV Screen" and "public leaderboard" copy actions publish first: when
      `run.leaderboard?.published` is falsy, `await refreshLeaderboard({...ctx, publish:true})`
      before copying/opening the URL.
- [x] 3.3 Preview-verify: with the emulator playtest data, confirm the teams table shows the
      −50-adjusted effective score and that copying the TV link flips the board to published
      (TV screen renders standings on next poll).

## 4. Refactor + gates

- [x] 4.1 REFACTOR (evaluated: refreshLeaderboard keeps its explicit publish/frozen semantics + return value; the ~8 shared lines do not justify a forced abstraction - no change): dedupe the snapshot-write shape between `refreshLeaderboard` and
      `maybeRefreshLeaderboardSnapshot` if duplication emerged (single write-shape helper);
      re-run vitest + e2e.
- [x] 4.2 Full gate set — `npm run typecheck` · `npm run lint` · `npm test` ·
      `npm run creator:build` · `npm run play:build` · `npm run e2e` · `npm run i18n:check`
      (UI touched; zero new PART B findings — spot-check with `npm run i18n:check:strict`).
      All green.

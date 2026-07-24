## 1. RED — e2e scenario first (authoritative gate)

- [x] 1.1 In `scripts/e2e-verify.mjs`, add a scenario `solo instant-play finish auto-produces a
      published leaderboard`: an anonymous party calls `startInstantPlay({ gameId })` on a public,
      instant-play-enabled game, drives its single team through every stage to `status:'finished'`
      via the normal grading callables, then `check(...)`s that the run doc has
      `leaderboard.published === true`, `leaderboard.frozen === true`, exactly one ranking with
      `rank === 1`, and that `getMyTeamState` returns a non-null `run.leaderboard`. Poll briefly for
      the write (mirror the `onRunFinalized` probe pattern at `e2e-verify.mjs:1168-1197`).
- [x] 1.2 In the same scenario (or the core lifecycle), add the regression assertion: after every
      team of a launched (non-self-guided) run reaches `status:'finished'`, `run.leaderboard` is
      STILL null until the organizer calls `finalizeRun`.
- [ ] 1.3 Run `npm run e2e` and confirm the new solo assertion FAILS (no leaderboard yet) — RED.
      **(UNVERIFIED — implementer runs this; not runnable in the authoring lane.)**

## 2. GREEN — factor the finalize core

- [x] 2.1 In `functions/src/runs/index.ts`, extract `finalizeRun`'s read+`buildRankings`+`runRef.update`
      body into an internal `finalizeRunCore(ownerUid, gameId, runId, opts?: { forcePublish?: boolean })`.
      It reads the run doc first and returns early (no write) when `run.status === 'finished'`;
      otherwise it performs the identical write, with `published = opts?.forcePublish ? true :
      !game.manualLeaderboardReveal`.
- [x] 2.2 Rewrite `finalizeRun` (the callable) to keep `requireAuth` + the `run.ownerUid !== uid`
      ownership check and delegate the write to `finalizeRunCore(uid, gameId, runId)` (no forcePublish).
      Its return shape `{ rankings }` is unchanged.

## 3. GREEN — the solo-only auto-finalize

- [x] 3.1 Add `maybeAutoFinalizeSoloRun(ownerUid, gameId, runId)`: bail unless `run.selfGuided === true`
      AND `(run.participantCount ?? 1) <= 1` AND `run.status !== 'finished'`; read the teams collection
      and bail unless there is exactly one team whose `status === 'finished'`; then call
      `finalizeRunCore(ownerUid, gameId, runId, { forcePublish: true })`.
- [x] 3.2 In `completeTaskForTeam`, immediately before `return result` (`:1121`), add the best-effort
      call gated on the in-scope `runData`:
      `if (result.completed && runData?.selfGuided === true && (runData?.participantCount ?? 1) <= 1) { await maybeAutoFinalizeSoloRun(...).catch((e) => logBestEffort('autoFinalizeSolo', {...}, e)); }`.

## 4. Verify

- [ ] 4.1 `npm run e2e` — the solo scenario now PASSES (published board, rank #1, badges recorded via
      `onRunFinalized`), and the normal-organizer-run regression assertion PASSES (still waits for
      manual finalize). **(UNVERIFIED — implementer runs this.)**
- [ ] 4.2 `npm run verify` (typecheck · lint · test · builds · bundle:budget · i18n:check:strict) —
      green. `npm run verify:emulator` — green. **(UNVERIFIED — implementer runs these.)**
- [x] 4.3 Confirm no new callable was introduced, so the e2e callable-coverage guard needs no new
      entry.

## 5. REFACTOR

- [x] 5.1 Confirm `buildRankings` is the single scoring source for both `finalizeRun` and the auto
      path (no duplicated ranking logic), and that the frozen/published write matches finalizeRun's
      byte-for-byte except the `published` override.

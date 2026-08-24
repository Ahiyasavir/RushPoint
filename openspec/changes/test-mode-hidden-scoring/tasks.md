## 1. Shared foundation (pure logic, RED first)

- [x] 1.1 RED — create `scripts/test-test-mode.ts` with failing assertions for
  `sealsScoreFromParticipant`: `true` only for `testMode === true`; `false` for absent, `false`,
  `null`, a string, and a `Game` predating the field; never throws. Run `npx tsx
  scripts/test-test-mode.ts` and confirm it fails because the module does not exist.
- [x] 1.2 GREEN — add `Game.testMode?: boolean` to `packages/shared/src/types/index.ts` and create
  `packages/shared/src/testMode.ts` exporting `sealsScoreFromParticipant`. Export from the barrel.
  Confirm 1.1 passes.
- [x] 1.3 RED — extend `scripts/test-test-mode.ts` with failing assertions for
  `sanitizeTeamForParticipant(team, sealed)`: exact key-set equality in both modes; `score`,
  `bonusPenalty`, `smartStreak`, `streakMultiplier` and per-record `earnedScore`/`scoreBreakdown`
  absent when sealed and present when not; `submittedAnswer`/`wasCorrect` absent in **both** modes;
  a team with unknown extra fields yields no extra keys (allow-list by construction, not a
  delete-list); never throws on a malformed team.
- [x] 1.4 GREEN — implement `sanitizeTeamForParticipant` in `packages/shared/src/testMode.ts` as an
  allow-list built by construction. Confirm 1.3 passes.
- [x] 1.5 RED — extend `scripts/test-test-mode.ts` with failing assertions for
  `accuracySkillRatio(records)`: all-correct → `-1`; all-wrong → `+1`; even split → `0`; no
  answered records → `null`; records with a missing/non-boolean `wasCorrect` are excluded, and an
  all-excluded sample returns `null`; result always finite and within `[-1, 1]`.
- [x] 1.6 GREEN — implement `accuracySkillRatio` in `packages/shared/src/testMode.ts`. Confirm 1.5
  passes. Run `npm test` to confirm the aggregator picked the new file up.

## 2. Recorded submissions (data shape)

- [x] 2.1 Add `submittedAnswer?: string` and `wasCorrect?: boolean` to `RunTaskRecord` in
  `packages/shared/src/types/index.ts`, documenting that both are server-written, owner-only, and
  never present in a participant payload.
- [x] 2.2 RED — add a failing assertion to `scripts/test-test-mode.ts` that a bounded-length helper
  clamps a stored answer to the same 500-char ceiling `surveyResponse` uses, and handles a
  non-string input without throwing.
- [x] 2.3 GREEN — implement the bound and confirm 2.2 passes.

## 3. Callable behaviour — `submitTaskAnswer` (RED via e2e)

- [x] 3.1 RED — add a `test mode` scenario to `scripts/e2e-verify.mjs`: create a game with
  `testMode: true` and a quiz task carrying `smart.attemptLimit` and a `hintPenalty`, launch, join,
  start. Assert a **wrong** answer returns a response with **no** `correct`, `penalty`,
  `attemptsUsed`, `cooldownUntil` or `retryAfterMs` key; the task reaches `completed` with
  `earnedScore: 0`; a next task is assigned. Run `npm run e2e` and confirm this scenario fails.
- [x] 3.2 GREEN — in `functions/src/runs/index.ts`, branch `submitTaskAnswer` on
  `sealsScoreFromParticipant(game)` **before** the pre-grade gates: skip the attempt limit, replay
  guard and retry cooldown; still grade; fall through to `completeTaskForTeam` +
  `assignNextInActiveStage` on both outcomes; return `{ recorded: true, nextTaskId }` with
  `correct` omitted. Confirm 3.1 passes.
- [x] 3.3 RED — extend the scenario: assert repeated wrong answers never yield
  `resource-exhausted`, no cooldown is ever started, and `requestTaskHint` on a task with
  `hintPenalty` deducts nothing. Confirm it fails.
- [x] 3.4 GREEN — suppress the hint charge in `requestTaskHint` when the game seals scoring.
  Confirm 3.3 passes.
- [x] 3.5 RED — extend the scenario: assert the task record carries `submittedAnswer` and
  `wasCorrect` when read **as the owner**, and that a non-test game records neither. Confirm it
  fails.
- [x] 3.6 GREEN — write both fields inside the existing scoring transaction, only when the game
  seals scoring, using the bound from 2.3. Confirm 3.5 passes.

## 4. Payload sealing — `getMyTeamState`

- [x] 4.1 RED — extend the e2e scenario: assert the participant payload contains no `score`,
  `bonusPenalty`, `smartStreak`, `streakMultiplier`, `earnedScore`, `scoreBreakdown`, `answerCost`,
  `leaderboard`, `submittedAnswer` or `wasCorrect` — searched recursively, so a nested record cannot
  hide one. Assert `wasCorrect`/`submittedAnswer` are absent for a **non**-test game too. Confirm it
  fails.
- [x] 4.2 GREEN — apply `sanitizeTeamForParticipant` to the returned team in `getMyTeamState`, force
  `run.leaderboard` to `null` when sealed, skip the `answerCost` block, and ship
  `game.testMode` so the client can render sealed UI. Confirm 4.1 passes.
- [x] 4.3 RED — assert an unchanged (non-test) run's payload still carries score, breakdown and a
  published leaderboard exactly as before. Confirm it passes without new code (regression pin).
- [x] 4.4 Add the new field names to `ALLOWED_TASK_KEYS` / `ALLOWED_SMART_KEYS` in
  `scripts/e2e-verify.mjs` as required, and confirm the sanitizer allowlist guard is green.
- [x] 4.5 RED — assert the **owner** path is untouched: `listRunTeams`, `getRunAnalytics`,
  `getRunSummary` and `getRunRecap` on the test-mode run still return full scores and standings.

## 5. Routing — accuracy replaces pace

- [x] 5.1 RED — add failing assertions (new `scripts/test-test-mode-routing.ts`, or extend the
  existing routing lane) that given identical candidates differing only in `difficulty`, a
  low-accuracy team is offered a lower-difficulty task and a high-accuracy team a higher-difficulty
  one; a team with no answered records behaves neutrally; and for a **non**-sealed game the
  candidate ordering is byte-identical to today.
- [x] 5.2 GREEN — in `functions/src/routing/assignNextTask.ts`, use `accuracySkillRatio` in place of
  `computeSkillRatio` when the game seals scoring, falling back to the current value when it returns
  `null`. Leave `computeSkillRatio` and `adaptiveDifficultyMatch` untouched. Confirm 5.1 passes.

## 6. Creator UI — the setting

- [x] 6.1 Add the **Test mode** switch to the creator's game settings, with help copy covering the
  three real caveats: scoring still runs and stays visible to you; turning it on mid-run seals a
  live run; adaptive difficulty only varies if tasks carry authored `difficulty` values.
- [x] 6.2 Add `testMode` to `BUILDER_EDITABLE_FIELDS` in `apps/creator-web/src/lib/savePayload.ts`
  and confirm `scripts/test-game-presentation.ts` passes — without this the control silently never
  saves and never registers as a change.
- [x] 6.3 Accept and persist `testMode` in `updateGame` (and carry it through `duplicateGame`,
  `importGameFile` / `exportGameFile`) in `functions/src/games/index.ts`.
- [x] 6.4 Add the new creator copy to **both** the Hebrew and English dictionaries in
  `apps/creator-web/src/i18n.ts`.

## 7. Participant UI — sealed surfaces

- [x] 7.1 Hide the score counter in the `PlayScreen` header when the game seals scoring.
- [x] 7.2 In `TaskRunner`, suppress the right/wrong toast, the success confetti and haptics, the
  `answerCost` warning and the retry-lockout UI; show a neutral "answer recorded" acknowledgement
  instead, reusing the receipt pattern already added for choice quizzes.
- [x] 7.3 Suppress the `LiveOps` leaderboard peek.
- [x] 7.4 Render the neutral completion state in `FinalScreen` (no score, rank, leaderboard or share
  card) and suppress `CeremonyScreen`, `TvLeaderboard`, `RunRecap` standings and the
  `storyCard` / `podiumCard` share images for a sealed run.
- [x] 7.5 Seal the public leaderboard route: `getPublicLeaderboard` refuses a sealed run's board
  even when published, and `PublicLeaderboardScreen` renders the refusal cleanly. Add an e2e
  assertion for the refusal.
- [x] 7.6 Add the new participant copy to **both** dictionaries in `apps/play-web/src/i18n.ts`.

## 8. Verification

- [x] 8.1 Verify both apps through the preview tools: the setting saves and round-trips; a
  test-mode run shows no score header, no right/wrong feedback, no leaderboard peek, and a neutral
  finish; a normal run is visibly unchanged.
- [x] 8.2 Run `npm run i18n:check:strict` and confirm it is clean with **zero** new PART B findings.
- [x] 8.3 Run the full gauntlet — `npm run verify` (typecheck · lint · test · creator:build ·
  play:build · bundle:budget · base:check · origin:check · i18n:check:strict) — and confirm all
  green.
- [x] 8.4 Run `npm run e2e` and confirm every scenario passes, including the callable-coverage
  guard.
- [x] 8.5 Open Questions resolved as built: (1) the public board IS sealed for a test-mode run even
  after finalize (`getPublicLeaderboard` forces `published` false), asserted in e2e; (2) staff-facing
  skip awards were left unchanged — they are a staff surface and never reach the participant.
  THREE leaks not in the original design were found during browser verification and fixed: the hint
  button still advertised its point cost, the attempt-limit confirmation still warned about spending
  a wrong answer, and a wrong answer banked FULL points (making the creator's score column read
  "questions attempted"). All three are now covered by assertions.

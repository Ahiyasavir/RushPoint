# Wave J — Creator-authoring integrity hardening (implementation)

Fix a broken game at the authoring SOURCE so it can never be saved / published /
launched into a dead-end or a poisoned leaderboard. Findings: `docs/wave-j/creator-authoring.md`
(J2–J7) + `docs/wave-i/per-task-scoring-audit.md` (B1/J4).

Owned files: `functions/src/games/index.ts`, `packages/shared/src/{validation,scoringPresets,importSheet}.ts`
(+ tests), `scripts/e2e-verify.mjs`, new `scripts/test-*.ts`.
NOT touched: `functions/src/runs/index.ts`, `packages/shared/src/geo.ts` (other agent),
`functions/src/index.ts`, `apps/**`.

## What & why (per finding)

1. **publishGame validated nothing (J2)** — an empty / 0-task-stage / unwinnable-task
   game could be indexed into `publicGames`/`publicTasks` and (with instant-play)
   played into a dead-end. Fix: run the same structural winnability guard launchRun
   runs, in the `visibility === 'public'` branch, BEFORE indexing. Reject with
   `failed-precondition` (matches launchRun's sibling style).

2. **updateGame accepted a 0-task stage (J3)** — its validation loop iterated tasks,
   so an empty-task stage produced no error and persisted. Fix: reject an empty-task
   stage at save.

3. **Negative pointValue / difficulty (B1 / J4)** —
   - `scoringPresets.ts` `taskScoreFixed` (~:84) and `skipAward` fixed branch (~:215)
     guarded NaN but not negativity; a `pointValue:-50` *subtracted* from the team
     total. Clamp both with `Math.max(0, …)`.
   - Also reject a negative `pointValue` / `difficulty` / `estimatedMinutes` at the
     authoring source (updateGame) so the broken value never persists. (createGame
     takes no tasks — `stages: []` — so nothing to validate there.)

4. **Import accepted uncompletable rows (J5)** — `parseGameRows` only set answer keys
   for `quiz`/`numeric`; a `smart_station` row (no secretCode column) and a `sequence`
   row (no steps column) imported as permanently uncompletable with no `RowError`.
   Fix: emit a `RowError` for both, mirroring the runtime completability rule.

5. **Authored title/description bypassed the bidi/control/zero-width strip (J6)** —
   `stripUnsafeDisplayChars` (wave-h H3) is applied to station-callable strings via
   `requireString` but NOT to authored game/stage/task title+description. Fix: run
   them through the shared strip in createGame + updateGame (and importSheet).

6. **translateGame carried the webhook secret + publish/instant-play state (J7)** —
   `duplicateGame` strips `integrationWebhookUrl`/`integrationPlatform` and resets
   `allowInstantPlay`; `translateGame` spread `...newGame` and carried them. Fix:
   mirror duplicateGame — strip the webhook fields, force `allowInstantPlay:false`,
   keep `visibility:'private'`.

## Design

- New shared pure helper `gameStructureProblems(stages)` in `validation.ts`:
  empty-task stage + `taskCompletabilityError(task)` + negative pointValue/difficulty/
  estimatedMinutes → `string[]`. This is the single SOURCE reused by `updateGame`
  (save) and `publishGame` (gallery); it mirrors launchRun's inline launch-time guard
  (which stays as defense-in-depth — not touched, different agent owns runs).
  Imports `taskCompletabilityError` from `./taskCompletability` (read-only import; no
  cycle — taskCompletability does not import validation).
- `updateGame`: `problems.push(...gameStructureProblems(stages))` replaces the inline
  per-task completability push; the empty-stage + negative checks come from the helper.
  Existing unlock-graph / availability-window / ordering / survey checks stay.
- `publishGame`: reject `game.stages.length === 0` (empty game) + `gameStructureProblems`
  → `failed-precondition` before batching the index.
- Title/description strip: `stripUnsafeDisplayChars(...).trim()` in createGame; a new
  local `sanitizeStagesText(stages)` composed with `normalizeStagesMedia` in updateGame;
  `stripUnsafeDisplayChars` on title/description in `parseGameRows`.

## TDD (RED → GREEN)

Pure (no emulator), import SOURCE:
- `scripts/test-authoring-hardening.ts` (new):
  - `taskScoreFixed({pointValue:-50}) === 0` and `skipAward('fixed_points_speed',{pointValue:-50,…}) === 0` (negative clamp) — RED before the Math.max.
  - `gameStructureProblems`: 0-task stage → problem; uncompletable quiz → problem;
    negative pointValue/difficulty → problem; a valid game → []. RED before the helper exists (import undefined).
  - `stripUnsafeDisplayChars` strips RLO/zero-width, keeps Hebrew + LRM/RLM (SOURCE of the create/update strip).
- `scripts/test-import-sheet.ts` (extend): `smart_station` row → RowError; `sequence`
  row → RowError; neither imported. RED before the parser rejects them.

## e2e — STAGED for parent (coordination: another agent is mid-editing e2e-verify.mjs)

Add to a scenario (do NOT let me two-writer-collide the file):
- publishGame rejects a 0-task-stage game (`failed-precondition`); rejects an empty game.
- updateGame rejects a 0-task-stage game; rejects a negative-pointValue task.
- translateGame output has no `integrationWebhookUrl` and `allowInstantPlay:false` even
  when the source had a webhook + instant-play.
- (import row rejection is covered by the pure lane.)

translate-strip is a callable, not a pure export → verified via the e2e assertion above
(not unit-testable in the pure lane).

## Gates

`npm run shared:build && npm run build --workspace=functions` → `npm run typecheck` →
`npm test`. e2e staged for parent (or run if the emulator/shared-build is free).

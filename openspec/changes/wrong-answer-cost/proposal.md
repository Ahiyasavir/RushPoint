## Why

A wrong answer in RushPoint costs a team **nothing**. `submitTaskAnswer`'s `if (!correct)` branch
(`functions/src/runs/index.ts:3367-3381`) increments `taskAttempts[taskId]` and returns
`{ correct: false }`. It does not touch `score`, it does not touch `bonusPenalty`, and it does not
even record the attempt unless the task happens to carry `smart.attemptLimit > 0` or
`hintAutoRevealAttempts > 0`.

On a four choice quiz that makes brute force **strictly optimal play**: tap every option, one of
them completes the task for full points, and the team that actually knew the answer scores exactly
the same as the team that guessed. Every quiz, numeric and ordering task in the product is
therefore a formality rather than a question. The only existing counter-measure,
`smart.attemptLimit`, is a cliff (unlimited, then a hard `resource-exhausted` lock), which is why
almost nobody sets it: on a kids' hunt it turns a typo into a dead end.

## What Changes

**A wrong answer starts costing something, and the creator chooses how much.**

- A new game-level knob, `Game.scoringOptions.wrongAnswerPenalty`, with four strictness levels:
  `off` · `gentle` · `standard` · `strict`. A per-task override
  (`Task.wrongAnswerPenalty`) resolves against it, so one brutal final riddle can be stricter than
  the warm-up.
- **Existing games are not changed.** An absent knob resolves to `off`, which is byte-for-byte
  today's behaviour. New games are created at `standard`. No run in flight changes its rules.
- **The cost escalates instead of taxing flatly.** Each level grants N free wrong attempts (a typo
  or a misread is forgiven), then the cost rises with each further wrong answer, and the **total
  points a single task can ever take off one team is capped**. A team can never be spiralled into
  oblivion by one question.
- **Two currencies, chosen by scoring preset.** The primary penalty is a short **retry cooldown**:
  it costs real race time, works under every preset, and can never produce a negative score.
  Under `fixed_points_speed` and `smart_weighted` a **point cost** is charged alongside it, through
  the existing `team.bonusPenalty` channel. Under `time_only` — which has no points at all — the
  cooldown is the entire penalty.
- **The participant is told the rule before they answer**, and told what a wrong answer just cost
  them, with a visible countdown while the retry is cooling down. A cost nobody was warned about is
  not a game mechanic, it is a bug.
- **Infrastructure is never punished.** A duplicate submission of the same answer (network retry,
  double tap, offline replay) is an idempotent replay: no second charge, no second cooldown, no
  second attempt recorded.

**Callables:** `submitTaskAnswer` changes its behaviour and its response shape (it gains
`penalty`, `cooldownUntil`, `attemptsUsed`, `replay`). No new callable is added.

## Non-goals

- **No change to `buildRankings`.** The penalty rides `team.bonusPenalty`, the same channel hints
  and manual adjustments already use, so live and final standings cannot drift.
- **No change to `smart.attemptLimit`.** The hard lock keeps its exact current semantics; this
  change is the soft gradient in front of it.
- **No change to `hintAutoRevealAttempts`.** It keeps reading the same `taskAttempts[taskId]`
  counter.
- **No penalty on any other task type.** `field`, `photo`, `geofence`, `smart_station`,
  `sequence` and `survey` submissions are untouched. This change covers only the callable that
  grades a typed/chosen answer, `submitTaskAnswer` (quiz / numeric / ordering).
- **No retroactive migration.** Nothing rewrites an existing game document.
- **No Builder editor for the per-task override** in this change. The field is honoured by the
  server and the resolver; only the game-level selector ships in the Builder UI.

## Capabilities

### New Capabilities
- `wrong-answer-cost`: A creator-configurable, escalating, capped cost for a wrong answer on a
  graded task, expressed as a retry cooldown plus (under point-bearing scoring presets) a point
  charge on `bonusPenalty`, announced to the participant before they answer, and idempotent under
  duplicate submission.

### Modified Capabilities
<!-- none: `answer-submission`'s attempt-limit requirement is unchanged. The cooldown gate is
     evaluated after it, so a locked task still fails with `resource-exhausted` and a
     cooldown-blocked submission still consumes no attempt. -->

## Impact

- **Surfaces touched:** `packages/shared` (types + new pure module) · `functions/`
  (`runs/index.ts` only) · `apps/play-web` (participant UI + typed wrapper + i18n) ·
  `apps/creator-web` (one Builder selector + i18n). **No Firestore rules change, no new index, no
  new env var.**
- **Files:** `packages/shared/src/wrongAnswerPenalty.ts` (new), `packages/shared/src/index.ts`,
  `packages/shared/src/types/index.ts`, `functions/src/runs/index.ts`,
  `apps/play-web/src/services/calls.ts`, `apps/play-web/src/components/TaskRunner.tsx`,
  `apps/play-web/src/i18n.ts`, `apps/creator-web/src/pages/BuilderPage.tsx`,
  `apps/creator-web/src/i18n.ts`, `scripts/e2e-verify.mjs`.
- **New persisted state:** `RunTeam.answerPenalties[taskId]` (a real nested map, never a dotted
  key) recording points already charged, the last wrong answer's hash and the cooldown expiry.
  `RunTeam.taskAttempts` becomes a declared field instead of an inline cast.
- **Allowlist:** the sanitizer's `...rest` passthrough means the new `Task.wrongAnswerPenalty`
  field and the server-computed `answerCost` display object reach the participant, so
  `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs` must gain both or the allowlist scenario fails
  loud. Neither carries any part of an answer key.
- **Risk:** a cooldown can refuse a *correct* answer for up to the level's cap. That is deliberate
  (grading first would make the cooldown worthless as a brute-force deterrent) and is bounded:
  every level caps the wait, and the free attempts mean a team's first wrong answer never blocks
  them at all.
- **Testing:** the cost curve, the cap, the preset gate and the cooldown remainder are pure
  functions in `packages/shared`, covered by a `scripts/test-*.ts` boundary script and by seeded
  property tests in the existing `functions/src/__property__` lane. Callable behaviour is covered
  by a new `scripts/e2e-verify.mjs` scenario. UI is verified via preview plus `npm run i18n:check`.

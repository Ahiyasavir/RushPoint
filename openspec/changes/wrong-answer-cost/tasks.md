## 1. RED: pin the cost curve as pure logic

- [x] 1.1 Write `scripts/test-wrong-answer-penalty.ts` against the not-yet-existing
  `packages/shared/src/wrongAnswerPenalty.ts`: `resolveWrongAnswerLevel` precedence
  (task > game > `off`), the exact `standard` point sequence 0/10/20/30/0/0, the cumulative cap at
  60, the cooldown sequence 0/15/30/45 rising to the 90 s ceiling, `gentle` and `strict` boundary
  rows, `off` returning zeroes, `time_only` zeroing points while preserving the cooldown,
  `cooldownRemainingSeconds` at/before/after expiry and with a missing value, and
  `hashAnswerForReplay` stability across case and surrounding whitespace. Run it; confirm it fails
  because the module does not exist.

## 2. GREEN: the shared cost module

- [x] 2.1 Add `WrongAnswerLevel`, `ScoringOptions.wrongAnswerPenalty`, `Task.wrongAnswerPenalty`,
  `RunTeam.taskAttempts` and `RunTeam.answerPenalties` to `packages/shared/src/types/index.ts`,
  with comments naming this change and stating that absent means `off`.
- [x] 2.2 Write `packages/shared/src/wrongAnswerPenalty.ts` (level table,
  `resolveWrongAnswerLevel`, `wrongAnswerCost`, `cooldownRemainingSeconds`, `hashAnswerForReplay`)
  and export it from `packages/shared/src/index.ts`. Guard every input for finiteness the way
  `taskScoreSmart` does. Re-run 1.1; confirm green.

## 3. RED: seeded property invariants

- [x] 3.1 Append a `describe('wrongAnswerCost — penalty invariants')` block to
  `functions/src/__property__/invariants.property.test.ts` in the existing house style (local
  seeded LCG, `N` samples): for any level × preset × attempt index × already-charged, including
  `NaN` / `Infinity` / negative / non-integer inputs, assert points finite and `≥ 0`; cooldown
  finite, `≥ 0` and `≤ maxCooldownSeconds`; `charged + points ≤ maxPoints`; cumulative points
  non-decreasing in attempt index; cooldown non-decreasing in attempt index; points exactly 0 under
  `time_only` and under level `off`. Run vitest; fix the module until green (no test weakening).

## 4. GREEN: charge the wrong answer server-side

- [x] 4.1 In `submitTaskAnswer` (`functions/src/runs/index.ts`), resolve the level from the game +
  task, read the team doc once, and keep the existing `attemptLimitReached` check first and
  unchanged.
- [x] 4.2 Add the replay check (hash equals `answerPenalties[taskId].lastHash`) before grading:
  return the stored wrong verdict, record nothing, charge nothing.
- [x] 4.3 Add the cooldown gate before grading: `failed-precondition` with `retryAfterSeconds`,
  no attempt recorded, no charge, bypassed when the run is a test drive (read the run doc only on
  the would-block path).
- [x] 4.4 In the wrong branch, run one team-doc transaction that increments `taskAttempts[taskId]`,
  adds the capped point charge to `bonusPenalty` and writes
  `answerPenalties[taskId] = { charged, lastHash, cooldownUntil }` as a real nested object. Widen
  the existing `trackAttempts` condition to include "a cost level is active" so
  `hintAutoRevealAttempts` keeps working. Return `{ correct: false, penalty, cooldownUntil,
  attemptsUsed, replay }`. Do NOT touch `buildRankings` and do NOT touch the correct-answer path.
- [x] 4.5 In `getMyTeamState`, next to the existing `hintFreeNow` decoration, attach the
  display-only `answerCost` object to the team's active graded task. Omit it entirely when the
  resolved level is `off`.

## 5. Client wiring

- [x] 5.1 Extend `apps/play-web/src/services/calls.ts`: `submitTaskAnswer`'s response type and
  `SafeTask.answerCost`.
- [x] 5.2 `apps/play-web/src/components/TaskRunner.tsx` (touch minimally, another lane owns this
  file): a pre-answer line stating what a wrong answer costs, a post-answer line stating what it
  just cost, and a countdown that disables the submit control until the cooldown expires. Render
  nothing when `answerCost` is absent.
- [x] 5.3 `apps/play-web/src/i18n.ts`: add every new string to BOTH `he` and `en`. Real Hebrew in
  `he`, no dash separators, point costs with the true minus sign U+2212.
- [x] 5.4 `apps/creator-web/src/pages/BuilderPage.tsx`: a four-option selector inside the existing
  `advScoring` `Advanced` section, and seed `standard` on new games. `apps/creator-web/src/i18n.ts`:
  the level names + one explanatory line per level, in both dictionaries.

## 6. e2e assertions (written, not run in this lane)

- [x] 6.1 Add a "wrong answers cost" scenario to `scripts/e2e-verify.mjs`: escalation 0/10/20 on
  `bonusPenalty`, the cap after the 4th wrong answer, the cooldown refusing the next submission
  with `failed-precondition` and leaving `taskAttempts` unchanged, a duplicate identical wrong
  submission not double-charging, a correct answer after the cooldown completing and routing, a
  `time_only` game charging no points but still cooling down, a legacy game (no knob) unchanged,
  and the leaderboard invariant oracle plus live/final parity still passing with a charged team.
- [x] 6.2 Add `wrongAnswerPenalty` and `answerCost` to `ALLOWED_TASK_KEYS`, each with the comment
  explaining why it is participant-safe.

## 7. Gates

- [x] 7.1 Run the scoped gates for this lane: `npx tsx scripts/test-wrong-answer-penalty.ts`, the
  functions vitest lane, a scoped `tsc`, and `npm run i18n:check` (plus
  `npm run i18n:check:strict` for the new strings). Confirm clean.
- [ ] 7.2 Full gate set (`npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build`
  · `npm run play:build` · `npm run e2e` · `npm run i18n:check`) is run by the parent agent once,
  at the end. The e2e assertions from 6.1 are UNVERIFIED until that run.

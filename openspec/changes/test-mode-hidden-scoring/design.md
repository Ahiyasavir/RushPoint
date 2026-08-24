## Context

`getMyTeamState` (`functions/src/runs/index.ts`) returns the participant's team document
**whole** — `return { team, ... }`. Every field on `RunTeam` and on each nested `RunTaskRecord`
therefore reaches the device today: `score`, per-task `earnedScore`, `scoreBreakdown`,
`smartStreak`, `streakMultiplier`, `taskAttempts`, `answerPenalties`. The task *content* is
carefully sanitized (`sanitizeTaskForParticipant` builds an allow-listed object by construction),
but the team *progress* is not — it is spread raw.

That asymmetry is the central constraint of this change, and it cuts twice:

1. Sealing scores means **projecting the team document**, not editing screens. Hiding these values
   in play-web would leave them sitting in the callable response, readable in devtools — the exact
   failure `manualLeaderboardReveal` already had to fix at the source (`run.leaderboard` is nulled
   server-side unless `published`).
2. This change **adds fields to `RunTaskRecord`** (the recorded submission and its correctness).
   Because `team` is spread raw, those new fields would ship to the participant automatically. A
   `wasCorrect` boolean on the wire defeats the entire feature. This is the payload-omission
   regression class the repo has been bitten by before, and it is the highest-risk part of the work.

Two further pieces of current behaviour matter. `submitTaskAnswer` runs three pre-grade gates
(attempt limit → replay guard → retry cooldown) before it grades, and on a wrong answer it returns
early with `{correct: false, penalty, retryAfterMs, …}` without completing the task. And routing's
`adaptiveDifficultyMatch(skillRatio, difficulty)` (`functions/src/routing/assignNextTask.ts:69`)
already runs for every scoring preset, where `skillRatio` comes from `computeSkillRatio` and is
derived purely from elapsed time versus `estimatedMinutes`.

## Goals / Non-Goals

**Goals:**
- A game-level `testMode` flag that makes the run's participant payload carry no score and no
  correctness signal — enforced server-side.
- Every answer advances; no lockouts, wrong-answer charges, or hint costs on a test-mode run.
- A struggling participant is routed toward easier questions.
- Each submission is recorded server-side so the creator can grade after the run.
- Creator, staff and analytics behaviour is bit-for-bit unchanged.

**Non-Goals:**
- A creator UI for reviewing submissions (stored and owner-readable, but no screen).
- A per-run override; proctoring or identity verification; retroactive backfill.
- Any relaxation of answer-key secrecy.

## Decisions

### 1. One shared predicate decides what a run seals — `packages/shared/src/testMode.ts`

`sealsScoreFromParticipant(game)` is the single source of truth, imported by functions, creator-web
and play-web. The alternative — each surface checking `game.testMode !== true` inline — is how the
two apps drift, and there are eleven participant surfaces to keep in step. Pure, total, and
defaults to "not sealed" for a `Game` that predates the field, so every existing game is unaffected.

### 2. Seal by projecting the team, not by editing screens — `sanitizeTeamForParticipant`

A new pure projection in `packages/shared/src/testMode.ts`, applied in `getMyTeamState` before the
team is returned. It is an **allow-list built by construction**, mirroring
`sanitizeTaskForParticipant`, not a delete-list. A delete-list has the property that every future
field is exposed by default — precisely the trap described in Context. With an allow-list, a field
added later is absent until someone deliberately adds it.

Sealed when `testMode` is on: `score`, `bonusPenalty`, `smartStreak`, `streakMultiplier`, and per
record `earnedScore`, `scoreBreakdown`. Sealed **unconditionally** (in every game, test mode or
not): the two new submission fields, since a stored `wasCorrect` has no participant use ever.
`run.leaderboard` is forced to `null` alongside the existing `published` gate, and the `answerCost`
block is skipped.

The play UI still hides its score chrome — but as presentation, not as the security boundary. The
server is the boundary.

### 3. Test mode branches *before* the pre-grade gates in `submitTaskAnswer`

The attempt limit, replay guard and retry cooldown all exist to make a wrong answer *expensive*.
In test mode a wrong answer is free and final, so the whole block is skipped rather than
neutralised piecemeal — fewer interacting conditions, and no path where a lockout written by an
earlier non-test run still bites.

The grade is still computed (the creator needs it) and then routed differently: instead of
returning early on `correct: false`, both branches fall through to `completeTaskForTeam` +
`assignNextInActiveStage`. The response becomes `{ recorded: true, nextTaskId }` — `correct` is
**omitted entirely**, not set to `true`. Sending `correct: true` for a wrong answer would be a lie
on the wire that some future client could surface; an absent field cannot be misread.

Scoring is unchanged underneath: a wrong answer completes with `earnedScore: 0`, which the existing
score/ranking path already handles for skipped tasks.

*Alternative rejected:* leaving the gates in place and suppressing only the UI. It would leave a
player silently locked out for 30 seconds with no explanation — a stuck player with no signal,
which is worse than the bug this change is meant to prevent.

### 4. Accuracy replaces pace as the routing strength signal

`computeSkillRatio` is left completely alone; a new pure
`accuracySkillRatio(records): number | null` returns `1 − 2a` over the answered records (`a` =
share correct), and `assignTask` uses it **instead of** the pace ratio when the game seals scoring.

Replace, not blend: once a wrong answer completes a task, pace stops measuring competence. A player
guessing instantly and wrongly registers as fast, therefore strong, and would be routed the hardest
remaining questions — the exact opposite of the requirement. Blending would only dilute that
inversion, not remove it.

The mapping is chosen to fit `adaptiveDifficultyMatch` unchanged, which targets `−skillRatio`:
all-correct → `−1` → hardest; all-wrong → `+1` → easiest; an even split → `0`, identical to the
neutral value a team already has before its first task. Returns `null` with no answered records so
the caller falls through to today's neutral behaviour rather than inventing a verdict from nothing.

### 5. Record the submission on `RunTaskRecord`, written in the same transaction that scores it

Two new optional fields: `submittedAnswer?: string` and `wasCorrect?: boolean`, written only when
the game seals scoring. Written in the scoring transaction so a submission can never exist without
its verdict, or be raced by a double tap. The stored text is capped (reuse the 500-char bound
`surveyResponse` already uses) so a hostile client cannot grow the team document without limit.

*Alternative rejected:* a separate `submissions` subcollection. It would need new rules, a new
prune path, and a second read for every grading view, to hold data that is already one-per-task and
belongs to the record it describes.

### 6. Neutral finish is a play-web decision, backed by an empty payload

`FinalScreen` renders a completion state with no score, rank or share card. It is safe as pure
presentation *because* decision 2 already means there is no score, no rank and no leaderboard in
the payload to render — the UI is choosing what to show from nothing, not withholding something it
holds.

## Risks / Trade-offs

- **A future field added to `RunTeam` or `RunTaskRecord` silently reaches participants.** → The
  allow-list projection in decision 2 makes the default "absent". Backed by
  `scripts/test-test-mode.ts` asserting the projection's key set exactly, so adding a field without
  a decision fails `npm test`; and by the e2e sanitizer allowlist, which fails loud on an
  unrecognised key.
- **`wasCorrect` leaks and the whole feature is void.** → Sealed unconditionally (not only in test
  mode), asserted in both the pure test and a dedicated e2e assertion.
- **A creator turns test mode on mid-run.** The Builder autosaves ~1.5 s after any edit, and a live
  run reads the game template on each call, so scoring would seal itself part-way through. → Out of
  scope to *prevent*, but the setting gets an explicit warning in its help copy, and because
  sealing is a pure projection nothing already scored is lost — the creator still sees everything.
  Worth revisiting if it bites.
- **Adaptive difficulty needs authored `difficulty` values to do anything.** A game whose tasks all
  sit at the default 5 will route identically regardless of accuracy. → Not a defect (the term
  cancels between equal-difficulty candidates, exactly as today); called out in the settings help
  text so the expectation is right.
- **Stored free-text answers are new personal-ish data.** → Test-mode games only, owner-readable
  only, inside the run subtree that the existing 90-day retention prune already covers.

## Migration Plan

Additive and backward-compatible: `testMode` absent ⇒ `sealsScoreFromParticipant` is false ⇒ every
existing game, in-flight run and cached client bundle behaves exactly as today. No Firestore index,
no `firestore.rules` change (the new fields live on the already server-write-only team document),
no new env var. Rollback is turning the setting off; a run that already stored submissions simply
keeps them as inert extra fields.

## Test strategy

- **Pure logic** — `scripts/test-test-mode.ts` (auto-discovered by the aggregator):
  `sealsScoreFromParticipant` across present/absent/false; `sanitizeTeamForParticipant` key-set
  equality in both modes, including that `wasCorrect`/`submittedAnswer` are absent in **both**;
  `accuracySkillRatio` at all-correct / all-wrong / even-split / empty (`null`) / malformed records.
- **Routing** — extend the existing routing lane to assert a low-accuracy team is offered a lower
  `difficulty` than a high-accuracy team given the same candidate set, and that a non-test game's
  ordering is byte-identical to today.
- **Callable** — a new `test mode` scenario in `scripts/e2e-verify.mjs`: submit a **wrong** answer
  and assert the response has no `correct` key, the task reaches `completed`, and a next task is
  assigned; assert the participant payload contains no `score`, `earnedScore`, `scoreBreakdown`,
  `leaderboard`, `answerCost` or `wasCorrect`; assert the **owner** still reads the full score and
  the stored submission. Add the new keys to the sanitizer allowlist in the same commit — it fails
  loud otherwise, which is the point.
- **UI** — preview-tool verification of both apps (settings switch saves and round-trips; play-web
  shows no score header, no right/wrong feedback, neutral finish), plus
  `npm run i18n:check:strict` clean with **zero** new PART B warnings.
- **Gates** — the full `npm run verify` gauntlet plus `npm run e2e`.

## Open Questions

- Should a test-mode run be excluded from the **public** leaderboard route (`?board=`) even after
  `finalizeRun` publishes? Current plan: yes, seal it, since a public board would undo the neutral
  finish for anyone who has the code. Flagging because it is the one participant-facing surface
  that is not reached through `getMyTeamState`.
- Should `skipTaskForTeam` / `skipStage` consolation awards stay visible to staff mid-run on a
  test-mode run? Assumed yes (staff surface, not participant), but it shares copy with the
  participant screens in one place.

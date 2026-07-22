## Context

`submitTaskAnswer` (`functions/src/runs/index.ts:3267`) is the only callable that grades a typed or
chosen answer. Its wrong branch (`:3367-3381`) is four lines: conditionally increment
`taskAttempts[taskId]`, return `{ correct: false }`. Nothing else in the codebase reacts to a wrong
answer. The only related machinery is:

- `smart.attemptLimit` + `attemptLimitReached()` (`packages/shared/src/answerAttempts.ts`) — a hard
  lock at N wrong answers, checked at `:3354-3362` **before** grading.
- `hintAutoRevealAttempts` + `isHintFree()` (`packages/shared/src/hintEscalation.ts`) — frees the
  paid hint after N wrong answers, read inside `requestTaskHint`'s transaction (`:3074`) and
  surfaced as the display flag `hintFreeNow` in `getMyTeamState` (`:3563-3576`).

Both consume `team.taskAttempts[taskId]`, which is why that counter exists at all and why it is
only written when one of them is configured.

The scoring model is in `packages/shared/src/scoringPresets.ts`. The relevant facts:
`time_only` returns a score of 0 for everyone and ranks purely on `durationSeconds`;
`fixed_points_speed` and `smart_weighted` accumulate per-task points. `applyPenalties(score, bp)`
is `Math.max(0, score - bonusPenalty)` — **the floor is already 0**, so no point charge can produce
a negative score. `buildRankings()` is shared by `finalizeRun` and `refreshLeaderboard`, which is
exactly why the penalty must ride `bonusPenalty` and not fork the ranking.

## Goals / Non-Goals

**Goals**
- A wrong answer costs something under a creator-chosen strictness, escalating and capped.
- The cost is coherent under every scoring preset, including the preset that has no points.
- Nothing about an existing game or an in-flight run changes.
- Network retries, double taps and offline replays are never charged.

**Non-Goals**
- No `buildRankings` change. No new callable. No rules or index change.
- No penalty on `field` / `photo` / `geofence` / `smart_station` / `sequence` / `survey`.
- No Builder editor for the per-task override (server-honoured, no UI yet).

## Decisions

### 1. The knob: one enum, two levels of placement

`Game.scoringOptions.wrongAnswerPenalty?: WrongAnswerLevel` (game default) and
`Task.wrongAnswerPenalty?: WrongAnswerLevel` (per-task override).
`WrongAnswerLevel = 'off' | 'gentle' | 'standard' | 'strict'`.

**Why a named level rather than raw numbers.** Five numbers (free attempts, point step, point cap,
cooldown step, cooldown cap) exposed as five inputs is a configuration surface no creator will tune
correctly, and every combination becomes a shape the tests must cover. A four-value enum backed by
one table in `packages/shared` is a single Builder dropdown, a single lookup, and a finite set of
behaviours to test. A bar mitzvah hunt picks `gentle`, a gibush picks `strict`, and neither has to
reason about a curve.

**Why `scoringOptions` and not a new top-level `Game` field.** `ScoringOptions` already holds the
opt-in `transitPenaltyEnabled` / `sprintPenaltyEnabled` penalties, and `updateGame` passes
`scoringOptions` through wholesale (`functions/src/games/index.ts:251`), so **no change is needed
in `games/index.ts`** — a file another lane currently owns.

**Existing games.** Resolution is `task.wrongAnswerPenalty ?? game.scoringOptions?.wrongAnswerPenalty ?? 'off'`.
Every game authored before this change has neither field, so it resolves to `off`, which is a
verbatim no-op: the same `taskAttempts` write condition, the same `{ correct: false }`, no new
document fields. **No live run changes its rules mid-flight and nothing is migrated.** New games
get `standard` written explicitly by the Builder's new-game seed, so the value is visible in the
selector rather than an invisible default. This is the honest split: the fix is on by default for
everything authored from now on, and never retroactive.

### 2. The curve: free attempts, then linear escalation, then a hard cap

For the k-th **charged** wrong answer (`k = attemptIndex − freeAttempts`, `k ≥ 1`):

- points = `pointStep × k`, cumulatively capped at `maxPoints`
- cooldown = `min(cooldownStep × k, maxCooldownSeconds)`

| level | freeAttempts | pointStep | maxPoints | cooldownStep | maxCooldownSeconds |
|---|---|---|---|---|---|
| `off` | n/a | 0 | 0 | 0 | 0 |
| `gentle` | 2 | 5 | 20 | 10 | 30 |
| `standard` | 1 | 10 | 60 | 15 | 90 |
| `strict` | 0 | 15 | 150 | 30 | 180 |

At `standard`: attempt 1 free; then 10 / 20 / 30 points (cumulative 10 / 30 / **60 = cap**) with
15 / 30 / 45 second waits; from the 5th wrong answer on, zero points and a wait rising to the 90
second ceiling.

**Why linear and not geometric.** Doubling reaches "absurd" in three steps and makes the cap the
only thing that matters. Linear is explainable in one sentence ("each further wrong answer costs a
bit more") and the cumulative series (1, 3, 6, 10 × step) already rises fast enough that the third
guess on a four-option quiz is clearly worse than thinking.

**Why free attempts.** A first wrong answer is overwhelmingly a typo, a misread, or a fat-fingered
choice button. Charging it punishes clumsiness rather than guessing. `strict` sets it to 0 on
purpose: a competitive gibush wants the first answer to be the answer.

**The cap, stated.** The maximum points one task can ever remove from one team is `maxPoints`
(20 / 60 / 150). The maximum a single retry can be delayed is `maxCooldownSeconds`
(30 / 90 / 180 s). There is no cap on the *number* of wrong answers; capping that is
`smart.attemptLimit`'s job and it is deliberately left alone.

### 3. Preset-awareness: points are conditional, the cooldown is not

`time_only` awards nobody any points; a point penalty there is a write to a field that never
reaches the ranking. So the cost function takes the preset and **forces `points = 0` under
`time_only`**, leaving the cooldown as the whole penalty. That is not a degraded fallback: under
`time_only` the currency of the game *is* elapsed time, so a 45 second lockout is the most exactly
denominated penalty the preset can have. Under `fixed_points_speed` and `smart_weighted` both
components apply.

The cooldown is identical across all three presets, so there is one curve to explain, not three.

### 4. Cooldown as the primary penalty (recommendation)

The cooldown is the recommendation, with points as the preset-conditional secondary.

- It is **preset-agnostic** — it works where points are meaningless.
- It **cannot produce a negative or unwinnable score**. Points already have a floor
  (`applyPenalties`), but a floor is a clamp, not a design; a team pinned at 0 has lost the ability
  to be punished further, whereas time always costs.
- It is **self-balancing**. A brute-forcer converts guesses into lost race time at a rising
  exchange rate, and the field passes them. Nobody has to tune a number for that to be fair.
- It **does not stop biting at the cap**. Once `maxPoints` is spent, further guessing is free in
  points; the cooldown keeps escalating to its ceiling, so the cap can never become "guessing is
  free again".
- It is **legible**: a ticking countdown is instantly understood, where "−20 pts" is abstract until
  the final board.

Its one real cost: the cooldown gate must run **before** grading, so it can also delay a team that
knew the answer. Grading first would let a team fire all four options during a cooldown and the
deterrent would be exactly zero. That cost is bounded by the free attempts (the first wrong answer
never blocks anyone at `gentle`/`standard`) and by `maxCooldownSeconds`, and it is waived entirely
in a test-drive run.

### 5. Idempotence, and never punishing infrastructure

Today's correct path is idempotent through `completeTaskForTeam`'s `status === 'completed'`
short-circuit; the e2e suite asserts this (`scripts/e2e-verify.mjs:4757`, `:5045`). The wrong path
has no idempotence at all, so a Functions client retry after a timeout is currently a second
attempt. With a cost attached that becomes a real bug.

**The replay rule:** persist `answerPenalties[taskId].lastHash`, a hash of the normalized submitted
answer (`djb2` over the trimmed, lower-cased string; for an ordering task, over the joined
arrangement). If an incoming submission hashes to the stored value, it is a **replay of a call the
server already graded**: return the stored wrong verdict with the existing `cooldownUntil`, record
nothing, charge nothing. The check runs **before** grading and before the cooldown gate, so a
double tap during a cooldown returns a clean replay rather than an error.

This is also correct game design, not just plumbing: re-sending the identical wrong answer carries
no new information and should cost no new anything. A brute-forcer submits *different* answers by
definition, which is exactly the case that is charged. Only a hash is stored, never the player's
raw text.

**Order of operations inside `submitTaskAnswer`** (one team read, then at most one transaction):

1. existing guards, unchanged: type, stage-active, presence gate, ordering shape, expiry
2. read the team doc once, `attempts` + `answerPenalties[taskId]`
3. `attemptLimitReached` → `resource-exhausted` (unchanged, still before any grading, still
   consuming nothing)
4. replay check → return the stored verdict
5. cooldown gate → `failed-precondition` + `retryAfterSeconds` (bypassed in a test-drive run,
   whose run-doc read happens only on the would-block path, mirroring the presence gate at `:3306`)
6. grade (`matchesTaskAnswer` / `matchesOrderedAnswer`, pure, no I/O)
7. wrong → charge; correct → the existing completion path, untouched

**Floor.** `applyPenalties` clamps at 0 and the cap bounds the contribution, so no team can be
driven negative and `buildRankings`'s well-formedness (used by the e2e invariant oracle) is
unaffected.

### 6. Persistence and atomicity

New on `RunTeam`:

```ts
taskAttempts?: Record<string, number>;              // promoted from an inline cast
answerPenalties?: Record<string, {                  // per task
  charged: number;        // points charged so far on this task (for the cap)
  lastHash: string;       // hash of the last wrong answer (for the replay rule)
  cooldownUntil: number;  // epoch ms; 0 when not cooling down
}>;
```

Both are **map fields keyed by taskId**, written as real nested objects via `.set({merge})` /
`tx.update` with a nested literal. Never a dotted key (which would write a literal `"a.b"` field),
never an array element (which would coerce the array to a map).

The charge is applied in a **transaction on the team doc**, exactly as `requestTaskHint` already
does (`:3061-3085`). The cap and the replay rule are read-modify-write decisions, so
`FieldValue.increment` alone cannot honour them under a race; a transaction makes the cap exact.
This is **not** the `completeTask` hot path — it is the wrong-answer branch, which by construction
runs only when the team failed, and the correct-answer path keeps its transaction-free flow
untouched.

No leaderboard refresh is triggered, matching `requestTaskHint`, which also charges `bonusPenalty`
without forcing a recompute. The next scoring event picks it up through the existing throttle.

### 7. Telling the participant, without telling them the answer

`getMyTeamState` already decorates the team's active task with a server-computed display flag
(`hintFreeNow`, `:3575`). The same seam carries a display-only object:

```ts
safe.answerCost = {
  level, freeAttemptsLeft, nextPoints, nextCooldownSeconds, cooldownUntil, charged
};
```

It is derived from the level table plus the team's own `taskAttempts` / `answerPenalties` and
contains no fragment of an answer key. It is omitted entirely when the resolved level is `off`, so
an existing game's payload is byte-identical.

`submitTaskAnswer`'s response gains `penalty`, `cooldownUntil`, `attemptsUsed` and `replay` on the
wrong path so the UI can state the cost immediately without a round trip to `getMyTeamState`.

**Sanitizer allowlist.** `sanitizeTaskForParticipant` passes unknown top-level `Task` fields
through `...rest`, so `wrongAnswerPenalty` reaches the client, and `answerCost` is added by the
decorator. Both must be added to `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs` or the allowlist
scenario fails loud — which is the intended behaviour of that guard, not a workaround.

## Files to touch

**Shared** — `packages/shared/src/wrongAnswerPenalty.ts` (new; the level table, `resolveWrongAnswerLevel`,
`wrongAnswerCost`, `cooldownRemainingSeconds`, `hashAnswerForReplay`), exported from
`packages/shared/src/index.ts`. `packages/shared/src/types/index.ts`: `WrongAnswerLevel`,
`ScoringOptions.wrongAnswerPenalty`, `Task.wrongAnswerPenalty`, `RunTeam.taskAttempts`,
`RunTeam.answerPenalties`.

**Functions** — `functions/src/runs/index.ts` only: the `submitTaskAnswer` wrong branch and its
pre-grade gates, plus the `getMyTeamState` decorator next to `hintFreeNow`. No new export, no
change to `functions/src/index.ts`, no change to `functions/src/games/index.ts` (owned by another
lane; `scoringOptions` already passes through).

**play-web** — `src/services/calls.ts` (response type + `SafeTask.answerCost`),
`src/components/TaskRunner.tsx` (a pre-answer cost line, a post-answer charged line, a countdown
that disables submit), `src/i18n.ts` (both dictionaries).

**creator-web** — `src/pages/BuilderPage.tsx` (one selector inside the existing `advScoring`
`Advanced` section, next to the preset picker), `src/i18n.ts` (both dictionaries).

**Tests** — `scripts/test-wrong-answer-penalty.ts` (new), additions to
`functions/src/__property__/invariants.property.test.ts`, a new scenario plus two allowlist entries
in `scripts/e2e-verify.mjs`.

## Test strategy

**Pure logic first (RED before any production code).**
- `scripts/test-wrong-answer-penalty.ts` (tsx, picked up by `scripts/run-unit-tests.mjs`) pins the
  boundaries: the exact `standard` sequence 0/10/20/30/0/0, the cumulative cap, the cooldown
  ceiling, `off` returning zeroes, `time_only` zeroing points while keeping the cooldown,
  resolution precedence (task > game > `off`), `cooldownRemainingSeconds` at and past expiry, and
  hash stability across case and surrounding whitespace.
- `functions/src/__property__/invariants.property.test.ts` gains a seeded-random block in the
  existing house style: for any level × preset × attempt index × already-charged (including NaN,
  Infinity, negative and non-integer inputs) — `points ≥ 0` and finite; `cooldownSeconds ≥ 0`,
  finite and `≤ maxCooldownSeconds`; `charged + points ≤ maxPoints`; **cumulative** points
  non-decreasing in attempt index; cooldown non-decreasing in attempt index; `points === 0`
  whenever the preset is `time_only` or the level is `off`.

**Callable behaviour** — new `scripts/e2e-verify.mjs` scenario "wrong answers cost", written now and
marked UNVERIFIED (the emulator is not run in this lane): a `standard` game charges 0 then 10 then
20 on `bonusPenalty`; the cap holds after the 4th; the cooldown refuses the next submission with
`failed-precondition` and refuses it *without* incrementing `taskAttempts`; a duplicate identical
wrong submission does not double-charge; the correct answer after the cooldown still completes and
routes; a `time_only` game leaves `bonusPenalty` at 0 while still applying the cooldown; a legacy
game with no knob is unchanged; the leaderboard invariant oracle and live/final parity still pass
with a charged team on the board; and the payload allowlist covers `wrongAnswerPenalty` +
`answerCost`.

**UI** — preview verification plus `npm run i18n:check` (PART A is a hard gate) and
`npm run i18n:check:strict` for the new strings. Every new string lands in both `he` and `en`, real
Hebrew in `he`, and obeys the no-dashes standard (`scripts/test-no-dashes.ts`) — the point costs
render with the true minus sign U+2212.

## Risks / Trade-offs

- **A correct answer can be delayed.** Deliberate, argued in §4, bounded by the free attempts and
  the cooldown ceiling, and waived in test-drive runs.
- **A transaction on the wrong-answer path.** Accepted: it is not the completion hot path, it
  mirrors `requestTaskHint`, and the cap and replay rule are read-modify-write by nature.
- **New payload fields.** Guarded by the e2e allowlist, which is designed to fail loud on exactly
  this; neither field carries any part of an answer key.
- **Level table drift between server and UI.** Prevented by keeping the table and every derived
  figure in `packages/shared`; the participant display and the server charge call the same
  function.

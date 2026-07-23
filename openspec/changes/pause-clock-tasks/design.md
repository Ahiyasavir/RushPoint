# Design — pause-clock-tasks

## Decision 1 — Scope: any task type, default OFF

**Chosen:** `Task.pausesTimer` is offered on **every** task type, defaults to absent (off), and the
server applies **one uniform rule** to whatever carries it.

The owner asked for it on surveys. A survey-only flag would be smaller, but it would be a worse
design for three concrete reasons:

1. **The reason is not the type.** "Hurrying defeats the point" is equally true of a reflective
   `self_report` ("write down what your grandparent told you about this street"), a long
   `sequence` at one stop, a `photo` task that asks for a posed group portrait, and a hard
   `quiz` that is meant to be discussed. Keying the mechanic to `type === 'survey'` would force a
   creator to mis-author a survey to get the behaviour, which is how a data model rots.
2. **A type gate is a second source of truth.** Every type-conditional we already carry
   (`isAnswerTask`, `sectionApplies`, the sanitizer's per-type branches) is a place the server and
   the Builder can disagree. A boolean the server reads uniformly has no such seam.
3. **It stays reversible.** Restricting later is a validation change; widening later is a data
   migration plus a spec change.

**The `field` / `geofence` objection is real and is answered, not ignored.** For a located task the
excluded span (`RunTaskRecord.startedAt` → `completedAt`) starts at **assignment**, so it includes
the walk to the spot. Pausing the clock on a located task therefore excludes transit as well as
work. Three ways out were considered:

- *(rejected)* **Forbid it on located tasks.** This bans the legitimate case ("sit at this
  viewpoint and answer three questions") to prevent a case that is a creator's own choice, not a
  player exploit. `pausesTimer` is authored in the template by the game's owner; a creator who
  pauses the clock on the walking legs has made their game untimed on purpose, exactly as a creator
  who picks `time_only` and gives every task an absurd `estimatedMinutes` has.
- *(rejected)* **Start the excluded span at arrival instead of assignment**
  (`arrivedAt ?? startedAt`). `RunTaskRecord.arrivedAt` is latched only by `reportArrival` on
  **hidden-location** tasks, so this would exclude transit for a hidden task and include it for an
  ordinary radius task — an invisible, type-dependent asymmetry in the one number the whole
  leaderboard depends on. Worse semantics than either uniform choice.
- **(chosen)** **Allow it, keep one rule, and make the interaction visible.** The Builder shows a
  warning line under the toggle whenever the task is located
  (`normalizeTriggerMode(task)` is `radius` or `exact`): the walk to this spot will not be timed
  either. Routing is separately protected (Decision 4), so the odd interaction is confined to
  scoring, where it is the creator's stated intent.

## Decision 2 — Naming

**`Task.pausesTimer?: boolean`** (template) and **`RunTaskRecord.excludedMs?: number`** (run state).

- `pausesTimer` reads as what the creator switched on ("pauses the timer"), matches the sibling
  verb-phrase booleans on `Task` (`locationless`, `hideLocation`, `requirePresence`), and is what
  the toggle's own label says. `excludeFromTiming` was the alternative; it describes the
  *consequence* rather than the switch, and it invites the reading "this task is excluded from the
  game", which is what `skipped` means.
- `excludedMs` names a **quantity**, not a flag, so there is no way to read the run record as "this
  task pauses the clock" (a template fact) when it actually means "this many milliseconds of this
  team's clock were excluded" (a run fact). Milliseconds, not seconds or minutes, because every
  timestamp in the run documents is an ISO instant differenced in milliseconds; converting once at
  the point of use avoids a rounding step per task.
- Both are **optional and absent by default**. `pausesTimer` absent ⇒ the old behaviour exactly.
  `excludedMs` absent ⇒ `0`. No existing game document, run document or team document is rewritten.

**Why the run record carries a number at all, rather than re-reading `task.pausesTimer`:**
`buildRankings` does receive the `Game`, so it *could* re-derive the flag. It must not.
A creator can edit the game template while a run is live (`updateGame` is not blocked by an active
run). If ranking re-derived the flag, toggling `pausesTimer` mid-run would retroactively re-time
tasks teams had already finished, and the live board would jump. Stamping the number once, at
completion, from the server clock makes a completed task's contribution **immutable**, makes
`buildRankings` a pure function of stored team state, and is what guarantees live/final parity
(Decision 3).

## Decision 3 — Where the excluded time is subtracted, and how live/final parity holds

The pure module `packages/shared/src/pausedClock.ts` owns the whole rule:

```
taskExcludedMs(rec, pausesTimer)   -> ms      // one record, at completion time
teamExcludedMs(stages)             -> ms      // Σ of the stamped excludedMs
adjustedElapsedMs(rawMs, excMs)    -> ms      // max(0, raw − exc), non-finite-safe
adjustedElapsedSeconds(rawS, excMs)-> s       // the same rule in the units buildRankings uses
```

Three write/read sites, and only three:

**(a) Completion — `completeTaskForTeam` (`functions/src/runs/index.ts`).** The record already
gets `completedAt = now` and `actualMinutes` from `now − (taskRec.startedAt ?? team.startedAt ??
now)`. When the game task carries `pausesTimer`, the same server-derived span is stamped as
`taskRec.excludedMs = taskExcludedMs({ startedAt, completedAt: now }, true)`. `actualMinutes` keeps
its real value — benchmarks, the per-type duration aggregation and the staff over-duration warning
all read it and must not be lied to.

Also at (a): under `smart_weighted` the per-task score is computed from `actualMinutes`. For a
paused task the server feeds `gameTask.estimatedMinutes` instead, so `x = 1` and the sigmoid
multiplier is a constant `0.85` — **time-independent**. This is the *neutral* reading of "the clock
is stopped": the task is scored exactly as if it had been done on estimate, so thinking is neither
rewarded nor punished. (Feeding `0` would make every paused task pay the maximum multiplier and
turn "pause the clock" into "free points", which is a different, worse feature.) `skipAward` for
`smart_weighted` already awards the on-estimate score, so a skipped paused task and a completed
paused task agree.

**(b) Ranking — `buildRankings`.** One value is computed per team,
`excludedMs = teamExcludedMs(team.stages)`, and it feeds **every** time-derived term:

| term | before | after |
|---|---|---|
| `fixed_points_speed` speed bonus | `actualTotal = (finish − start)/60000` | `scoreFixedPointsSpeed(..., excludedMs)` subtracts it from that span first |
| emitted `durationSeconds` / `totalMinutes` | `durationSeconds(start, finish)` | `adjustedElapsedSeconds(...)` |
| `time_only` ordering | sorts on `durationSeconds` | sorts on the adjusted value (same field) |
| Z-Score `durationMin` | `durSec / 60` | adjusted `durSec / 60` |

`buildRankings` is the **only** ranking implementation; `finalizeRun` and `refreshLeaderboard` (and
the auto-refresh hook, and `getPublicLeaderboard`, which all read `run.leaderboard`) call it with
the same `(game, teams, now)`. Because the adjustment is a function of the **stored** team document
and nothing else — not of `now`, not of the current game template, not of any client input — the
value computed live and the value computed at finalize are identical for the same team state. That
is exactly the property the existing "gate duration on REAL completion" comment protects, and this
change preserves it rather than adding a second place to subtract.

`smart_weighted`'s per-task scores are already frozen on the record at (a), so `scoreSmartWeighted`
(a Σ over `earnedScore`) needs no change and cannot drift either.

**(c) Routing — Decision 4.**

**Deliberately NOT adjusted:** the in-progress case. `buildRankings` emits a duration only for a
team whose `status === 'finished'`, so a team currently sitting on a paused task has no duration on
the board to adjust. Excluding a *partial*, still-open span would make the entry a function of
`now` again, which is the precise regression the current code base warns against in comments at
`runs/index.ts:1220-1234`.

## Decision 4 — Routing pace is protected

`computeSkillRatio` averages `clamp(-1..1, (actual − estimated)/estimated)` over completed tasks to
decide whether to hand the team harder or easier work. A paused task's measured span is
deliberation (and possibly transit), not pace, so it is **dropped from the sample entirely** rather
than adjusted:

- Subtracting the excluded time would give `actual ≈ 0` ⇒ ratio `−1` ⇒ the team looks superhuman and
  gets routed the hardest remaining tasks. Strictly worse than ignoring it.
- Leaving it in gives `actual >> estimated` ⇒ ratio `+1` ⇒ the team looks slow and gets routed the
  easiest remaining tasks. Also wrong.

The marker is the **presence** of `excludedMs` on the record, not its value: the server stamps
`excludedMs` on every completed paused task even when the span rounds to `0`, so an instantly
completed paused task is still recognised and dropped. One field does both jobs; there is no second
boolean to keep in sync. If every completed task was paused, `computeSkillRatio` sees an empty
sample and returns its existing neutral `0` — the same value a team gets before its first task.

## Decision 5 — Server-side validation

`pausesTimer` is a **boolean or absent**, nothing else.

- Game file import (`packages/shared/src/gameFile.ts`): added to `EXPORTED_TASK_KEYS` and to
  `TASK_FIELD_TYPES` as `'boolean'`, so a file carrying `pausesTimer: "yes"` is refused by the
  existing typed-field validator rather than silently coerced.
- `updateGame` persists the authored `stages` array; the value is only ever *read* server-side
  through `!!gameTask.pausesTimer`, so a malformed truthy value cannot produce a non-boolean effect,
  and the excluded span is computed from server timestamps regardless of what the field says.
- The participant payload is passed through by the sanitizer's `...rest`. That is intended: the
  player must be told. It reveals nothing about any answer.

## Test Strategy

**Lane 1 — pure, RED first (vitest, `packages/shared/src/pausedClock.test.ts`).** The whole
accumulation/subtraction rule, written before the module exists:

| case | expectation |
|---|---|
| not a pausing task | `taskExcludedMs` is `0` whatever the timestamps |
| ordinary paused span | exact `completedAt − startedAt` in ms |
| never completed (no `completedAt`) | `0` |
| never started (no `startedAt`) | `0` |
| task expired / skipped / auto-skipped by a partial stage | `0` (no `completedAt` is written) |
| abandoned and re-routed | `0`, and a later real completion stamps only the final span |
| completed twice (idempotence) | the stamped value is unchanged by a second call with the same record |
| clock skew: `completedAt < startedAt` | `0`, never negative |
| unparsable / `NaN` / non-string timestamps | `0`, never `NaN` |
| zero tasks | `teamExcludedMs([])` is `0` |
| negative / `NaN` / `Infinity` stored `excludedMs` | ignored, sum stays finite and `≥ 0` |
| adjusted elapsed | `max(0, raw − excluded)`, never below zero |
| excluded ≥ raw (every task pauses) | adjusted is exactly `0` |
| raw is `Infinity` (unfinished team) | adjusted stays `Infinity` so the ranking still omits it |

**Lane 2 — seeded property invariants** (`functions/src/__property__/invariants.property.test.ts`,
extending the existing `buildRankings — leaderboard invariants` and `scoringPresets` blocks):
for random stamps, `adjustedElapsedMs` is finite-or-`Infinity`, never negative, never greater than
the raw value, and monotonic non-increasing in the excluded amount; `scoreFixedPointsSpeed` with an
excluded amount is `≥` the same call without one and stays inside the existing bonus cap; a run in
which every task pauses still yields contiguous ranks `1..n` with finite scores.

**Lane 3 — boundary scripts (`npm test`).** `scripts/test-game-file.ts` classifies `pausesTimer`
(export + round trip + a typed refusal); `scripts/test-game-presentation.ts` gains a task-level
payload guard proving a `Task` field authored in the Builder survives `buildSavePayload` through
`stages` and marks the game dirty; `scripts/test-wizard-sections.ts` covers the widened `rules`
section.

**Lane 4 — callable behaviour (`scripts/e2e-verify.mjs`, NOT edited by this change).** The exact
assertions owed are listed in `tasks.md` §9 and repeated in the change report.

**Lane 5 — UI.** `npm run i18n:check:strict` (zero new PART B warnings) plus both production
builds; the visual check is the Builder toggle and the play-web notice.

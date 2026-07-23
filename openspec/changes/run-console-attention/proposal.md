## Why

Tonight's work closed several ways a team gets stranded in the field: the GPS watch dying, the
safe-zone latch outliving the signal that set it, the wrong-answer retry lockout, and station
contention. Every one of those fixes is invisible to the person who actually has to act on it.

`apps/creator-web/src/pages/RunConsolePage.tsx:502-559` renders one row per team containing exactly:
the team name, a stage label, `stageDone`, the ranked score, and three controls (`let back in`,
`skip`, `adjust score`). The only health signal in the whole table is `team.outOfBounds`, added
tonight. Nothing on that row changes when a team stops moving.

That is the gap. The organizer's real mid-event question is **"is anyone in trouble right now?"** and
the console answers a different one ("what is everyone's score?"). Concretely, in the current UI these
four teams render **identically**:

- a team deep into a 20-minute photo task, working fine;
- a team whose phone lost GPS 40 minutes ago and has been standing at a locked task since;
- a team sitting out a retry lockout after a burst of wrong answers;
- a team that walked out of the play area, got latched, and is waiting for someone to notice.

Only the fourth is visible at all, and only because of tonight's badge. The other two failure modes
are indistinguishable from the healthy one. In practice the organizer finds out when a player
physically walks up and complains, which at a real event is 20-40 minutes of a child's evening.

The data needed to tell them apart is **already in the team document** and is simply not projected:
`RunTeam.updatedAt` (last server write for that team), `RunTeam.answerPenalties[*].cooldownUntil`
(the retry lockout), and the run's `teamLocations/{teamId}.updatedAt` (last GPS ping,
`functions/src/index.ts:326-332`). No new tracking, no new writes, no new client state is required to
answer the question.

## What Changes

**A pure classifier decides who needs attention.**
- `classifyTeamAttention(team, runContext, nowMs)` in `apps/creator-web/src/lib/teamAttention.ts`
  returns `{ level: 'ok' | 'watch' | 'stuck', reasons: [...] }`. It is total: no throws, no clock
  reads, no I/O, deterministic for a given `nowMs`.
- It is **field-relative**, not absolute. Idle thresholds are the larger of an absolute floor and a
  multiple of the field's own median idle time, so a game where every task legitimately takes 20
  minutes does not flag the entire table.
- It **fails quiet** on every low-information input: missing, unparsable or `NaN` timestamps, a
  device clock ahead of the browser, an absent GPS stream, a team that has not started, and a team
  that has finished all produce `ok`. Absence of evidence is never evidence of trouble.

**`listRunTeams` projects three scalars it already has in hand.**
- `updatedAt`, `answerLockoutUntil` and `lastLocationAt` join the existing row. All read-only, all
  behind the existing owner gate, no new writes and no change to any document shape.

**The run console shows it, minimally.**
- A count of teams needing attention on the teams panel header, and one badge per affected row
  carrying the *reason* in words. Existing `Badge` primitive, existing row layout, no new dependency.

### Non-goals

- **Not a monitoring dashboard.** No timeline, no history, no charts, no alerting, no notifications.
- **No new tracking and no new writes.** Nothing is recorded to say a team was flagged; the verdict is
  recomputed from the current projection on every poll and is never persisted.
- **No new client state or subscriptions.** The classifier consumes the `listRunTeams` rows the page
  already loads. `LiveTeamMap`'s `teamLocations` listener is untouched.
- **No automatic intervention.** Flagging a team does not skip, release, rescue or message anyone. The
  existing controls stay the only actions.
- **No participant-facing change.** `apps/play-web` is not touched.
- **No change to scoring, ranking, routing or the safe-zone latch.**

## Capabilities

### Added Capabilities
- `run-console-attention`: the run console derives, from data the server already holds, which teams
  are plausibly stuck, states the reason, and counts them — biased toward silence so that a badge
  keeps meaning something.

## Impact

- **Surfaces touched:** `functions/src/runs/index.ts` (`listRunTeams` projection only),
  `apps/creator-web/src/services/calls.ts` (`RunTeamRow` fields),
  `apps/creator-web/src/lib/teamAttention.ts` (new, pure),
  `apps/creator-web/src/lib/__tests__/teamAttention.test.ts` (new),
  `apps/creator-web/src/pages/RunConsolePage.tsx` (badge + header count),
  `apps/creator-web/src/i18n.ts` (HE/EN copy, additive).
- **No new callable.** `listRunTeams` already exists and is already covered by the e2e coverage guard,
  so no new scenario is required for coverage. Assertions that *would* be added to
  `scripts/e2e-verify.mjs` are listed in the design; that file is owned by another lane and is not
  edited here.
- **Backwards compatibility:** all three new row fields are optional. A console build talking to an
  older backend, or a team document written before this change, simply yields fewer reasons and never
  a false one — the classifier treats every missing field as "no evidence".
- **Cost:** one additional `teamLocations` collection read per `listRunTeams` call (the same call
  already reads the whole `teams` collection). No writes, no indexes, no listeners.
- **Risk:** false alarms. An organizer who sees the whole table flagged learns to ignore the badge,
  which is worse than not having it. The thresholds are therefore deliberately conservative and
  justified line by line in the design; the classifier under-flags by construction.
- **Testing:** pure-logic lane (vitest, `apps/creator-web`). No emulator: a live playtest stack is
  serving from this tree, so `e2e`, `verify:emulator`, `test:rules` and `simulate` are not run.

## Context

The run console polls `listRunTeams` and renders a row per team. Tonight's stuck-player fixes made
several failure modes *recoverable* but none of them *observable*. This change adds the observation
layer and nothing else.

Two constraints shape every decision below:

1. **A live playtest stack is serving from this tree.** No emulator, no dev server, no browser
   automation. Everything shipped here is therefore verified by the pure-logic lane plus the static
   gates; the UI wiring is reviewed by reading, not by running.
2. **A badge that fires often is a badge nobody reads.** The failure mode of this feature is not
   "missed a stuck team", it is "flagged everyone, so the organizer stopped looking". Every threshold
   is chosen to under-flag.

## Goals / Non-Goals

**Goals**
- Answer "is anyone in trouble right now?" from data already on the wire (plus three scalars the
  server already holds in memory when it builds the projection).
- Keep the verdict pure and testable, with the thresholds as named constants.
- Make the reason legible: a badge that says only "attention" is a puzzle, not a signal.

**Non-goals** — see the proposal. In particular: no persistence of the verdict, no new writes, no new
listeners, no automatic intervention.

## Decisions

### D1 — What is already on the wire, and what is not

Audited against `functions/src/runs/index.ts:2387-2433` (the `listRunTeams` projection),
`apps/creator-web/src/services/calls.ts:113-132` (`RunTeamRow`) and `RunTeam` in
`packages/shared/src/types/index.ts:820-903`.

**Already projected and usable as-is:**

| Signal | Field | Use |
|---|---|---|
| Safe-zone latch | `outOfBounds` (added tonight) | hard "stuck" — assignment is blocked |
| Finished | `finished`, `finishedAt` | suppression: a finished team is never flagged |
| Not yet started | `launched`, `startedAt` | suppression: new joiner grace window |
| Pending staff review | `pendingReviews` | explains an idle team; never flags on its own |
| Progress | `completedStages`, `activeStageOrder` | context only |

**On the team document but NOT projected (added by this change):**

| Signal | Source | Why it is worth a projection line |
|---|---|---|
| `updatedAt` | `RunTeam.updatedAt` (`types/index.ts:902`) | the only "when did anything last happen for this team" value that exists. Every scoring/answer/hint/assignment path writes it. This is the idle clock. |
| `answerLockoutUntil` | `max(RunTeam.answerPenalties[*].cooldownUntil)` (`types/index.ts:886-893`) | the retry lockout added tonight. Without it, a locked-out team is indistinguishable from a thinking team. Already loaded in the same document read. |
| `lastLocationAt` | `teamLocations/{teamId}.updatedAt` (`functions/src/index.ts:326-332`) | the dead-GPS-watch case, which is the failure that started this whole line of work. Costs one extra collection read on a call that already reads the whole teams collection. |

**Deliberately NOT added:**
- *Per-task assigned-at.* `RunStageRecord.tasks[].startedAt` exists, but reproducing the active-task
  lookup on the wire duplicates what `updatedAt` already measures. Rejected as redundant.
- *SOS alerts.* Already a first-class panel in the console with its own count
  (`RunConsolePage` `alerts`). Re-surfacing them on the team row would double-report the one signal
  the organizer already sees. Rejected as duplication.
- *Stage progress versus the rest of the field.* "Last place" is not "in trouble" — it is the game.
  Flagging it would be exactly the wall of false alarms this design is built to avoid. Rejected.
- *Anything requiring a new write, a new collection, or a new listener.* Out of scope by construction.

`listRunTeams` gains no new parameters and no new auth surface: the projection is built after the
existing `runSnap.data().ownerUid !== uid → permission-denied` gate, and the extra read is the same
owner-scoped run path. `answerLockoutUntil` is a clock value, not an answer key, so it does not touch
the sanitizer contract. The lockout ceiling is bounded server-side already; the value is projected
verbatim and every consumer clamps it.

### D2 — A pure, total classifier

```ts
classifyTeamAttention(team: AttentionTeam, ctx: AttentionContext, nowMs: number): TeamAttention
```

- `AttentionTeam` is a structural subset of `RunTeamRow`; every field it reads beyond `id` is
  optional, so a row from an older backend classifies as `ok` instead of throwing.
- `AttentionContext` is `{ medianIdleMs: number | null }`, produced by `buildAttentionContext(rows,
  nowMs)` over the *active* teams (launched, not finished, parsable `updatedAt`).
- `nowMs` is injected. The function reads no clock, does no I/O, and never throws.

Precedence, evaluated once:

1. **Suppression gates** (any hit ⇒ `{ level: 'ok', reasons: [] }`, no further evaluation):
   `finished === true`; `launched !== true`; `startedAt` parses and is younger than `START_GRACE_MS`.
2. **Reason collection**, each independently contributing a candidate level.
3. **Level = the maximum candidate level**, `ok < watch < stuck`.
4. `awaitingReview` is appended as an *explanatory* reason only when the level is already non-`ok`
   and `pendingReviews > 0`. It never raises the level by itself.

Reasons are emitted in a fixed severity order (`outOfBounds`, `answerLockout`, `gpsSilent`, `idle`,
`awaitingReview`) so the rendering is deterministic and the tests can assert on arrays.

Every duration is computed by a single helper that returns `null` for a missing/unparsable/`NaN`
timestamp and clamps negatives to `0`. That one helper is what makes clock skew and garbage
timestamps a non-event: a browser clock behind the server yields `0`, which is under every threshold.

### D3 — Thresholds, and why they will not spam

The idle rules are **relative to the field**, because "how long is a normal gap between events" is a
property of the *game*, not of the platform. A treasure hunt with 3-minute micro-tasks and a hiking
game with 25-minute legs cannot share an absolute number. Each idle threshold is therefore
`max(absolute floor, factor × field median idle)`.

| Constant | Value | Justification |
|---|---|---|
| `START_GRACE_MS` | 10 min | A team that just joined has an `updatedAt` from the join write and no activity yet; without the grace, *every* team is flagged for the first minutes of a run, which is precisely when the organizer is busiest and least able to ignore noise. 10 min comfortably exceeds a briefing plus the walk to the first task. |
| `IDLE_WATCH_FLOOR_MS` | 12 min | Below this, a normal task (walk + solve + photo) is routinely in flight. 12 min is longer than the slowest single interaction observed in the seeded demo games. |
| `IDLE_WATCH_MEDIAN_FACTOR` | 2.5 | An outlier at 2.5× the field's own median is unusual for *this* game. With a healthy 3-minute median this yields 7.5 min, below the floor, so the floor governs and nothing is flagged early. |
| `IDLE_STUCK_FLOOR_MS` | 25 min | The number in the original complaint: a team standing still for 25 minutes is a problem in any field game. |
| `IDLE_STUCK_MEDIAN_FACTOR` | 4 | Four times the field's own pace. In a slow game (15-minute median) this is 60 min, not 25 — the whole point of the relative rule. |
| `IDLE_HARD_STUCK_MS` | 60 min | A ceiling so a pathologically slow field cannot push the stuck threshold arbitrarily high. **Suppressed when the field median itself exceeds it**: if everyone has been quiet for an hour, that is the game (or the run is winding down), not one team in trouble. |
| `GPS_WATCH_MS` | 15 min | `updateLocation` is driven by `watchPosition`; a moving phone emits far more often than this. 15 min of silence means the stream died, the app was backgrounded, or the battery saver kicked in. Worth knowing, not an emergency — hence `watch`. |
| `GPS_STUCK_MS` | 35 min | Escalates to `stuck` **only in combination with idle beyond the watch threshold**. A team completing tasks with a dead GPS stream is inconvenienced, not stranded; a team that is both silent and not progressing is the dead-watch case this whole line of work exists for. |
| `LOCKOUT_MIN_REMAINING_MS` | 2 min | Retry lockouts are ordinary gameplay. Flagging a 30-second cooldown would fire constantly. Only a lockout with real time left on it is worth an organizer's attention. |
| `LOCKOUT_STUCK_REMAINING_MS` | 10 min | A lockout this long means the team has hit the escalation ceiling and is genuinely parked. |
| `MIN_TEAMS_FOR_MEDIAN` | 3 | With one or two active teams a "median" is noise; the context reports `null` and only the absolute floors apply. |

Two structural properties keep the badge rare, independent of the numbers:
- **Every unknown resolves to `ok`.** Missing timestamp, missing GPS, missing lockout, older backend,
  clock skew — all silent.
- **`outOfBounds` is the only single-signal `stuck`**, and it is already a latch the console can clear
  with the button sitting next to it, so it is actionable by construction.

Expected steady-state behaviour on a healthy 10-team run: zero badges. On the four-team scenario in
the proposal: one `stuck` (out of bounds), one `stuck` (idle + GPS silent), one `watch` (lockout),
and the working team stays clean.

### D4 — Rendering

The teams panel header gains `rc.attentionCount({ n })` when `n > 0`. Each affected row gains one
`Badge` under the status line — `red` for `stuck`, `gold` for `watch` — whose text is the joined
reason labels. This reuses the exact pattern of tonight's out-of-bounds badge, one row above it in the
same block. `outOfBounds` keeps its own dedicated line and its "let back in" button, so the badge does
not duplicate it: when `outOfBounds` is the *only* reason, the badge is suppressed and the existing
line stands alone.

No layout change, no new component, no new dependency, no new state. `dir="auto"` stays on the team
name; the badge uses static Tailwind classes and the logical `mt-1` spacing already used there.

## Risks / Trade-offs

- **Under-flagging is chosen deliberately.** A team stuck for 11 minutes with a live GPS and no
  lockout gets no badge. That is the intended trade against alarm fatigue.
- **`updatedAt` is a proxy, not ground truth.** It measures "last server write for this team", which
  is what the organizer cares about (progress), but a team thinking hard about a puzzle looks the same
  as a team lost. The relative-to-median rule is the mitigation; the reason text is the disclosure.
- **The extra `teamLocations` read** adds one collection scan to a poll. The call already scans
  `teams`; the location collection is the same cardinality and holds one small document per team.
- **Median can be gamed by the field itself.** If most of the field is stuck for the same reason, the
  median rises and the classifier goes quiet. That is intentional: a whole-field problem is a run
  problem, visible in the standings and the alert panel, not a per-team badge.

## Migration Plan

Additive only. The three new `RunTeamRow` fields are optional; older team documents and older backends
degrade to fewer reasons. No document shape changes, no backfill, no flag.

## Test Strategy

**Pure-logic lane — `apps/creator-web/src/lib/__tests__/teamAttention.test.ts` (vitest, node env,
picked up by the existing `apps/creator-web/vitest.config.ts` include, run by `npm test`).** Fixtures
only, `nowMs` injected, no clock reads.

Required cases, RED first:

1. **Healthy team mid-task** — launched, started 40 min ago, `updatedAt` 4 min ago, GPS 1 min ago, no
   lockout ⇒ `ok`, empty reasons.
2. **Idle far beyond the field median** — median 3 min, team idle 30 min ⇒ `stuck` with `idle`.
3. **Idle but the whole field is slow** — median 20 min, team idle 30 min ⇒ `ok` (30 < 4 × 20).
4. **Out of bounds** ⇒ `stuck` with `outOfBounds`, regardless of a perfectly healthy idle/GPS.
5. **Answer lockout** — 6 min remaining ⇒ `watch` with `answerLockout`; 30 s remaining ⇒ `ok`;
   12 min remaining ⇒ `stuck`.
6. **No location ping for a long window** — GPS 20 min old, idle 5 min ⇒ `watch` with `gpsSilent`;
   GPS 40 min old *and* idle 30 min ⇒ `stuck` with both reasons.
7. **Absent GPS entirely** (`lastLocationAt` undefined/null) ⇒ never contributes a reason.
8. **Finished team** — `finished: true`, `updatedAt` two hours old, GPS three hours old ⇒ `ok`.
9. **Brand-new team** — launched 2 min ago with a stale-looking `updatedAt` ⇒ `ok`.
10. **Not launched** — waiting in the lobby for an hour ⇒ `ok`.
11. **Missing / `NaN` / garbage timestamps** — `updatedAt` absent, `''`, `'not-a-date'`; a `NaN`
    `answerLockoutUntil` ⇒ `ok`, no throw.
12. **Clock skew** — every timestamp in the browser's future ⇒ `ok`, no negative durations.
13. **`pendingReviews`** — alone on a healthy team ⇒ `ok`; on an already-flagged team ⇒ appended as an
    explanatory reason without changing the level.
14. **`buildAttentionContext`** — ignores finished / unlaunched / unparsable rows; returns `null`
    below `MIN_TEAMS_FOR_MEDIAN`; even and odd counts.
15. **Totality invariant** — a matrix over every field being present / absent / `NaN` / negative /
    `Infinity`: never throws, `level` is always one of the three, `reasons` is always a subset of the
    known set, and `reasons.length === 0` iff `level === 'ok'`.
16. **`countTeamsNeedingAttention`** — matches the per-row classification on a mixed table.

**e2e assertions that WOULD be added** (`scripts/e2e-verify.mjs` is owned by another lane and is not
edited here; recorded so they can be picked up):
- In the lifecycle scenario, after the first `completeTask`, assert `listRunTeams` rows now carry
  `updatedAt` as a parsable ISO string and that `lastLocationAt` and `answerLockoutUntil` are present
  as `string|null` / `number|null` rather than `undefined`.
- In the wrong-answer-cost scenario, after driving a team into a retry lockout, assert its row's
  `answerLockoutUntil` is a finite number greater than `Date.now()`.
- In the safe-zone scenario, assert `outOfBounds: true` and `lastLocationAt` non-null coexist on the
  same row.
- Add `updatedAt`, `answerLockoutUntil`, `lastLocationAt` to whatever `listRunTeams` row-shape
  allowlist the sanitizer guard applies, so a future projection addition still fails loud.

**UI** — verified by reading only; no browser tools are permitted while the playtest stack is live.
This is recorded as unverified in the change report.

**Gates run:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
`npm run play:build`, `npm run bundle:budget`, `npm run i18n:check:strict`. Emulator gates (`e2e`,
`verify:emulator`, `test:rules`, `simulate`) are deliberately **not** run.

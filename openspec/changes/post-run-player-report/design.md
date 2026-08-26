## Context

Three things are true today and each one blocks the ask:

1. **Post-run analysis is trapped inside the live console.** `getRunAnalytics`, `getRunSummary`,
   `getRunRecap` and `getRunHeatmap` all resolve a run by **access code**
   (`accessCodes/{CODE}` → `{ownerUid, gameId, runId}`), and the only surface that holds one is
   `RunConsolePage`, reached at `/run/:gameId/:runId` from `useLiveRuns` — a callable
   (`listLiveRuns`) that filters `status == 'live'`. A finished run therefore falls off every
   navigation path the console has. The Dashboard's 🏁 *"סה״כ ריצות"* tile
   (`DashboardPage.tsx:805`, summing `Game.playCount`) is a plain `div`.
2. **There is no per-player analysis anywhere.** `computeRunAnalytics` is deliberately anonymous
   ("MUST aggregate anonymously — no team-level PII", `openspec/specs/run-analytics/spec.md`), and
   `listRunTeams` returns one summary row per team with no mission detail.
3. **Answers are not stored on an ordinary run.** `RunTaskRecord.submittedAnswer` / `wasCorrect`
   exist, but `functions/src/runs/index.ts:4733` writes them **only** when
   `sealsScoreFromParticipant(game)` is true. On every other run `submitTaskAnswer` grades the
   answer, may charge for it, and discards the text. `submitSequenceStep` never records one at all
   (`runs/index.ts:5029` says so explicitly — one verdict slot per record).

Constraints that shape everything below: run/team documents are **server-write-only**; the
participant reads their team document **whole** through `getMyTeamState`, so
`sanitizeTeamForParticipant` (an allow-list, `packages/shared/src/testMode.ts:71`) is the only thing
between a new field and a player's devtools; Firestore arrays must be rewritten wholesale, never
dotted-updated; and the 2026-08-26 exam run already hit `RESOURCE_EXHAUSTED` on write quota, so a
new per-submission write has to be justified and bounded.

## Goals / Non-Goals

**Goals:**
- Record what each participant actually submitted, on every run, with the verdict the server acted on.
- Destroy that text automatically after 30 days, without touching scores or timings.
- Let a creator reach any past run of any game from the Dashboard, a game card, or the Builder.
- Give the creator a readable per-player analysis and one `.xlsx` workbook covering
  player × mission × answer.
- Add zero risk to the live grading path: same acceptances, same refusals, same penalties.

**Non-Goals:**
- Backfilling answers for runs already played (the data was never written).
- Any participant-visible change; `testMode`'s seal is untouched.
- Server-side file generation, emailing the workbook, or cross-run exports.
- Changing `computeRunAnalytics`, ranking, routing, or the wrong-answer cost curve.

## Decisions

### D1 — A new `answerLog` array on `RunTaskRecord`, not a reuse of `submittedAnswer`

`submittedAnswer`/`wasCorrect` are singular ("one verdict slot per task record") and are documented
as the test-mode recording. The ask is *every* answer, including the wrong ones that are the
interesting half of an educational run. So `packages/shared/src/answerLog.ts` introduces:

- `AnswerLogKind` = `answer` | `ordering` | `sequence_step` | `station_code` | `survey`
- `AnswerLogEntry` = `{ at: string; answer: string; correct?: boolean; kind: AnswerLogKind; stepIndex?: number }`
  — `at` is the server ISO instant, `answer` is trimmed and truncated, `correct` is omitted where
  there is no right answer (a survey), `stepIndex` is present only for sequence steps.

added as `RunTaskRecord.answerLog?: AnswerLogEntry[]`. `submittedAnswer`/`wasCorrect` keep their
current meaning and their test-mode writes, untouched — `accuracySkillRatio` reads `wasCorrect` and
a broader write there would silently change routing on sealed runs.

*Alternative rejected:* a run-level `answerLogs` subcollection. One document per submission is the
cleanest model and dodges the array rewrite, but it multiplies document writes on the hot path and
adds an N-document read to the report, against the same quota that already blew up once.

### D2 — Bounded by construction, with a middle-drop cap

`MAX_ANSWER_LOG_ANSWER_LEN = 200`, `MAX_ANSWER_LOG_ENTRIES = 6`. Worst case is roughly 1.4 KB per
mission — a 40-mission game stays far under the 1 MB document limit even if every mission is
brute-forced. `appendAnswerLog(existing, entry)` keeps the **oldest N-1** entries plus the
**newest**, dropping from the middle, because the two entries a creator actually wants are the first
guess and the one that finally landed. Pure and total: a malformed `existing`, a non-string answer,
or an empty string returns a valid array (unchanged) rather than throwing — this runs inside the
grading transaction and a throw there would fail a legitimate submission.

*Alternative rejected:* `FieldValue.arrayUnion`. It would make the cheap wrong-answer path a
merge-set instead of a transaction, but it is unbounded — exactly the failure mode the caps exist for.

### D3 — Write from the decision that already graded, never a second pass

Five call sites, each writing the verdict it just computed:

| Site | Where the write rides | Entry |
|---|---|---|
| `runs/index.ts` `submitTaskAnswer` sealed path (~4733) | the existing `extras` | `kind: answer`/`ordering`, `correct` = `correctSealed` |
| `submitTaskAnswer` correct path (~4942) | new `extras` on `completeTaskForTeam` | `correct: true` |
| `submitTaskAnswer` wrong, cost active (~4874) | inside the existing transaction | `correct: false` |
| `submitTaskAnswer` wrong, no cost (~4857) | the counter merge-set becomes a transaction | `correct: false` |
| `submitSequenceStep` (~5029) and `verifyStationCode` (`functions/src/index.ts`) | the existing team write | `kind: sequence_step` + `stepIndex`, `kind: station_code` |

`completeTaskForTeam`'s `extras` gains `answerLog?: AnswerLogEntry` and appends it inside the
transaction that already rewrites the stage array — no new read, no new transaction on the completion
path. The **replay guard** returns before any of this, so a double-tap records nothing (spec'd).

The one genuine cost increase is the fourth row: a wrong answer on a task with no attempt limit, no
hint escalation and no wrong-answer cost used to be a single `FieldValue.increment` merge-set (or,
with `trackAttempts` false, no write at all), and now needs read-modify-write of the stage array.
Accepted, and bounded by the caps and by the existing `submitTaskAnswer` rate limit.

### D4 — Retention reuses the existing pure predicate rather than inventing a second clock

`evaluateRunPrune(facts, now, days)` (`functions/src/maintenance/runRetention.ts`) already encodes
every hard-won rule: anchor a finalized run on `finishedAt`, anchor anything else on the **maximum**
of all its timestamps so one recent write vetoes destruction, refuse on clock skew, fail closed. The
answer-log sweep calls the **same function** with `days = ANSWER_LOG_RETENTION_DAYS` (30) and its own
tombstone, passed by substituting `answerLogPrunedAt` into the `piiPrunedAt` slot of the facts
object, so the safety invariant cannot drift between the 30-day and the 90-day sweep.

Stripping is `stripAnswerLogsFromStages(stages)` (pure, in shared), applied per team document; the
run is then stamped `answerLogPrunedAt`. `pruneRunPII` performs the same strip and stamp, so the
90-day prune is a superset of the 30-day one. Wired into `pruneExpiredRunData` (the daily schedule),
`pruneExpiredRunDataNow` and `pruneRunNow`. No new index: the sweep reuses the two collection-group
queries the PII sweep already runs, widened to the shorter cutoff.

### D5 — Two callables, addressed by ids, not by access code

- `listMyRuns({ gameId?, limit? })` — collection-group `runs` filtered `ownerUid == uid`, sorted
  newest-first in memory, capped (default 100), dropping runs of tombstoned games. The same
  ownership + `isGameDeleted` shape `listLiveRuns` uses, minus the status filter, so **no new index**.
- `getRunPlayerReport({ gameId, runId })` — owner-only (the run document's own `ownerUid`, the same
  gate `listRunTeams` uses), refuses a tombstoned game via `assertGameNotDeleted`, reads game + run +
  teams and returns `buildRunPlayerReport(...)`.

Addressing by `{gameId, runId}` rather than by code is the point: an access code is revoked when a
game is trashed and is not something a creator still holds weeks later.

### D6 — The report is a pure builder in shared

`packages/shared/src/runPlayerReport.ts` — `buildRunPlayerReport({ game, run, teams })` returning
`{ meta, players, answers, missions }`. Pure and total (the report must survive one malformed team),
clock-free, and a function of the **stored** documents: rank comes from `run.leaderboard` when it
exists so the report and the standings players saw cannot disagree, and falls back to a
score-then-time ordering marked `provisional`. Missions are named from the game template but every
row is keyed by the **stored** `taskId`, so a mission deleted since the run still produces a row.

`answersUnavailable` is set when the mission type *has* an answer channel but the record carries no
`answerLog` and no `submittedAnswer` — the honest way to say "played before we recorded, or older
than 30 days" instead of rendering an ambiguous blank.

### D7 — `write-excel-file`, dynamically imported

Chosen over `xlsx` (npm's SheetJS is frozen at 0.18.5 with open advisories) and `exceljs` (~1 MB, a
Node-shaped API). `write-excel-file` is small, maintained, and writes multi-sheet workbooks with
column widths from a plain row model. It is reached **only** through
`await import('write-excel-file')` inside the export handler, so it is absent from the entry chunk
and from every route but this one. The row model itself
(`apps/creator-web/src/lib/runReportExport.ts`) is pure and unit-tested; the library call is a thin
shell around it, mirroring how `adminUsersExport.ts` keeps CSV escaping pure.

### D8 — Two routes, one history surface

`/history` (optionally `?game=<id>`) and `/report/:gameId/:runId`, both mounted through
`lib/lazyWithRetry.ts` like every other route. `/history` serves both entry points rather than
shipping a per-game page and an all-games page. Live rows route to `/run/:gameId/:runId`, finished
rows to `/report/:gameId/:runId`.

## Test strategy

| Lane | What it proves | Where |
|---|---|---|
| pure | caps, truncation, middle-drop, totality of `appendAnswerLog`; `stripAnswerLogsFromStages` preserves scores; the 30-day boundary to the millisecond | `scripts/test-answer-log.ts` |
| pure | `buildRunPlayerReport`: malformed team, orphaned task record, `answersUnavailable` vs. no-answer-channel, leaderboard rank reuse, provisional flag | `scripts/test-run-player-report.ts` |
| pure | workbook row model: three sheets, header rows, Hebrew passthrough, multi-answer flattening, blank-vs-unavailable rendering | `scripts/test-run-report-export.ts` |
| pure | `answerLog` is still absent from the participant payload, sealed and unsealed | extend `scripts/test-test-mode.ts` |
| e2e | RED first: `listMyRuns` returns a finished run; `getRunPlayerReport` returns the recorded answer for a wrong **and** a correct submission; both refuse a non-owner (added to the authz denial matrix); grading responses unchanged | `scripts/e2e-verify.mjs` — **required**, the callable coverage guard fails a callable with no scenario |
| build | `write-excel-file` stays out of the creator entry chunk | inspect `npm run creator:build` chunk output — creator-web has no automated byte budget, so this is a named task, not an assumption |
| UI | history lists a finished run, report renders per-player missions, export downloads a workbook | preview tools + `npm run i18n:check:strict` (all copy through `t.*`, HE+EN) |

## Risks / Trade-offs

- **[A wrong answer now costs a transaction where it once cost an increment]** → bounded by the
  existing `submitTaskAnswer` rate limit and by `MAX_ANSWER_LOG_ENTRIES`; the transaction is only
  taken when there is something new to record, and the correct-answer/completion path adds no read.
- **[Free-typed participant text now lives on the team document]** → it is server-write-only, absent
  from the participant allow-list by construction (pinned by a test), owner-gated on read, and
  destroyed at 30 days by a sweep that reuses the fail-closed retention predicate. The report page
  states the window.
- **[A retention sweep that is too broad destroys data mid-run]** → nothing is destroyed because a
  query matched; `evaluateRunPrune` re-decides from the document's own fields and anchors an
  unfinalized run on the maximum of its timestamps, so one recent write vetoes the strip.
- **[Existing runs will show no answers and read as broken]** → `answersUnavailable` is explicit in
  the payload and rendered as "not recorded" in the UI and in the workbook, never as an empty cell.
- **[A new dependency in the creator bundle]** → dynamic import only; if it ever leaks into the entry
  chunk the creator build's chunk listing shows it.
- **[Two new callables enlarge the authz surface]** → both are owner-only on the run document's own
  `ownerUid` and both are added to the e2e authz denial matrix, not just to the happy path.

## Migration Plan

Additive throughout: a new optional field, two new callables, two new routes, one new sweep. No
Firestore index change, no rules change, no env var. Deploy order is the normal one (shared →
functions → hosting). Rollback is a functions redeploy; any `answerLog` already written is inert to
every older reader and is removed by the 30-day sweep regardless.

## Open Questions

None blocking. One deliberate deferral: the workbook covers a single run — a cross-run "all my
players" export is a separate change if it is ever wanted.

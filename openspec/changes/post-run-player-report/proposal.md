## Why

A creator finishes a run and the data evaporates. The Run Console's post-run panels
(`runSummary` / `analytics` / `feedback`) are reachable only while that console is open, keyed by an
access code the creator has to still have; nothing in the Dashboard or the Builder leads back to a
run that ended last week, and the 🏁 *"סה״כ ריצות"* tile that counts those runs is inert. Worse, for
an educational or assessment run the single most valuable artifact — **what each player actually
answered** — is not stored at all: `RunTaskRecord.submittedAnswer` / `wasCorrect` are written only on
a `testMode` game, so on every ordinary run a wrong answer is graded, charged, and then forgotten.
Creators running a class, a youth group or a bar-mitzvah quiz currently have no way to see, or hand
to anyone else, a per-player answer sheet.

## What Changes

- **Every submitted answer is recorded, on every run.** A new bounded per-mission `answerLog` on the
  team document captures each submission — right *and* wrong — for `quiz`, `numeric`, ordering
  quizzes, `sequence` steps and `smart_station` codes, with a timestamp and the server's verdict.
  Owner/server-only by construction: `sanitizeTeamForParticipant` is an allow-list, so the field is
  invisible to participants unless somebody deliberately adds it.
- **Answer text is purged after 30 days.** A new retention sweep strips `answerLog` from every team
  document of a run older than `ANSWER_LOG_RETENTION_DAYS`, independently of (and well before) the
  existing 90-day PII prune. Scores, timings and per-mission verdicts survive; the free-typed text
  does not.
- **A creator can list every run a game has ever had.** New callable `listMyRuns` — owner-scoped,
  live *and* finished, optionally filtered to one game.
- **A creator can open a finished run's full analysis.** New callable `getRunPlayerReport` —
  owner-only, returning per-player rows (score, rank, elapsed, missions completed, hints, penalties,
  media) and per-player × per-mission rows (mission title, type, the question as authored, the
  player's answer(s), ✓/✗, attempts, points, time, media URL, survey text).
- **Two new creator-web routes.** `/history` (runs across all games, or one game via `?game=`) and
  `/report/:gameId/:runId` (the readable analysis). Entry points: the Dashboard 🏁 tile becomes a
  link, each game card and the Builder header gain a "past runs" action, and the Run Console's
  after-the-run group links to the report.
- **Excel export.** A single multi-sheet `.xlsx` (players / answers / missions), generated in the
  browser with `write-excel-file`, lazy-loaded so it never enters the creator entry chunk.
- Two new callables ⇒ two typed wrappers in `apps/creator-web/src/services/calls.ts` and new
  `scripts/e2e-verify.mjs` coverage (the callable coverage guard fails a callable with no test).

### Non-goals

- **Backfilling answers for runs that already happened.** Data never written cannot be recovered; a
  pre-existing run's report shows scores, timings, statuses and media, and its answer column is
  explicitly marked "not recorded" rather than blank-and-ambiguous.
- **Showing a participant their own answer history.** The log is an organizer artifact; nothing is
  added to `getMyTeamState`, and `testMode`'s seal is untouched.
- **Changing scoring, ranking, routing or the retry/penalty rules.** The log is written beside the
  decisions those paths already make; `resolveRoutingSkillRatio` still reads accuracy only on a
  sealed game, so recording `correct` on ordinary runs cannot move routing.
- **A server-generated file.** The workbook is built client-side from the callable's rows; no
  Storage object, no email attachment, no new egress.
- Editing an answer, re-grading it, or exporting across several runs at once.

## Capabilities

### New Capabilities
- `run-player-report`: the owner-only per-run analysis — how a run's players, their per-mission
  outcomes and their recorded answers are assembled, authorized, and shaped for export.
- `answer-log`: what a participant submission records, how much of it is kept, who may ever read it,
  and when it is destroyed.
- `run-history`: how a creator finds and reopens the runs a game has already had.

### Modified Capabilities
- `answer-submission`: submitting an answer now also RECORDS it (the submission, its verdict, and
  the attempt that produced it) in addition to grading it.
- `run-analytics`: the post-run reporting surface gains a per-player and per-answer level, reachable
  after the run rather than only from a live console.

## Impact

- **Shared** (`packages/shared/src`): new `answerLog.ts` (entry shape, caps, append rule, retention
  constant, stage-stripping helper) and `runPlayerReport.ts` (the pure report builder);
  `RunTaskRecord.answerLog?` added to `types/index.ts`; both exported from the barrel.
  `testMode.ts`'s allow-list is deliberately NOT extended — that is the security property.
- **Functions**: `runs/index.ts` — `completeTaskForTeam` accepts a log entry; `submitTaskAnswer`
  (sealed, correct and both wrong paths), `submitSequenceStep` and `verifyStationCode` write one;
  new `listMyRuns` + `getRunPlayerReport` callables. `maintenance/index.ts` — new
  `sweepExpiredAnswerLogs`, wired into the daily schedule, `pruneExpiredRunDataNow` and
  `pruneRunPII`. Both callables re-exported from `functions/src/index.ts`.
- **creator-web**: new `pages/RunHistoryPage.tsx` + `pages/RunReportPage.tsx` (both lazy, via
  `lazyWithRetry`), new pure `lib/runReportExport.ts`, two routes in `App.tsx`, entry points in
  `DashboardPage` / `BuilderPage` / `RunConsolePage`, HE+EN dictionary blocks in `i18n.ts`, and a
  new `write-excel-file` dependency (dynamic import only).
- **Firestore**: no rules change (the log rides the already server-write-only team document). No new
  index — `listMyRuns` reuses the existing `runs` collection-group `ownerUid` filter.
- **Cost**: a wrong answer on a game with no attempt limit and no wrong-answer cost previously wrote
  a single counter increment (or nothing); it now costs one bounded transaction. Caps
  (`MAX_ANSWER_LOG_ENTRIES`, `MAX_ANSWER_LOG_ANSWER_LEN`) bound the team document's growth so a
  brute-forcing device cannot inflate it toward the 1 MB limit.
- **Tests**: `scripts/test-answer-log.ts`, `scripts/test-run-player-report.ts`,
  `scripts/test-run-report-export.ts` (all auto-discovered by the aggregator); a new e2e scenario
  covering both callables and the recorded-answer round trip; `scripts/test-test-mode.ts` extended to
  pin that `answerLog` is still absent from the participant payload.

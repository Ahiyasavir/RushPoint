# PLAN — run-summary-report

Implementation blueprint for `/opsx:apply`. Reuse-first: the composer folds the outputs of
`buildRunRecap`, `computeRunAnalytics`, and `computeFeedbackSummary` — it recomputes nothing.

## Exact files

| File | Change |
|---|---|
| `packages/shared/src/runSummary.ts` | NEW — `RunSummary*` types + pure `composeRunSummary` |
| `packages/shared/src/index.ts` | `export * from './runSummary'` |
| `scripts/test-run-summary.ts` | NEW — RED pure-logic test (auto-run by `npm test`) |
| `functions/src/runs/runSummaryEmail.ts` | NEW — `RUN_SUMMARY_EMAIL_ENABLED` flag + `sendRunSummaryEmail` no-op seam |
| `functions/src/runs/index.ts` | NEW internal `buildRunSummaryResult` + `getRunSummary` callable; `finalizeRun` post-commit seam call |
| `functions/src/index.ts` | re-export `getRunSummary` |
| `apps/creator-web/src/services/calls.ts` | `getRunSummary` wrapper |
| `apps/creator-web/src/pages/RunConsolePage.tsx` | `RunSummaryPanel` (finished runs) |
| `apps/creator-web/src/i18n.ts` | EN + HE `t.runConsole.summary*` keys |
| `scripts/e2e-verify.mjs` | `getRunSummary` owner + denial assertions |

## Pure composer signature

```ts
// packages/shared/src/runSummary.ts
export function composeRunSummary(input: {
  title: string; runStatus: string; finishedAt?: string; isTestDrive?: boolean;
  recap: RunRecap;               // from buildRunRecap
  analytics: RunAnalytics;       // from computeRunAnalytics
  feedback: RunFeedbackSummary;  // from computeFeedbackSummary
}): RunSummary
```

`RunSummary = { title, runStatus, finishedAt?, isTestDrive, standings[], completion, feedback }`
- `standings[]` ← `recap.standings` mapped 1:1 (rank, teamId, teamName, score, totalSeconds?)
- `completion` ← `{ teamCount, photoCount, winnerName }` from `recap.stats` + `tasksTracked =
  analytics.tasks.length` + `overallCompletionRate = analytics.overallCompletionRate`
- `feedback` ← `{ responseCount, participantCount, responseRate, recommendScore, commentCount }` from
  the feedback summary + `topIssues = Object.entries(feedback.issueCounts).sort(desc).slice(0,3)`

### RED assertions (`scripts/test-run-summary.ts`)
1. Standings pass through in input order; `score` and `totalSeconds` unchanged.
2. `completion.overallCompletionRate === analytics.overallCompletionRate` and
   `completion.tasksTracked === analytics.tasks.length`; `teamCount/photoCount/winnerName === recap.stats.*`.
3. `feedback.topIssues` = issueCounts sorted descending, length ≤ 3 (feed 4 issues → 3 returned,
   ordered by count).
4. Empty feedback (`responseCount:0`, `issueCounts:{}`) → `responseRate:0`, `recommendScore:0`,
   `topIssues:[]`, and NO `NaN` anywhere.
5. `JSON.stringify(composeRunSummary(...))` does not throw.

RED because `packages/shared/src/runSummary.ts` does not exist yet.

## `getRunSummary` callable + its e2e scenario

- **Callable** (owner-only by access code, mirrors `getRunAnalytics`): resolve `accessCodes/{CODE}` →
  `{ownerUid, gameId, runId}`; `uid !== ownerUid` ⇒ `permission-denied`. Read game/run/teams/feedback
  docs (one `Promise.all`), then `buildRunSummaryResult(game, run, teams, responses)` →
  `composeRunSummary`. `participantCount = Σ team.deviceUids?.length ?? 1` (same rule as
  `getRunFeedbackSummary`). Re-export from `functions/src/index.ts`.
- **E2E scenario** (`scripts/e2e-verify.mjs`, in/after the finished-run recap scenario — the main run
  is already finalized + published there):
  ```js
  const summary = await creator.call('getRunSummary', { code: accessCode });
  check('summary: owner gets standings', (summary?.standings?.length ?? 0) > 0);
  check('summary: completion rate numeric', typeof summary?.completion?.overallCompletionRate === 'number');
  check('summary: feedback digest present', summary?.feedback && Array.isArray(summary.feedback.topIssues));
  let denied = false;
  try { await recapViewer.call('getRunSummary', { code: accessCode }); }
  catch (e) { denied = e.code === 'functions/permission-denied'; }
  check('summary: non-owner denied', denied);
  ```
  This invocation is what keeps the **callable-coverage guard** at 100% (a new callable ships RED
  until an e2e scenario calls it).

## Creator panel wiring + i18n (EN + HE)

`RunSummaryPanel({ accessCode })` in `RunConsolePage.tsx`, rendered `{finished && ...}` alongside
`AnalyticsPanel`/`FeedbackPanel`. Load via `getRunSummary({ code: accessCode })` (same
`useEffect`/`alive`/error pattern as `AnalyticsPanel`, error → `t.runConsole.analyticsError`). Shows:
- **Standings** — top rows: rank · teamName · score.
- **Completion** — `teamCount` teams · `Math.round(overallCompletionRate*100)`% · `photoCount` photos.
- **Feedback digest** — response rate, recommend %, `topIssues` chips, comment count.
- **Email note** — one line: the summary will also be emailed to the creator once email is enabled.

New i18n keys (add to BOTH `he` and `en` in `i18n.ts`, no hardcoded strings):
`summaryTitle`, `summaryEmailNote`, `summaryStandings`, `summaryCompletion`, `summaryFeedback`,
`summaryTeams`, `summaryCompletionRate`, `summaryPhotos`, `summaryNoData`. HE values must be pure
Hebrew, EN pure English (brand tokens like `RushPoint` allowed). Run `npm run i18n:check` after.

## Email: actually send the summary to the creator (revised per user)

The creator wants the post-run summary (standings + analytics + feedback/reviews) **emailed** to them
after each run. Build a real send path that works the moment a provider credential is present, and is a
graceful no-op otherwise. NEVER hardcode a secret; the credential lives only in `functions/.env`.

`packages/shared/src/runSummary.ts` (pure, unit-tested):
- `export function formatRunSummaryEmail(summary: RunSummary): { subject: string; text: string }` —
  composes a plain-text email body (title, final standings, completion stats, feedback digest + top
  issues + comments count). Deterministic, no non-finite numbers (guarded), `JSON`/string-safe.

`functions/src/runs/runSummaryEmail.ts`:
- Recipient resolution: `RUN_SUMMARY_EMAIL_TO` env override, else the game owner's `users/{uid}.email`.
- Provider: an HTTP email API keyed by env — `RESEND_API_KEY` (+ optional `RUN_SUMMARY_EMAIL_FROM`,
  default `onboarding@resend.dev`). One `fetch('https://api.resend.com/emails', …)` — no npm dep, no
  SMTP socket. `RUN_SUMMARY_EMAIL_ENABLED` defaults **ON** (`!== 'false'`); a run only sends when a
  provider key AND a recipient are present.
- `export async function sendRunSummaryEmail(summary, recipient): Promise<void>` — try/catch wrapped,
  NEVER throws: no key/recipient → `logBestEffort('runSummary.email.skipped'/'noProvider', …)` with the
  composed subject (so it's visible in logs even without a provider); key present → send, log ok/fail.
- **No secret in code; no real send in tests** — the emulator/e2e env has no `RESEND_API_KEY`, so the
  send branch is never entered under test (it logs-and-returns). A pure test covers the formatter only.

**Call site:** `finalizeRun`, AFTER the `runRef.update` commit and the player-profile/benchmark
best-effort blocks (strictly last), inside its own `try/catch → logBestEffort('finalize.runSummaryEmail')`.
Recipient resolved as above. NOT inside any transaction; `finalizeRun`'s return shape (`{ rankings }`)
is unchanged.

**Setup the user must do (cannot be automated — entering an API key is the user's action):** add
`RESEND_API_KEY=…` (from resend.com, free tier) to `functions/.env`; optionally
`RUN_SUMMARY_EMAIL_TO=spendora.tracker@gmail.com` and `RUN_SUMMARY_EMAIL_FROM=…`. Then every finalized
run emails the summary. Document this in DEPLOY.md / the change proposal.

## Gates (all green before done)

`npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` · `npm run play:build` ·
`npm run i18n:check` · `npm run e2e`.

Order: RED test (`npm test` shows it fail) → shared helper + `shared:build` (GREEN) → seam + callable +
finalize wiring → re-export → creator panel + i18n (`i18n:check`) → e2e scenario → full gate sweep.

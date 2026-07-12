# Design: run-summary-report

## Files touched

### 1. Pure composer — `packages/shared/src/runSummary.ts` (new)

Dependency-free; consumes the results of the three existing aggregators and folds them into one
`RunSummary`. It NEVER recomputes standings/scores/timing — it only reshapes and digests.

```ts
import type { RunRecap } from './runRecap';
import type { RunAnalytics } from './runAnalytics';
import type { RunFeedbackSummary } from './types';

export interface RunSummaryStanding {
  rank: number; teamId: string; teamName: string; score: number; totalSeconds?: number;
}
export interface RunSummaryCompletion {
  teamCount: number;              // recap.stats.teamCount
  photoCount: number;             // recap.stats.photoCount
  tasksTracked: number;           // analytics.tasks.length
  overallCompletionRate: number;  // analytics.overallCompletionRate (0..1, never NaN)
  winnerName?: string;            // recap.stats.winnerName
}
export interface RunSummaryFeedbackDigest {
  responseCount: number;
  participantCount: number;
  responseRate: number;           // 0..1
  recommendScore: number;         // 0..1
  commentCount: number;
  topIssues: { issue: string; count: number }[]; // desc by count, max 3
}
export interface RunSummary {
  title: string;
  runStatus: string;
  finishedAt?: string;
  isTestDrive: boolean;
  standings: RunSummaryStanding[];
  completion: RunSummaryCompletion;
  feedback: RunSummaryFeedbackDigest;
}

export interface ComposeRunSummaryInput {
  title: string;
  runStatus: string;
  finishedAt?: string;
  isTestDrive?: boolean;
  recap: RunRecap;
  analytics: RunAnalytics;
  feedback: RunFeedbackSummary;
}

export function composeRunSummary(input: ComposeRunSummaryInput): RunSummary {
  const { recap, analytics, feedback } = input;
  const topIssues = Object.entries(feedback.issueCounts ?? {})
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return {
    title: input.title,
    runStatus: input.runStatus,
    finishedAt: input.finishedAt,
    isTestDrive: input.isTestDrive ?? false,
    standings: recap.standings.map((s) => ({
      rank: s.rank, teamId: s.teamId, teamName: s.teamName,
      score: s.score, totalSeconds: s.totalSeconds,
    })),
    completion: {
      teamCount: recap.stats.teamCount,
      photoCount: recap.stats.photoCount,
      tasksTracked: analytics.tasks.length,
      overallCompletionRate: analytics.overallCompletionRate,
      winnerName: recap.stats.winnerName,
    },
    feedback: {
      responseCount: feedback.responseCount,
      participantCount: feedback.participantCount,
      responseRate: feedback.responseRate,
      recommendScore: feedback.recommendScore,
      commentCount: feedback.commentCount,
      topIssues,
    },
  };
}
```

`packages/shared/src/index.ts` — `export * from './runSummary'`.

### 2. Callable — `getRunSummary` in `functions/src/runs/index.ts` (new)

Owner-only, resolved by access code — mirrors `getRunAnalytics` exactly (same code lookup + owner
gate). It reads the docs the existing aggregators need, calls each aggregator, then `composeRunSummary`:

```ts
export const getRunSummary = loggedCallable('getRunSummary', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  const { code } = data as { code: string };
  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');

  const codeSnap = await db.doc(`accessCodes/${code.trim().toUpperCase()}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const c = codeSnap.data() as AccessCode;
  if (uid !== c.ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'Summary is organizer-only');
  }

  const [gameSnap, runSnap, teamsSnap, fbSnap] = await Promise.all([
    db.doc(gamePath(c.ownerUid, c.gameId)).get(),
    db.doc(runPath(c.ownerUid, c.gameId, c.runId)).get(),
    db.collection(teamsCol(c.ownerUid, c.gameId, c.runId)).get(),
    db.collection(feedbackCol(c.ownerUid, c.gameId, c.runId)).get(),
  ]);
  const game = gameSnap.exists ? (gameSnap.data() as Game) : null;
  const run = runSnap.exists ? (runSnap.data() as Run) : null;
  const teams = teamsSnap.docs.map((d) => d.data() as RunTeam);
  const responses = fbSnap.docs.map((d) => d.data() as RunFeedback);

  return buildRunSummaryResult(game, run, teams, responses); // shared helper below
});
```

To keep the callable and the finalize seam from duplicating the assembly, extract an internal
(non-exported, non-callable) `buildRunSummaryResult(game, run, teams, responses)` in this module that
runs the three aggregators + `composeRunSummary`:

```ts
function buildRunSummaryResult(game, run, teams, responses) {
  const gameTasks = (game?.stages ?? []).flatMap((s) => s.tasks).map((t) => ({ id: t.id, type: t.type }));
  const participantCount = teams.reduce((n, t) => n + (t.deviceUids?.length ?? 1), 0);
  return composeRunSummary({
    title: game?.branding?.name ?? game?.title ?? 'RushPoint',
    runStatus: run?.status ?? 'live',
    finishedAt: run?.finishedAt,
    isTestDrive: run?.isTestDrive ?? false,
    recap: buildRunRecap(teams, run ?? { leaderboard: undefined }),
    analytics: computeRunAnalytics(teams, gameTasks),
    feedback: computeFeedbackSummary(responses, participantCount),
  });
}
```

`buildRunRecap`, `computeRunAnalytics`, `computeFeedbackSummary` are already imported in this module
(computeFeedbackSummary from `./feedbackSummary`, the two others from `@rushpoint/shared`). Re-export
`getRunSummary` from `functions/src/index.ts` alongside `getRunRecap`/`getRunAnalytics`.

### 3. Email seam — `functions/src/runs/runSummaryEmail.ts` (new)

One well-defined send function behind a flag. **No provider, no network.** Default OFF ⇒ a
`logBestEffort` breadcrumb only. The whole body a future provider change replaces is the `if (enabled)`
branch — the signature and the finalize call site never change again.

```ts
import type { RunSummary } from '@rushpoint/shared';
import { logBestEffort } from '../obs/log';

/** Master switch for outbound run-summary email. Default OFF until a mail
 *  provider is configured (blocked on external setup). Flip via env so no code
 *  change is needed to enable, once a provider fills in the send body. */
export const RUN_SUMMARY_EMAIL_ENABLED = process.env.RUN_SUMMARY_EMAIL_ENABLED === 'true';

/** The single seam. Best-effort; never throws. While disabled it is a no-op that
 *  records what WOULD have been sent, so the wiring is observable pre-provider. */
export async function sendRunSummaryEmail(
  summary: RunSummary,
  recipient: string | null | undefined,
): Promise<void> {
  try {
    if (!RUN_SUMMARY_EMAIL_ENABLED || !recipient) {
      logBestEffort('runSummary.email.skipped',
        { to: recipient ?? null, title: summary.title, enabled: RUN_SUMMARY_EMAIL_ENABLED }, 'disabled');
      return;
    }
    // Intentionally not implemented: a follow-up change plugs a real provider in
    // here (build the message from `summary` and dispatch). Until then, enabling
    // the flag without a provider is still a safe no-op breadcrumb.
    logBestEffort('runSummary.email.noProvider', { to: recipient, title: summary.title }, 'no provider wired');
  } catch (e) {
    logBestEffort('runSummary.email.failed', { title: summary.title }, e);
  }
}
```

### 4. `finalizeRun` post-commit seam call

After the existing `runRef.update({ status:'finished', ... })` commit **and after** the best-effort
player-profile / benchmark blocks (so it is last and cannot affect them), add a best-effort call —
NOT inside any transaction:

```ts
// Run summary email seam (change: run-summary-report). Best-effort, post-commit:
// compose the summary from the just-written standings + feedback and hand it to
// the single email seam. Disabled by default (no provider) so this is a no-op
// breadcrumb; never allowed to affect finalize.
try {
  const feedbackSnap = await db.collection(feedbackCol(uid, gameId, runId)).get();
  const responses = feedbackSnap.docs.map((d) => d.data() as RunFeedback);
  const summary = buildRunSummaryResult(game, { ...run, status: 'finished', finishedAt: now, leaderboard: { rankings, frozen: false, published: true, updatedAt: now } }, teams, responses);
  const ownerSnap = await db.doc(`users/${uid}`).get();
  const recipient = (ownerSnap.data() as { email?: string } | undefined)?.email ?? null;
  await sendRunSummaryEmail(summary, recipient);
} catch (e) {
  logBestEffort('finalize.runSummaryEmail', { runId }, e);
}
```

The `run` object passed in is the pre-update snapshot spread with the fields finalize just wrote, so
the composed summary matches what participants now see. `rankings`, `game`, `teams`, `now` are already
in scope in `finalizeRun`.

### 5. Creator UI — Run Summary panel

`apps/creator-web/src/services/calls.ts`:
```ts
import type { RunSummary } from '@rushpoint/shared';
export const getRunSummary = callable<{ code: string }, RunSummary>('getRunSummary');
```

`apps/creator-web/src/pages/RunConsolePage.tsx` — add `{finished && <RunSummaryPanel accessCode={run.accessCode} />}`
near the other finished-run panels. The panel mirrors `AnalyticsPanel`'s load pattern
(`getRunSummary({ code: accessCode })`, error surfaced via `t.runConsole.analyticsError`), and shows:
podium standings (rank · name · score), a completion headline (teams · completion % · photos), and
a feedback digest (response rate, recommend %, top issues, comment count), plus a one-line note that
the summary will also be emailed once email is enabled (routed through a new i18n key). All labels via
`t.*` (EN + HE) — new keys `t.runConsole.summaryTitle`, `summaryEmailNote`, `summaryStandings`,
`summaryCompletion`, `summaryFeedback`, etc. Run `npm run i18n:check` (PART A hard gate; zero new
PART B) after the UI edit.

## Test strategy

- **Pure composer (`scripts/test-run-summary.ts`, tsx, no emulator, auto-run by `npm test`):** feed
  synthetic `recap` / `analytics` / `feedback` objects and assert `composeRunSummary`:
  (a) passes standings through in order with score + totalSeconds intact;
  (b) reuses `analytics.overallCompletionRate` / `analytics.tasks.length` and `recap.stats` verbatim
  (no recomputation);
  (c) sorts `feedback.issueCounts` into `topIssues` descending and caps at 3;
  (d) an empty-feedback run yields `responseCount:0`, `responseRate:0`, `topIssues:[]` with no NaN;
  (e) the whole result `JSON.stringify`s without throwing. RED before the helper exists.
- **E2E (`scripts/e2e-verify.mjs`, `npm run e2e`):** in the finished-run recap scenario (or a new
  adjacent scenario), after finalize call `getRunSummary({ code: accessCode })` as the owner and
  assert it returns non-empty `standings`, a `completion` block with a numeric `overallCompletionRate`,
  and a `feedback` digest; then assert a non-owner anonymous caller is `permission-denied`. This
  invokes the new callable so the **callable-coverage guard stays green** (a new callable ships RED
  until it has an e2e scenario).

## Gates

`npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` · `npm run play:build` ·
`npm run i18n:check` · `npm run e2e` — all green.

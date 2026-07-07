# Design — survey-tasks

## Data model

**`TaskType`** (packages/shared/src/types/index.ts:129) gains `'survey'`:
```ts
export type TaskType = 'field' | 'smart_station' | 'photo' | 'self_report'
                     | 'quiz' | 'numeric' | 'geofence' | 'sequence' | 'survey';
```

**`Task.surveyChoices?: string[]`** — 2–8 non-empty options ⇒ single-pick;
ABSENT ⇒ free-text. Doc comment: NOT a secret (no right answer) — the sanitizer
passes it through; mutually exclusive with `answers`/`orderItems`/`numericAnswer`.

**Team task record** (`RunTeam.stages[].tasks[]`) gains
`surveyResponse?: string` — the team's own submitted response (trimmed, ≤ 500).
Server-write-only like the whole team doc; not secret to its own team, so it
flows through `getMyTeamState` unchanged.

## Pure validation (packages/shared/src/survey.ts)

```ts
export const SURVEY_RESPONSE_MAX_LEN = 500;
export const SURVEY_CHOICES_MIN = 2;
export const SURVEY_CHOICES_MAX = 8;

// null = invalid. Trims; rejects empty / >500 chars; when `choices` is a
// non-empty array the trimmed response must exactly equal one of the choices
// (keeps the per-choice aggregation clean — the UI only sends button values
// anyway; a hand-crafted payload gets a loud invalid-argument, not a bucket
// of garbage). Free-text (no choices): any non-empty trimmed string ≤ 500.
export function validateSurveyResponse(
  response: unknown,
  choices?: string[],
): string | null;
```
Dependency-free, mirrors `ordering.ts`/`gating.ts` siblings. Authoring-side rule
(`updateGame` already schema-checks tasks): `surveyChoices`, when present, must
be 2–8 non-empty strings.

## Server — submitTaskAnswer (functions/src/runs/index.ts:2194)

The type gate `task.type !== 'quiz' && task.type !== 'numeric'` (line 2212)
admits `'survey'`. New branch BEFORE the ordering checks:

```ts
if (task.type === 'survey') {
  const resp = validateSurveyResponse(answer, task.surveyChoices);
  if (resp == null) throw new functions.https.HttpsError('invalid-argument', 'Valid survey response required');
  await completeTaskForTeam(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now, { surveyResponse: resp });
  await releaseTask(...); const next = await assignNextInActiveStage(...);   // same tail as the quiz path
  return { correct: true, nextTaskId: next.taskId ?? null };
}
```
No wrong-answer path, so `taskAttempts` / attempt-limit / hint-escalation
tracking never fires for a survey. `assertTaskNotExpired` still applies (it runs
before the branch). Surveys never carry `orderedAnswer`.

**`completeTaskForTeam` (line 497)** gains an optional trailing
`extras?: { surveyResponse?: string }`. Inside the EXISTING transaction (repo
lesson: never add a transaction to this hot path), when writing the task record
to `completed`, also set `taskRec.surveyResponse = extras.surveyResponse` —
same object rewrite the record already gets, zero extra reads/writes. The
existing `status === 'completed'` early-return guard makes a duplicate
submission an idempotent no-op: the first response is final and is never
overwritten. Points: the record's normal `earnedScore` path applies unchanged
(fixed `pointValue`, default 0 recommended in the editor).

## Sanitizer (functions/src/runs/sanitizeTask.ts)

`surveyChoices` has no answer key — it stays in `...rest` and passes through
(like `choices`/`media`). Add a vitest case to `sanitizeTask.test.ts`: a survey
task's `surveyChoices` survives intact AND the all-secrets test still strips
everything. Update BOTH allowlists that pin the client-safe shape:
- the sanitizer header comment, and
- `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs` (line ~172) — without this the
  sanitizer-allowlist scenario fails loud the moment a survey task reaches a
  participant payload (that failure IS the RED for this key).

## New callable — getRunSurveyResults (functions/src/runs/index.ts)

`loggedCallable` + `enforceRateLimit`, re-exported from `functions/src/index.ts`,
typed wrapper in `apps/creator-web/src/services/calls.ts`.

- **Input:** `{ ownerUid?, gameId, runId }` (creator console calls with
  `{gameId, runId}`, owner == caller, like `listRunTeams`).
- **Authz:** owner-or-run-scoped-staff, same contract as `assertStaffOrOwner`
  (functions/src/index.ts:71): caller uid == run's `ownerUid`, OR admin token,
  OR staff token whose `ownerUid` AND `runId` claims match THIS run. Strangers
  and participants get `permission-denied` (the e2e authz-denial scenario pins
  it). The run doc's own `ownerUid` is the authority.
- **Aggregation:** one game-doc read (collect survey tasks) + one `teamsCol`
  scan (the docs already carry `surveyResponse` on task records):
```ts
{ results: Array<{
    taskId: string; title: string;
    surveyChoices?: string[];                       // present ⇒ choice survey
    counts?: Record<string, number>;                // choice: per-choice tally (0-filled)
    responses?: { teamName: string; response: string }[];  // free-text rows
    responseCount: number;
} > }
```
Read-only — no writes, no transaction.

## Routing

None. A survey task has no verification geometry; like `quiz` it supports
`locationless` and every `triggerMode` (incl. `instant`), and the preset-aware
scorer treats it as any fixed-`pointValue` task. No change to
`routing/assignNextTask.ts`.

## UI

- **creator-web** — TaskEditor (`BuilderPage.tsx`) + `TaskWizard.tsx` /
  `wizardLogic.ts`: `'survey'` in the type picker; prompt = the existing
  `description` field; a choices editor cloned from the quiz `choices` editor
  (2–8 rows, optional — empty ⇒ free-text); default `pointValue` 0. RunConsole
  (`RunConsolePage.tsx`): a "Survey results" section fetching
  `getRunSurveyResults` on expand/refresh — per-choice bar counts, free-text as
  a `{teamName, response}` list (`dir="auto"` on responses). `t.*` EN+HE.
- **play-web** — `TaskRunner.tsx`: a `SurveyEntry` branch in the type switch
  (line ~263): `surveyChoices` present ⇒ one button per choice (tap submits, like
  `QuizEntry` buttons); absent ⇒ textarea (`maxLength={500}`) + submit, disabled
  while empty. Submits via the existing `answer()` helper →
  `submitTaskAnswer({ answer })`. Static Tailwind, `dir="auto"`, `t.*` EN+HE.
  No anonymity copy (non-goal — responses are creator-attributed).

## Test strategy

- **Pure (TDD RED→GREEN):** `scripts/test-survey.ts` (tsx assertion script,
  picked up by the `npm test` aggregator like `test-ordering.ts`):
  `validateSurveyResponse` — trims; rejects empty/whitespace/non-string/501
  chars; accepts exactly-500; choice mode accepts a listed choice (post-trim)
  and rejects an unlisted one; free-text accepts arbitrary text. Plus the
  sanitizer vitest case (surveyChoices passthrough) in
  `functions/src/runs/sanitizeTask.test.ts`.
- **Callable (e2e):** new `survey-tasks` scenario in `scripts/e2e-verify.mjs` —
  MANDATORY: the coverage guard fails the suite while `getRunSurveyResults` has
  no invocation, and the allowlist check fails until `surveyChoices` is added to
  `ALLOWED_TASK_KEYS`. Scenario:
  1. Create + launch a game with one choice survey (3 options, `pointValue` 20)
     and one free-text survey (`pointValue` 0), `instant`/`locationless`; join
     two teams.
  2. Sanitized payload: `surveyChoices` present, allowlist green.
  3. Submit: team A picks choice 1, team B picks choice 2; both send free-text.
     Assert `correct: true`, task completed, `earnedScore` == 20 / 0,
     `getMyTeamState` echoes own `surveyResponse`.
  4. Duplicate submission ⇒ idempotent no-op (response + score unchanged);
     unlisted choice / empty / 501-char response ⇒ `invalid-argument`.
  5. `getRunSurveyResults` as owner: counts `{c1:1, c2:1, c3:0}`, free-text rows
     carry both team names + responses. As run staff: allowed. As a participant
     token and a stranger: `permission-denied` (extends the authz-denial
     pattern).
  6. Leaderboard invariant oracle stays green (survey points flow the normal
     `earnedScore` channel).
- **UI:** preview both TaskRunner modes + the RunConsole panel;
  `npm run i18n:check` clean (zero new PART B warnings).

## Footguns respected

- `surveyResponse` written inside the EXISTING `completeTaskForTeam`
  transaction — no added transaction/reads in the hot path.
- Task records live in the `stages` array — always rewritten via the
  transaction's whole-object update, never a dotted array-element path.
- New callable ⇒ e2e scenario in the SAME change (coverage guard 66→67).
- `surveyChoices` consciously classified participant-safe in both allowlists —
  never silently added to `...rest` alone.

## Why

Every existing task type has a right answer — creators have no way to ask a
question they just want ANSWERED (favorite stop, team chant, "which route did you
take?", event feedback mid-run). Competitor platforms ship polls/surveys as a core
engagement + data-collection block. RushPoint can add it with almost no new
machinery: submission rides the existing `submitTaskAnswer` callable and the
existing completion transaction; the only genuinely new surface is one read-only
aggregation callable for the creator console.

## What Changes

- New **`TaskType 'survey'`** — a no-right-answer data-collection task.
  - `Task.surveyChoices?: string[]` (2–8 options) ⇒ the player picks one;
    **absent ⇒ free-text response** (trimmed, ≤ 500 chars).
  - Any valid non-empty response is "correct": it completes the task for its
    fixed `pointValue` (0 is a fine default — pure data collection).
- **`submitTaskAnswer`** accepts `type === 'survey'`: answer matching is skipped
  (always correct), the response string is stored on the team's task record
  (`taskRec.surveyResponse`) inside the **existing** completion transaction
  (`completeTaskForTeam`). Duplicate submission is an idempotent no-op via the
  existing already-completed guard. **No new submission callable.**
- **ONE new callable `getRunSurveyResults`** (owner or run-scoped staff only):
  aggregates every survey task in the run — per-choice counts for choice surveys,
  `{teamName, response}` rows for free-text.
- Sanitizer: `surveyChoices` is participant-visible (there is no answer key to
  protect) — added to the allowlist in `sanitizeTaskForParticipant` passthrough
  AND the e2e `ALLOWED_TASK_KEYS` pin. `taskRec.surveyResponse` is the team's own
  data — fine in `getMyTeamState`.
- Routing: survey behaves exactly like `quiz` (locationless / instant trigger
  modes supported); zero routing-math change.
- creator-web: TaskEditor + TaskWizard support the type (prompt = existing
  `description`; choices editor mirrors the quiz choices editor); RunConsole
  gains a "Survey results" panel on `getRunSurveyResults`. play-web: TaskRunner
  renders choice buttons or a free-text box + submit. i18n EN+HE throughout.

## Capabilities

### New Capabilities
- `survey-tasks`: the `'survey'` TaskType + `surveyChoices`; pure
  `validateSurveyResponse` (shared); always-correct completion path inside
  `submitTaskAnswer`/`completeTaskForTeam`; `getRunSurveyResults` aggregation
  callable; Builder/Wizard authoring; TaskRunner response UI; RunConsole results
  panel.

## Non-goals

- No anonymity guarantees — responses are attributed to teams for the creator
  (the play-web UI makes no anonymity claim either).
- No multi-select, no rating scales, no mid-run editing of a submitted response
  (first response is final — the completed guard enforces it).
- No CSV export change (the existing analytics-csv-export is untouched).
- No participant-facing live results (creator/staff console only).
- No scoring change — a survey earns its fixed `pointValue` through the existing
  completion path; `buildRankings` untouched.

## Surfaces touched

- **shared:** `packages/shared/src/survey.ts` (`validateSurveyResponse`,
  `SURVEY_RESPONSE_MAX_LEN`, `SURVEY_CHOICES_MIN/MAX`); `types/index.ts`
  (`'survey'` in `TaskType`, `Task.surveyChoices?`, `surveyResponse?` on the
  team task record).
- **functions:** `submitTaskAnswer` survey branch + `completeTaskForTeam`
  optional `surveyResponse` write (inside the existing transaction);
  `sanitizeTask.ts` allowlist + vitest; new `getRunSurveyResults` in
  `functions/src/runs/index.ts`, re-exported from `functions/src/index.ts`.
- **creator-web:** TaskEditor/TaskWizard type + choices editor; `services/calls.ts`
  wrapper; RunConsole "Survey results" panel; i18n EN/HE.
- **play-web:** TaskRunner `SurveyEntry` (buttons or textarea); i18n EN/HE.
- **Tests:** `scripts/test-survey.ts` (pure lane, RED-first); sanitizer vitest
  case; new `survey-tasks` e2e scenario in `scripts/e2e-verify.mjs` (the
  callable-coverage guard makes `getRunSurveyResults` RED until it exists) +
  `surveyChoices` added to the script's `ALLOWED_TASK_KEYS`.

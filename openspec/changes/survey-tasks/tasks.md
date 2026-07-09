## 1. Pure validation — RED then GREEN (TDD)

- [ ] 1.1 RED: `scripts/test-survey.ts` (tsx assertion script, `npm test` aggregator) asserting `validateSurveyResponse`: trims; rejects empty/whitespace/non-string/501-char; accepts exactly-500; choice mode accepts a listed choice post-trim and rejects an unlisted one; free-text mode accepts arbitrary non-empty text. Confirm it fails (module missing).
- [ ] 1.2 RED: sanitizer vitest case in `functions/src/runs/sanitizeTask.test.ts`: a `type: 'survey'` task's `surveyChoices` passes through intact; the all-secrets strip test still holds. Confirm it fails (type not in `TaskType` / field unknown).
- [ ] 1.3 GREEN: `packages/shared/src/survey.ts` (`validateSurveyResponse`, `SURVEY_RESPONSE_MAX_LEN`, `SURVEY_CHOICES_MIN/MAX`), exported from `@rushpoint/shared`; add `'survey'` to `TaskType` + `Task.surveyChoices?` + `surveyResponse?` on the team task record (doc comments: not secret, mutually exclusive with answer keys, first-response-final). `npm test` → 1.1 + 1.2 pass; `npm run typecheck`.

## 2. Server (functions) — existing callable + existing transaction

- [ ] 2.1 `completeTaskForTeam` (functions/src/runs/index.ts:497): optional trailing `extras?: { surveyResponse?: string }`; inside the EXISTING transaction, stamp `taskRec.surveyResponse` when completing (whole-object stage rewrite as today — no dotted array paths, no new reads). Completed-guard keeps duplicates a no-op.
- [ ] 2.2 `submitTaskAnswer` (line 2194): admit `type === 'survey'` past the quiz/numeric gate; survey branch — `validateSurveyResponse(answer, task.surveyChoices)`, `invalid-argument` on null, else complete via 2.1 + `releaseTask` + `assignNextInActiveStage` (same tail as quiz), return `{ correct: true, nextTaskId }`. No attempt tracking; `assertTaskNotExpired` still applies; reject `orderedAnswer` on a survey.
- [ ] 2.3 `updateGame` task validation accepts `type: 'survey'` and enforces `surveyChoices` = 2–8 non-empty strings when present.
- [ ] 2.4 Sanitizer: `surveyChoices` passthrough in `functions/src/runs/sanitizeTask.ts` (header comment updated). `npm run typecheck` + `npm test`.

## 3. New callable — getRunSurveyResults

- [ ] 3.1 `getRunSurveyResults` in `functions/src/runs/index.ts` (`loggedCallable` + `enforceRateLimit`): authz = owner-or-run-scoped-staff per the `assertStaffOrOwner` contract (uid == run's `ownerUid` | admin | staff token with matching `ownerUid`+`runId`); one game read + one teams scan; returns per survey task `{taskId, title, surveyChoices?, counts? (0-filled per choice), responses? ({teamName, response}[]), responseCount}`.
- [ ] 3.2 Re-export from `functions/src/index.ts`; typed wrapper in `apps/creator-web/src/services/calls.ts`.

## 4. e2e — new scenario (coverage guard: new callable ships RED until tested)

- [ ] 4.1 Add `surveyChoices` to `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs` (~line 172).
- [ ] 4.2 New `survey-tasks` scenario: game with 1 choice survey (3 options, 20 pts) + 1 free-text survey (0 pts), instant/locationless; launch + join 2 teams; sanitized payload allowlisted with `surveyChoices` present; both teams submit (different choices + free-text) → `correct: true`, completion, `earnedScore` 20/0, own `surveyResponse` in `getMyTeamState`; duplicate submission idempotent; unlisted choice / empty / 501-char ⇒ `invalid-argument`.
- [ ] 4.3 Same scenario: `getRunSurveyResults` as owner (counts `{c1:1,c2:1,c3:0}` + free-text rows with team names) and as run staff (allowed); participant + stranger ⇒ `permission-denied`; invariant oracle green.
- [ ] 4.4 `npm run e2e` — green, coverage guard 67/67 (batch gate).

## 5. creator-web — authoring + results

- [ ] 5.1 TaskEditor (`BuilderPage.tsx`) + `TaskWizard.tsx`/`wizardLogic.ts`: `'survey'` type option; prompt = existing `description`; choices editor cloned from quiz `choices` (2–8 rows, optional — empty ⇒ free-text); default `pointValue` 0.
- [ ] 5.2 RunConsole (`RunConsolePage.tsx`): "Survey results" panel on `getRunSurveyResults` — per-choice counts, free-text `{teamName, response}` list (`dir="auto"`), refresh button.
- [ ] 5.3 creator-web i18n keys EN + HE (type label, choices editor, results panel).

## 6. play-web — response UI

- [ ] 6.1 `TaskRunner.tsx`: `SurveyEntry` branch — choice buttons (tap submits via the existing `answer()` helper) or textarea (`maxLength={500}`, submit disabled while empty). Static Tailwind, `dir="auto"`.
- [ ] 6.2 play-web i18n keys EN + HE (free-text placeholder, submit, thanks/confirmation copy).

## 7. Gates

- [ ] 7.1 `npm run typecheck`
- [ ] 7.2 `npm run lint`
- [ ] 7.3 `npm test`
- [ ] 7.4 `npm run creator:build` + `npm run play:build`
- [ ] 7.5 `npm run e2e` (batch gate — coverage guard must count getRunSurveyResults)
- [ ] 7.6 `npm run i18n:check` (clean; zero new PART B warnings via `i18n:check:strict`)

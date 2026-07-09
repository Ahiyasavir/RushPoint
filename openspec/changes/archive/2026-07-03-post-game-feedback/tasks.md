# Post-Game Feedback — tasks (RED → GREEN → REFACTOR)

## 1. Shared shape + pure aggregation (vitest lane)

- [x] 1.1 RED: create `functions/src/runs/feedbackSummary.test.ts` covering
      `validateFeedbackPayload` (accepts partial ratings; rejects unknown rating key,
      out-of-range value — overall 0/6, difficulty 4 —, unknown issue code, comment > 1000 chars,
      and an entirely empty payload) and `computeFeedbackSummary` (zero responses → zeroed
      summary, no NaN anywhere; skip-aware per-dimension avg/count/distribution; dimension with
      zero answers omitted; responseRate with participantCount 0 guard; recommendScore = share of
      4–5 answers; issueCounts; commentCount). Run vitest — confirm it FAILS (module missing).
- [x] 1.2 GREEN: add the survey shape to `packages/shared/src/types/index.ts` —
      `FEEDBACK_RATING_KEYS` (`overall|content|bonding|difficulty|smoothness|recommend` with
      their ranges), `FeedbackIssue` enum, `RunFeedback` doc type, `RunFeedbackSummary` type,
      `FIRESTORE_PATHS.feedback/feedbackCol` — then implement pure
      `functions/src/runs/feedbackSummary.ts` until 1.1 passes.
- [x] 1.3 REFACTOR: `npm run typecheck` green across workspaces; add the two rate budgets to
      `packages/shared/src/rateLimit.ts` (`submitRunFeedback: {max:3, windowMs:MIN}`,
      `getRunFeedbackSummary: {max:30, windowMs:MIN}`).

## 2. Callables (e2e lane)

- [x] 2.1 RED: add `scenario('post-game feedback', …)` to `scripts/e2e-verify.mjs` (current
      smart-suite style: `scenario`/`check`/`expectError`, parties via `makeParty`): submit while
      racing → `failed-precondition`; after finish controller submits `{overall:5, comment}` →
      `{ok:true}`; attached viewer device submits `{overall:3}` → ok (2 docs, 1 team); duplicate
      submit with different answers → `already:true` and owner-read doc unchanged; garbage rating
      → `invalid-argument`; owner `getRunFeedbackSummary` → `responseCount:2`, overall avg 4,
      comment + respondent names present; participant calling the summary → `permission-denied`.
      Run `npm run e2e` — confirm the new scenario FAILS (callables missing).
- [x] 2.2 GREEN: implement `submitRunFeedback` in `functions/src/runs/index.ts` —
      `resolveCallerTeam` (any attached device, NO controller gate), finished-gate
      (team.status or run.status `finished`), `validateFeedbackPayload`, create-only transaction
      on `feedback/{uid}` (repeat → `{ok:true, already:true}`), `enforceRateLimit`.
- [x] 2.3 GREEN: implement `getRunFeedbackSummary` — owner gate (same pattern as
      `getRunAnalytics`), read `feedbackCol` + team/participant count, return
      `{summary: computeFeedbackSummary(...), responses}`. Re-export both callables from
      `functions/src/index.ts`.
- [x] 2.4 GREEN: `firestore.rules` — `match /feedback/{docId}` under runs: owner read, write
      false. Run `npm run e2e` — whole suite green including the new scenario.

## 3. play-web survey UI

- [x] 3.1 Typed wrapper `submitRunFeedback` in `apps/play-web/src/services/calls.ts`; add
      `t.final.survey*` strings to `i18n.ts` HE+EN (prompts, emoji labels, issue chips, skip,
      dismiss, send, thanks — mind ui-text-standards: no dashes).
- [x] 3.2 New `apps/play-web/src/components/PostGameSurvey.tsx`: one-question-at-a-time card,
      emoji/chip taps with auto-advance, progress dots, per-question skip, whole-card dismiss,
      issue chips step when smoothness < 3, optional `dir="auto"` comment, submit → thank-you;
      localStorage guard `rushpoint.feedback.<runId>` (done/dismissed).
- [x] 3.3 Mount in `FinalScreen.tsx` in BOTH states: waiting-for-finalize and post-podium.
- [x] 3.4 Verify via preview on :5181 — finish a mini run, tap through in the waiting state,
      thank-you shown, card gone after reload; `npm run i18n:check:strict` clean.

## 4. creator-web summary panel

- [x] 4.1 Typed wrapper `getRunFeedbackSummary` in `apps/creator-web/src/services/calls.ts`;
      `t.runConsole.feedback*` strings HE+EN.
- [x] 4.2 `FeedbackPanel` in `RunConsolePage.tsx`: auto-fetch when `run.status === 'finished'`;
      response-rate header, per-dimension tiles (emoji + avg + count), difficulty/smoothness
      breakdowns, issue chips with counts, comments list (team + name), respondent click →
      full-response modal; empty state.
- [x] 4.3 Verify via preview on :5180 against the e2e-produced run (2 responses: rate, avg, both
      drill-downs); `npm run i18n:check` + `npm run i18n:check:strict` — zero new findings.

## 5. Gates

- [x] 5.1 Full gate set green: `npm run typecheck` · `npm run lint` · `npm test` ·
      `npm run creator:build` · `npm run play:build` · `npm run e2e` · `npm run i18n:check`.

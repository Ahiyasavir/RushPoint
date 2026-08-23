## 1. RED — failing tests first

- [x] 1.1 Create `functions/src/retryLockout.test.ts` (vitest, no emulator) importing
      `evaluateRetryLockout`, `retryLockoutPolicyFor`, `wrongAnswerCost`, `cooldownRemainingSeconds`
      and `WRONG_ANSWER_LEVELS` from `@rushpoint/shared`.
- [x] 1.2 Encode the Test Strategy cases 1-5: no failures (undefined / `{}` / a record with no
      lockout fields), the free first attempt at `standard`, escalation across attempts 2..8 for
      `gentle`/`standard`/`strict` saturating at each level's ceiling, the boundary at `end-1` /
      `end` / `end+1` ms for BOTH the duration and the legacy form, and an expired lockout.
- [x] 1.3 Encode cases 6-7 (clock skew): assert `remainingMs` depends only on the SERVER now, and
      pin the current bug by showing the naive `cooldownRemainingSeconds(cooldownUntil, clientNow)`
      returns 0 at +6 h skew and ~21600 s at -6 h skew while the verdict returns the true remaining.
- [x] 1.4 Encode case 8 (**migration**): a legacy `{ charged, lastHash, cooldownUntil }` record is
      locked before its expiry, unlocked after it, reports `source === 'legacy'`, and a legacy
      expiry 30 days out is clamped to the level ceiling with `clamped === true`.
- [x] 1.5 Encode cases 9-12: malformed stored timestamps (`-1`, `NaN`, `±Infinity`, `null`,
      `undefined`, wrong type, negative `lockoutMs`, future `lastFailureAt`); the seeded invariant
      sweep (finite, `>= 0`, `<= ceiling` on every output); duration-over-legacy precedence; and
      `retryLockoutPolicyFor` per level plus its garbage-level fallback to `off`.
- [x] 1.6 Run `npx vitest run src/retryLockout.test.ts` from `functions/` and confirm it FAILS for
      the right reason (`evaluateRetryLockout` / `retryLockoutPolicyFor` are not exported yet).
      Record the verbatim failure.

## 2. GREEN — the pure decision function

- [x] 2.1 Add `RetryLockoutRecord`, `RetryLockoutPolicy`, `RetryLockoutVerdict`,
      `retryLockoutPolicyFor(level)` and `evaluateRetryLockout(nowMs, record, policy)` to
      `packages/shared/src/wrongAnswerPenalty.ts` per design D1-D3: duration form first, legacy
      absolute second, else unlocked; `remainingMs = clamp(end - now, 0, ceiling)`;
      `locked = remainingMs > 0`; every non-finite/negative input resolving to unlocked. Leave
      `cooldownRemainingSeconds`, `wrongAnswerCost` and the level table untouched (D8).
- [x] 2.2 Re-run `npx vitest run src/retryLockout.test.ts` and confirm GREEN.

## 3. GREEN — server wiring

- [x] 3.1 Widen `RunTeam.answerPenalties` in `packages/shared/src/types/index.ts` with optional
      `lastFailureAt`, `lockoutMs`, `failureCount`, documented as additive-and-optional so legacy
      records type-check unchanged.
- [x] 3.2 Add `cooldownRemainingMs` to `AnswerCostDisplay` and compute it inside `answerCostDisplay`
      via `evaluateRetryLockout`; keep `cooldownUntil` present and mark it deprecated-for-display
      (D4). Take the caller's `nowMs` explicitly rather than reading the clock inside the pure module.
- [x] 3.3 In `functions/src/runs/index.ts`, replace the submit gate's
      `cooldownRemainingSeconds(penaltyRec.cooldownUntil, Date.now())` with
      `evaluateRetryLockout(Date.now(), penaltyRec, retryLockoutPolicyFor(costLevel))`, keeping the
      test-drive waiver and the "gate before grading" ordering exactly as they are.
- [x] 3.4 In the charge transaction, write `lastFailureAt`, `lockoutMs` and `failureCount` alongside
      the existing `charged` / `lastHash` / `cooldownUntil` as a real nested object (D6) — no dotted
      keys, no array element.
- [x] 3.5 Add `retryAfterMs` to the wrong-answer response and to the duplicate-submission replay
      response, computed from the verdict; keep `retryAfterSeconds` and `cooldownUntil`.
- [x] 3.6 Pass the server clock into the `answerCostDisplay` call in `getMyTeamState`'s participant
      task payload so the shipped `cooldownRemainingMs` is computed at response time.

## 4. GREEN — participant UI

- [x] 4.1 In `apps/play-web/src/services/calls.ts`, add `retryAfterMs` to the `submitTaskAnswer`
      response type (the `answerCost` shape comes from the shared `AnswerCostDisplay` and follows
      automatically).
- [x] 4.2 In `apps/play-web/src/components/TaskRunner.tsx`, seed the countdown from
      `answerCost.cooldownRemainingMs` and from `res.retryAfterMs`, converting each to a LOCAL
      deadline `Date.now() + remainingMs` (D5). Preserve the task-keyed state and the raise-only
      `Math.max` rule. Fall back to the legacy absolute field only when the duration is absent, so
      a server that has not yet been redeployed still works.
- [x] 4.3 Confirm no user-facing string changed (no new/edited `t.*` key, no new literal).

## 5. GREEN — e2e assertions (WRITTEN, NOT RUN)

- [x] 5.1 In `scripts/e2e-verify.mjs`, extend the `wrong answers cost (…)` scenario: assert
      `retryAfterMs` on the 2nd wrong answer (`> 0`, `<= 15000`, consistent with
      `retryAfterSeconds`), assert `answerCost.cooldownRemainingMs > 0` and `<= 90000` on the active
      task during the lockout (a duration, not an instant compared to the runner's own clock), and
      assert the replay response carries `retryAfterMs`.
- [x] 5.2 **Do NOT run `npm run e2e`** — a live playtest stack owns the emulator in this working
      tree. Record the assertions as written-but-unrun in the final report.

## 6. REFACTOR

- [x] 6.1 Re-read the three server call sites and confirm the lockout question is asked in exactly
      one place (`evaluateRetryLockout`) and that no call site re-derives a remaining time by hand.
- [x] 6.2 Update the comments in `wrongAnswerPenalty.ts`, `runs/index.ts` and `TaskRunner.tsx` that
      still describe the absolute-instant contract, and cross-reference this change by name.

## 7. Gates

- [x] 7.1 `npm run typecheck` — green.
- [x] 7.2 `npm run lint` — 0 errors.
- [x] 7.3 `npm test` — both lanes green (the new vitest file, the existing
      `scripts/test-wrong-answer-penalty.ts` and the property lane all pass unchanged).
- [x] 7.4 `npm run play:build` and `npm run creator:build` — green.
- [x] 7.5 `npm run i18n:check` clean (PART A hard gate) and `npm run i18n:check:strict` compared
      against the pre-change baseline to prove zero NEW PART B findings.
- [x] 7.6 (recorded, not run) Explicitly NOT run under the live-stack constraint, and reported as such: `npm run e2e`,
      `npm run verify:emulator`, `npm run test:rules`, plus interactive preview verification of the
      countdown.

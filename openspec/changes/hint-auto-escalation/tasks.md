## 1. Shared predicate — RED then GREEN (pure logic, TDD)

- [x] 1.1 RED: `scripts/test-hint-escalation.ts` asserting `isHintFree` (no thresholds → never free; attempts below/at/above threshold; minutes before/at/after incl. fractional; missing/unparseable `startedAt` → time path unsatisfied; OR semantics — either path alone frees; 0/negative/non-finite thresholds ignored). Run `npm test`, confirm it fails for the right reason (module missing). This is the authoritative TIME-path coverage.
- [x] 1.2 GREEN: implement `isHintFree` + `HintEscalationState` in `packages/shared/src/hintEscalation.ts`; export from `@rushpoint/shared`. `npm test` → 1.1 passes.

## 2. Shared types
- [x] 2.1 Add `hintAutoRevealMinutes?` / `hintAutoRevealAttempts?` to `Task` beside `hint`/`hintPenalty` (doc comment: OR semantics, server-clock, thresholds not secret). `npm run typecheck`.

## 3. Server enforcement (functions)
- [x] 3.1 `runs/index.ts` `requestTaskHint`: inside the existing transaction, compute `isHintFree` from the task's `RunTaskRecord.startedAt` + `team.taskAttempts?.[taskId]`; when free, skip the `bonusPenalty` charge and return `{ penalty: 0, free: true }` (idempotence via `taskHintsUsed` unchanged).
- [x] 3.2 `runs/index.ts` `submitTaskAnswer`: broaden the wrong-answer `taskAttempts` increment condition to `attemptLimit > 0 || hintAutoRevealAttempts > 0` (nested-map merge, never dotted keys).
- [x] 3.3 `functions/src/index.ts` `verifyStationCode`: on a wrong code with `hintAutoRevealAttempts` set, increment `taskAttempts.{taskId}` (same merge pattern) before throwing.
- [x] 3.4 `runs/index.ts` `getMyTeamState`: decorate the active task's sanitized entry with `hintFreeNow` (server-computed). `npm run typecheck`.

## 4. e2e — allowlist + scenario
- [x] 4.1 Add `hintAutoRevealMinutes` / `hintAutoRevealAttempts` (and sanitizer-added `hintFreeNow`) to `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs`.
- [x] 4.2 Add the `hint auto escalation` scenario (attempts path): no `hintFreeNow` initially → 2 wrong `submitTaskAnswer` → `hintFreeNow: true` → `requestTaskHint` returns the hint at `penalty: 0` with `bonusPenalty` unchanged → second call `alreadyUsed`; control task without thresholds still charges 25.
- [ ] 4.3 `npm run e2e` — green (batch gate).

## 5. creator-web — Builder authoring
- [x] 5.1 `TaskWizard.tsx`: two numeric inputs in the collapsible hint section ("free after N minutes" / "free after N wrong attempts"; 0/empty ⇒ undefined; cleared by the remove-hint button).
- [x] 5.2 creator-web i18n keys (`hintFreeAfterMinutes`, `hintFreeAfterAttempts`, `hintEscalationLead`) EN + HE.

## 6. play-web — free-hint state
- [x] 6.1 `TaskRunner.tsx`: "free hint available!" button state when `task.hintFreeNow` and not yet revealed; reveal toast shows "free" when the response is `penalty: 0 && free`.
- [x] 6.2 play-web i18n keys (`hintFreeNow`, `hintRevealedFree`) EN + HE.

## 7. Gates
- [x] 7.1 `npm run typecheck`
- [x] 7.2 `npm run lint`
- [x] 7.3 `npm test` (hint-escalation pure test green)
- [x] 7.4 `npm run creator:build` + `npm run play:build`
- [ ] 7.5 `npm run e2e`
- [x] 7.6 `npm run i18n:check` (clean; `i18n:check:strict` adds zero new findings)

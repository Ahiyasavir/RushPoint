## 1. Shared pure logic — RED then GREEN (TDD)

- [x] 1.1 RED: `scripts/test-ordering.ts` asserting `seededShuffle` (same seed ⇒ identical output; different seeds differ; output is a permutation/same multiset; NEVER equals the input — identity-guard rotation), `matchesOrderedAnswer` (exact; case/whitespace-insensitive; wrong order; wrong length; non-array), `validateOrderItems` (2 reject / 3 ok / 10 ok / 11 reject; empty item; normalized duplicate). Run `npm test`, confirm it fails for the right reason (module missing).
- [x] 1.2 GREEN: implement `seededShuffle` (FNV-1a → mulberry32 → Fisher–Yates + identity guard) + `matchesOrderedAnswer` + `validateOrderItems` in `packages/shared/src/ordering.ts`; export from `@rushpoint/shared`. `npm test` → 1.1 passes.

## 2. Sanitizer — RED then GREEN (security-critical)
- [x] 2.1 RED: extend `functions/src/runs/sanitizeTask.test.ts` (vitest): seeded call returns `orderItems` shuffled ≠ authored, same multiset, stable across two calls with the same seed; seedless call OMITS `orderItems`; existing secrecy invariants unchanged. Confirm the new tests fail.
- [x] 2.2 GREEN: `sanitizeTaskForParticipant(task, opts?: { shuffleSeed?: string })` — destructure `orderItems` out of `...rest`, emit `seededShuffle(orderItems, seed)` or omit when seedless. `npm test` → 2.1 passes.

## 3. Shared types
- [x] 3.1 Add `orderItems?: string[]` to `Task` (doc comment: order is the server-secret answer key; mutually exclusive with `choices`/`answers`). `npm run typecheck`.

## 4. Server enforcement (functions)
- [x] 4.1 `runs/index.ts` `getMyTeamState`: pass `{ shuffleSeed: `${team.id}:${t.id}` }` at the single `sanitizeTaskForParticipant` call site.
- [x] 4.2 `runs/index.ts` `submitTaskAnswer`: accept `orderedAnswer?: string[]`; ordering task requires it (`invalid-argument` otherwise, and on a non-ordering task carrying it); grade via `matchesOrderedAnswer`; wrong ⇒ existing `{ correct:false }` + `taskAttempts` increment; correct ⇒ existing completion tail.
- [x] 4.3 `games/index.ts` `updateGame`: `validateOrderItems` per task + reject `orderItems` on non-quiz or alongside `choices`/`answers` (`invalid-argument`). `npm run typecheck`.

## 5. e2e — allowlist + scenario
- [x] 5.1 Add `orderItems` to `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs`.
- [x] 5.2 Add the `quiz ordering` scenario: payload `orderItems` shuffled ≠ authored AND same multiset AND stable across two polls; submitting the shuffled order ⇒ `correct: false`; a case/whitespace-mangled authored order ⇒ `correct: true` + completion + points; `orderedAnswer` on a plain quiz ⇒ `invalid-argument`; a 2-item `updateGame` ⇒ `invalid-argument`.
- [ ] 5.3 `npm run e2e` — green (batch gate).

## 6. creator-web — Builder ordering editor
- [x] 6.1 `TaskWizard.tsx`: quiz mode toggle (choice/typed vs ordering); ordering list editor with add/remove + up/down (3–10, counter, confirm on mode switch clearing the other mode's fields); save guard via `validateOrderItems`.
- [x] 6.2 creator-web i18n keys (`quizModeChoices`, `quizModeOrdering`, `orderingItemsLead`, `orderingAddItem`, `orderingCountError`, `orderingDuplicateError`, `orderingModeSwitchConfirm`) EN + HE.

## 7. play-web — reorder UI
- [x] 7.1 `services/calls.ts`: `submitTaskAnswer` wrapper gains the optional `orderedAnswer: string[]` payload key.
- [x] 7.2 `TaskRunner.tsx`: reorderable list (up/down buttons, `dir="auto"`, RTL-safe logical classes) + submit via `orderedAnswer`; wrong answer keeps the player's arrangement.
- [x] 7.3 play-web i18n keys (`orderingInstruction`, `orderingSubmit`, `orderingWrong`) EN + HE.

## 8. Gates
- [x] 8.1 `npm run typecheck`
- [x] 8.2 `npm run lint`
- [x] 8.3 `npm test` (ordering + sanitizer suites green)
- [x] 8.4 `npm run creator:build` + `npm run play:build`
- [ ] 8.5 `npm run e2e`
- [x] 8.6 `npm run i18n:check` (clean; `i18n:check:strict` adds zero new findings)

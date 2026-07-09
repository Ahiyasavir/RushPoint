## Why

The quiz task type only supports multiple-choice (`choices` + `answers`) and
typed answers. There is no way to ask "put these in order" — arrange historical
events chronologically, sort landmarks north-to-south, sequence the steps of a
recipe. Ordering questions are a staple of trivia platforms and need no new
hardware or GPS — a pure content win. The trap is secrecy: the authored array
order IS the answer key, so the participant must receive the items shuffled,
server-side, or the answer leaks in the payload.

## What Changes

- A **quiz Task** may carry `orderItems?: string[]` — 3 to 10 items authored in
  the CORRECT order. The item texts are public; **the ordering is the
  server-secret answer key**.
- **Server-side deterministic shuffle:** `sanitizeTaskForParticipant` replaces
  `orderItems` with a copy shuffled by a seed derived from `teamId + taskId` —
  so the authored order never reaches a client, every reload of the same team
  shows the same stable order (no reshuffle-to-solve), and different teams get
  different orders. If no seed is available the field is stripped entirely
  (fail closed, never fail open).
- **Submission reuses `submitTaskAnswer`** with a new `orderedAnswer: string[]`
  payload: exact-match against the authored order, per-item
  case/whitespace-insensitive (a pure `matchesOrderedAnswer` beside the
  existing `matchesTaskAnswer`). Correct ⇒ the normal
  `completeTaskForTeam` completion; wrong ⇒ `{ correct: false }` and the wrong
  attempt increments `team.taskAttempts` — counting toward `smart.attemptLimit`
  AND hint auto-escalation (change `hint-auto-escalation`).
- **Scoring:** normal task points via the existing presets — no partial credit.
- The **Builder** quiz editor gains an "ordering" mode: a reorderable item list
  (min 3, max 10), mutually exclusive with choices/typed answers on one task.
  Validation (shared pure validator + `updateGame`) enforces item count, non-
  empty items, and no duplicates-after-normalization (duplicates would make the
  match ambiguous).
- **play-web** `TaskRunner` renders the shuffled items as a reorderable list
  (move up/down) with a submit button.

## Capabilities

### New Capabilities
- `quiz-ordering`: the `orderItems` quiz variant; pure `seededShuffle` /
  `matchesOrderedAnswer` / `validateOrderItems`; the per-team deterministic
  shuffle inside `sanitizeTaskForParticipant`; the `orderedAnswer` path in
  `submitTaskAnswer`; the Builder ordering editor and the play-web reorder UI.

## Non-goals

- No partial credit / per-position scoring — all-or-nothing, v1.
- No drag-and-drop — up/down buttons (touch-reliable, RTL-safe); DnD is polish.
- No ordering support in the `?challenge=` deep-link flow
  (`checkChallengeAnswer`) — quiz/numeric only there, v1.
- No mixed tasks: a quiz task has EITHER `orderItems` OR `choices`/`answers`.
- No media per item — plain strings.

## Surfaces touched

- **shared:** new `packages/shared/src/ordering.ts` (`seededShuffle`,
  `matchesOrderedAnswer`, `validateOrderItems`); `Task` gains `orderItems?`.
- **functions:** `runs/sanitizeTask.ts` — `sanitizeTaskForParticipant` gains an
  options param and the shuffle-or-strip behavior (its ONE production caller,
  `getMyTeamState`, passes the team id); `runs/index.ts` — `submitTaskAnswer`
  `orderedAnswer` branch; `games/index.ts` — `updateGame` validation. No new
  callable (drives e2e coverage through the existing `submitTaskAnswer`).
- **creator-web:** `TaskWizard.tsx` quiz ordering mode + i18n; typed wrapper in
  `services/calls.ts` unchanged shape-wise apart from the optional payload key.
- **play-web:** `TaskRunner.tsx` reorderable-list UI + `services/calls.ts`
  `submitTaskAnswer` payload extension + i18n.
- **Tests:** `scripts/test-ordering.ts` + `functions/src/runs/sanitizeTask.test.ts`
  additions (pure); a `quiz ordering` e2e scenario + `ALLOWED_TASK_KEYS` entry
  (`orderItems` allowed but asserted shuffled ≠ authored AND same multiset).
- No Firestore index, rules, or env change.

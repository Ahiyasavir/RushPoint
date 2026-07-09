# Design — hint-auto-escalation

## Data model (packages/shared/src/types/index.ts)
Two optional fields on `Task`, next to `hint` / `hintPenalty`:
```ts
hintAutoRevealMinutes?: number;   // free once held ≥ N minutes (from RunTaskRecord.startedAt)
hintAutoRevealAttempts?: number;  // free once ≥ N wrong attempts (team.taskAttempts[taskId])
```
Optional → absent = the hint stays paid forever (today's behavior). The
thresholds carry no secret (they don't reveal the hint text) → `...rest`
passthrough in `sanitizeTaskForParticipant`; both go into `ALLOWED_TASK_KEYS`.

No new team fields: the time basis is the existing `RunTaskRecord.startedAt`
(written at assignment in `assignNextInActiveStage`, both the single-task and
routed branches); the attempts basis is the existing
`team.taskAttempts: Record<string, number>` map (row 42).

## Pure predicate (packages/shared/src/hintEscalation.ts — new)
```ts
export interface HintEscalationState { startedAt?: string; wrongAttempts?: number }
isHintFree(
  state: HintEscalationState,
  task: Pick<Task, 'hintAutoRevealMinutes' | 'hintAutoRevealAttempts'>,
  nowMs: number,
): boolean
```
- Neither threshold set ⇒ never free.
- Attempts path: `wrongAttempts >= hintAutoRevealAttempts` (threshold must be a
  finite number ≥ 1; 0/negative/non-finite ⇒ ignored).
- Time path: `startedAt` parseable AND `(nowMs - Date.parse(startedAt)) >=
  hintAutoRevealMinutes * 60_000` (fractional honored; unparseable/absent
  `startedAt` ⇒ time path not satisfied — fail safe toward "paid").
- OR of the two paths. Server clock only — callers pass `Date.now()`.

## Server enforcement (functions/)
- **`requestTaskHint`** (`runs/index.ts`): already runs a transaction on the
  team doc. Inside it, after reading the team: locate the task's
  `RunTaskRecord` in `team.stages` (for `startedAt`) and read
  `team.taskAttempts?.[taskId] ?? 0`; compute `free = isHintFree(...)`. When
  free, `tx.update` records `taskHintsUsed` as today but does NOT touch
  `bonusPenalty`; return `{ hint, penalty: 0, free: true, alreadyUsed }`.
  Idempotence unchanged: a second call still returns `alreadyUsed: true`,
  charged 0.
- **`getMyTeamState`** (`runs/index.ts`): after building `activeStageTasks`
  (sanitized), decorate the entry whose id equals `team.activeTaskId` with
  `hintFreeNow: isHintFree(...)` computed from the same team doc it already
  holds. Display-only convenience — the charge decision is re-made inside
  `requestTaskHint`'s transaction, so a stale flag can never mischarge.
- **Wrong-attempt tracking:**
  - `submitTaskAnswer`: the existing wrong-answer increment of
    `taskAttempts.{taskId}` (real nested-map `.set({merge})`, NOT a dotted key)
    currently runs only when `attemptLimit > 0` — broaden the condition to
    `attemptLimit > 0 || task.hintAutoRevealAttempts! > 0`. The attempt-LIMIT
    refusal logic itself is untouched.
  - `verifyStationCode` (`functions/src/index.ts`): today a wrong code just
    throws `failed-precondition` 'Incorrect code'. Before throwing, when the
    task carries `hintAutoRevealAttempts`, increment `taskAttempts.{taskId}`
    with the same nested-map merge pattern. (Also honors `attemptLimit` counting
    for station codes as a side benefit, but enforcing a station attempt cap
    stays out of scope.)
  - Ordering submissions (change `quiz-ordering`, if landed) flow through
    `submitTaskAnswer` and therefore count automatically.

## Sanitizer
`hintAutoRevealMinutes` / `hintAutoRevealAttempts` pass through via `...rest`.
`hintFreeNow` is added AFTER sanitization by `getMyTeamState` (like the
sanitizer's own `hasHint`) → add all three to `ALLOWED_TASK_KEYS` in
`scripts/e2e-verify.mjs`, with `hintFreeNow` under the "added by the sanitizer
itself" group. The hint TEXT continues to be stripped — no change to the
`sanitizeTaskForParticipant` destructuring.

## UI
- **creator-web** (`components/TaskWizard.tsx`): inside the existing collapsible
  hint section (the `showHint` block), two small numeric inputs — "free after N
  minutes" and "free after N wrong attempts" (0/empty ⇒ undefined). Cleared
  together with the hint by the existing remove-hint button. Strings via `t.*`.
- **play-web** (`components/TaskRunner.tsx`): the hint button block
  (`task.hasHint`) gains a third state: when `task.hintFreeNow` and not yet
  revealed, render an accent-highlighted "🎁 free hint available!" button that
  calls the same `revealHint`; the reveal toast shows "free" instead of the
  cost when the response has `penalty === 0 && free`. Strings via `t.*`.

## Test strategy
- **Pure (TDD RED→GREEN):** `scripts/test-hint-escalation.ts` — truth table for
  `isHintFree`: no thresholds → never; attempts below/at/above; minutes
  before/at/after (incl. fractional); missing/unparseable `startedAt` → time
  path off; attempts-only satisfied while time unset; OR semantics; 0/negative/
  non-finite thresholds ignored. This is the authoritative coverage for the
  TIME path (e2e can't wait minutes; fractional minutes keep even that testable
  later if wanted).
- **Callable (e2e):** a `hint auto escalation` scenario in
  `scripts/e2e-verify.mjs` using the ATTEMPTS path: a quiz task with `hint`,
  `hintPenalty: 25`, `hintAutoRevealAttempts: 2`; `getMyTeamState` first shows
  no `hintFreeNow`; two wrong `submitTaskAnswer` calls; `getMyTeamState` now
  shows `hintFreeNow: true`; `requestTaskHint` returns the hint with
  `penalty: 0` and the team's `bonusPenalty` is unchanged; a second call →
  `alreadyUsed: true`. A control task without thresholds still charges 25.
  Payloads stay allowlisted.
- **UI:** preview the Builder inputs + the free-hint button; `npm run i18n:check`.

## Footguns respected
- Charge decision inside the existing `requestTaskHint` transaction — no TOCTOU
  between "is it free?" and "charge".
- `taskAttempts` writes keep the real-nested-map `.set({merge})` pattern (the
  dotted-key footgun is documented at that exact call site).
- Hint text exposure path unchanged (answer-key secrecy intact).
- No client clock trust: time from `RunTaskRecord.startedAt` vs server `Date.now()`.

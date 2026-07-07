## Why

The paid-hint system (`Task.hint` + `hintPenalty`, revealed once per team via
`requestTaskHint`) is all-or-nothing: a genuinely stuck team either pays points
or stays stuck — and a stuck team is the #1 way a live event dies (they stall a
station, fall behind, and quit). Organizers want the game to notice a struggling
team and help it for free. Both signals already exist server-side: how long the
team has held the task (`RunTaskRecord.startedAt`, set at assignment) and how
many wrong answers it has burned (`team.taskAttempts[taskId]`). This turns them
into an automatic, server-authoritative escalation.

## What Changes

- A **Task** with a hint may carry two optional escalation thresholds:
  - `hintAutoRevealMinutes?: number` — the hint becomes FREE once the team has
    held the task at least this long (from the task's `startedAt`, the
    assignment instant — never a client clock);
  - `hintAutoRevealAttempts?: number` — OR once the team has recorded at least
    this many wrong attempts on it.
  Either threshold met ⇒ free (OR semantics). Fractional minutes honored.
- A pure predicate `isHintFree(state, task, nowMs)` in `packages/shared` is the
  single decision point, shared by `requestTaskHint` (charging) and
  `getMyTeamState` (display) so they can't drift.
- **`requestTaskHint` charges 0** when the hint is free — still recorded in
  `taskHintsUsed` (idempotent, once per team/task as today), `bonusPenalty`
  untouched. Paid-then-free ordering is harmless: whichever state the FIRST
  reveal happens in is what's charged.
- **Wrong attempts become universally tracked:** `submitTaskAnswer` today only
  increments `team.taskAttempts` when `smart.attemptLimit` is set — it will now
  also increment when `hintAutoRevealAttempts` is set; `verifyStationCode`
  (which today tracks nothing on a wrong code) gains the same increment.
- **`getMyTeamState`** decorates the team's active task payload with
  `hintFreeNow: true` (server-computed). play-web flips the hint button from
  "💡 stuck? reveal for N pts" to a highlighted "free hint available!" state.
- The Builder hint section gains the two small numeric inputs.
- The hint TEXT stays server-secret exactly as today — only `requestTaskHint`
  ever returns it; escalation changes the price, never the exposure path.

## Capabilities

### New Capabilities
- `hint-auto-escalation`: optional time / wrong-attempt thresholds on a task's
  paid hint; the pure `isHintFree` predicate; universal wrong-attempt tracking;
  free-hint charging in `requestTaskHint`; `hintFreeNow` in the participant
  state; Builder inputs and the play-web free-hint button state.

## Non-goals

- No multi-tier escalation (e.g. half price at 5 min, free at 10) — one free
  threshold pair, v1.
- No proactive hint push — the team still taps the button; it's just free.
- No change to hint secrecy, idempotence, or the `bonusPenalty` ledger shape.
- No refund when a team paid before the threshold would have passed.
- No escalation for `smart.hintCount`/`showHintsOverTime` station hints — this
  targets the task-level paid hint only.

## Surfaces touched

- **shared:** new `packages/shared/src/hintEscalation.ts` (`isHintFree`,
  `HintEscalationState`); `Task` gains `hintAutoRevealMinutes?` /
  `hintAutoRevealAttempts?`.
- **functions:** `runs/index.ts` — `requestTaskHint` free-charge path,
  `getMyTeamState` `hintFreeNow` decoration, `submitTaskAnswer` broadened
  attempt increment; `index.ts` (root) — `verifyStationCode` wrong-code attempt
  increment. No new callable. Sanitizer passthrough of the two thresholds.
- **creator-web:** `TaskWizard.tsx` hint-section inputs + i18n.
- **play-web:** `TaskRunner.tsx` free-hint button state + i18n.
- **Tests:** `scripts/test-hint-escalation.ts` (pure, covers the time path); a
  `hint auto escalation` e2e scenario via the attempts path (e2e can't wait
  minutes) + `ALLOWED_TASK_KEYS` entries (`hintAutoRevealMinutes`,
  `hintAutoRevealAttempts`, sanitizer-added `hintFreeNow`).
- No Firestore index, rules, or env change.

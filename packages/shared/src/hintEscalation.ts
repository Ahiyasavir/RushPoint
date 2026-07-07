// Hint auto escalation (change: hint-auto-escalation) — the single pure decision
// point for "is this task's paid hint currently FREE for this team?".
//
// Shared by requestTaskHint (the charging decision, re-made inside its team
// transaction so a stale display flag can never mischarge) and getMyTeamState
// (the participant-facing `hintFreeNow` display flag) so the two never drift.
//
// Semantics (OR of two independent paths; both fail SAFE toward "paid"):
//   - attempts path: the team has recorded ≥ hintAutoRevealAttempts wrong
//     attempts on this task (team.taskAttempts[taskId]). The threshold must be
//     a finite number ≥ 1 — 0 / negative / non-finite thresholds are ignored.
//   - time path: the team has HELD the task at least hintAutoRevealMinutes
//     (fractional honored) since RunTaskRecord.startedAt — the server-written
//     assignment instant, never a client clock. Missing / unparseable
//     startedAt leaves the time path unsatisfied. The threshold must be a
//     finite number > 0.
// Neither threshold set ⇒ never free (today's always-paid behavior).
import type { Task } from './types';

export interface HintEscalationState {
  /** RunTaskRecord.startedAt — ISO instant the task was assigned to the team. */
  startedAt?: string;
  /** team.taskAttempts[taskId] — wrong attempts recorded for this task. */
  wrongAttempts?: number;
}

export function isHintFree(
  state: HintEscalationState,
  task: Pick<Task, 'hintAutoRevealMinutes' | 'hintAutoRevealAttempts'>,
  nowMs: number,
): boolean {
  const attemptsThreshold = task.hintAutoRevealAttempts;
  if (
    typeof attemptsThreshold === 'number' &&
    Number.isFinite(attemptsThreshold) &&
    attemptsThreshold >= 1 &&
    (state.wrongAttempts ?? 0) >= attemptsThreshold
  ) {
    return true;
  }

  const minutesThreshold = task.hintAutoRevealMinutes;
  if (
    typeof minutesThreshold === 'number' &&
    Number.isFinite(minutesThreshold) &&
    minutesThreshold > 0 &&
    typeof state.startedAt === 'string' &&
    state.startedAt !== ''
  ) {
    const startedMs = Date.parse(state.startedAt);
    if (Number.isFinite(startedMs) && nowMs - startedMs >= minutesThreshold * 60_000) {
      return true;
    }
  }

  return false;
}

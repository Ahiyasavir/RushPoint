// "The organizers closed your mission" (change: live-task-close-rules). The server stamps
// `team.closedTaskNotice` on a team that was STANDING on a mission when it was closed, and routes
// it on. This decides whether the phone shows it: once per closure, while fresh, and not after the
// team dismissed it. Pure and total (scripts/test-closed-task-notice.ts).

export interface ClosedTaskNotice { taskId: string; title: string; at: string }

/** Long enough to be seen after a reload mid-walk; short enough not to greet a team an hour later. */
export const CLOSED_NOTICE_FRESH_MS = 30 * 60_000;

export function closedNoticeKey(runId: string, n: Pick<ClosedTaskNotice, 'taskId' | 'at'>): string {
  return `rp-closed-seen:${runId}:${n.taskId}:${n.at}`;
}

function isNotice(n: unknown): n is ClosedTaskNotice {
  if (!n || typeof n !== 'object') return false;
  const o = n as Record<string, unknown>;
  return typeof o.taskId === 'string' && o.taskId !== '' && typeof o.title === 'string' && typeof o.at === 'string'
    && Number.isFinite(Date.parse(o.at));
}

/** `dismissed(key)` reads the per phone record; a throw reads as "not dismissed". */
export function shouldShowClosedNotice(n: unknown, nowMs: number, dismissed: (key: string) => boolean, runId = ''): boolean {
  if (!isNotice(n)) return false;
  // A notice stamped "in the future" is a phone clock running slow, never a reason to hide it.
  if (nowMs - Date.parse(n.at) > CLOSED_NOTICE_FRESH_MS) return false;
  try { return !dismissed(closedNoticeKey(runId, n)); } catch { return true; }
}

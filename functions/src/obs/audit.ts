// Durable audit trail for privileged / destructive actions.
//
// Moved verbatim out of functions/src/index.ts (change: recoverable-game-deletion)
// so it is reachable from every domain module, not just the root one. No cycle:
// index.ts and games/index.ts already import from obs/, and obs/ imports neither.
//
// WHY THIS IS NOT loggedCallable: loggedCallable (obs/log.ts) is CONSOLE-ONLY. It
// emits one structured line per invocation to the Firebase logger and persists
// nothing, which is correct for ~85 callables (cost + PII) but meant that after a
// creator lost a game to one deleteGame click, "who deleted this and when" was
// answerable only by diffing database snapshots. Destructive actions get a durable
// record here; everything else keeps the console line.
//
// auditLogs/{id} is CF-write-only and client-UNREADABLE (firestore.rules); it is
// surfaced solely through the admin-gated listAuditLogs callable.

import { db } from '../firebase';
import { logBestEffort } from './log';

export interface AuditEntry {
  runId?: string;
  teamId?: string;
  teamName?: string;
  operatorId: string;
  actionType: string;
  previousValue?: number | string | null;
  newValue?: number | string | null;
  reason?: string;
  [key: string]: unknown;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await db.collection('auditLogs').add({
    ...entry,
    teamName:      entry.teamName ?? null,
    previousValue: entry.previousValue ?? null,
    newValue:      entry.newValue ?? null,
    reason:        entry.reason ?? '',
    timestamp:     new Date().toISOString(),
  });
}

/**
 * Audit-and-continue. A failed audit write must NEVER abort the action the user
 * asked for, or the accountability fix becomes a new outage. The failure is
 * logged through the same best-effort channel as every other non-fatal side effect.
 */
export async function auditBestEffort(entry: AuditEntry): Promise<void> {
  try {
    await writeAuditLog(entry);
  } catch (e) {
    logBestEffort('auditLog.write', { actionType: entry.actionType, operatorId: entry.operatorId }, e);
  }
}

// ── Destructive game-lifecycle action types (change: recoverable-game-deletion) ──
export const AUDIT_GAME_DELETED  = 'game_deleted';
export const AUDIT_GAME_RESTORED = 'game_restored';
export const AUDIT_GAME_PURGED   = 'game_purged';
/** operatorId used when the scheduled purge sweep, not a person, acted. */
export const AUDIT_SYSTEM_OPERATOR = 'system:purge-sweep';

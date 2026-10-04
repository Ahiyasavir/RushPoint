// The team's score ledger (changes: send-team-back, team-dossier-and-search).
//
// Research 2026-09-25: an operator's reason for a score change was written ONLY to `auditLogs`,
// which clients cannot read and whose listing callable is platform-admin only, so the organizer's
// console could show that a score moved but never why. Every operator-made change is now also
// appended here, inside the same transaction that moves the score, on the team document the console
// already streams: no added read, no added write. Organizer-facing only: the participant sanitizer
// never allow-lists it.
//
// Bounded (latest SCORE_LEDGER_MAX) and total. Rewritten as a whole array, never a dotted update
// into an array element (CLAUDE.md: that coerces the array to a map).

export type ScoreLedgerKind = 'adjust' | 'hint' | 'skipAward' | 'reversal' | 'hintRefund';

export interface ScoreLedgerEntry {
  at: string;
  delta: number;
  kind: ScoreLedgerKind;
  reason?: string;
  /** Operator display name, never a uid. */
  by?: string;
  taskId?: string;
}

export const SCORE_LEDGER_MAX = 100;
const KINDS = new Set<ScoreLedgerKind>(['adjust', 'hint', 'skipAward', 'reversal', 'hintRefund']);

function clean(e: unknown): ScoreLedgerEntry | null {
  if (!e || typeof e !== 'object') return null;
  const x = e as Record<string, unknown>;
  if (typeof x.delta !== 'number' || !Number.isFinite(x.delta) || x.delta === 0) return null;
  if (!KINDS.has(x.kind as ScoreLedgerKind)) return null;
  const out: ScoreLedgerEntry = {
    at: typeof x.at === 'string' ? x.at : new Date(0).toISOString(),
    delta: Math.round(x.delta),
    kind: x.kind as ScoreLedgerKind,
  };
  if (typeof x.reason === 'string' && x.reason.trim()) out.reason = x.reason.trim().slice(0, 200);
  if (typeof x.by === 'string' && x.by.trim()) out.by = x.by.trim().slice(0, 60);
  if (typeof x.taskId === 'string' && x.taskId) out.taskId = x.taskId;
  return out;
}

export function appendScoreLedger(
  existing: readonly unknown[] | null | undefined,
  entries: readonly unknown[],
): ScoreLedgerEntry[] {
  const kept = (Array.isArray(existing) ? existing : []).map(clean).filter((x): x is ScoreLedgerEntry => !!x);
  const added = (Array.isArray(entries) ? entries : []).map(clean).filter((x): x is ScoreLedgerEntry => !!x);
  const all = [...kept, ...added];
  return all.length > SCORE_LEDGER_MAX ? all.slice(all.length - SCORE_LEDGER_MAX) : all;
}

/**
 * What a team is still owed back for the hint it bought on `taskId` (run-gate-integrity): the paid
 * hint charges on that mission minus any refund already made. Read from the ledger the charge itself
 * wrote, so a free (escalated) hint — which records nothing — refunds nothing, and a second refund
 * pays 0. Called only when the ORGANIZER takes the mission away before the team finished it.
 */
export function hintRefundOwed(ledger: readonly unknown[] | null | undefined, taskId: string): number {
  let owed = 0;
  for (const e of (Array.isArray(ledger) ? ledger : []).map(clean)) {
    if (!e || e.taskId !== taskId) continue;
    if (e.kind === 'hint') owed -= e.delta;
    else if (e.kind === 'hintRefund') owed -= e.delta;
  }
  return Math.max(0, owed);
}

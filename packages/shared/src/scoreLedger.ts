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

export type ScoreLedgerKind = 'adjust' | 'hint' | 'skipAward' | 'reversal';

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
const KINDS = new Set<ScoreLedgerKind>(['adjust', 'hint', 'skipAward', 'reversal']);

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

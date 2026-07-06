// Scheduled / timed release (change: scheduled-release). A task or a whole stage
// can be gated to become available only at a wall-clock time (`releaseAt`, ISO) or
// a number of minutes after the run started (`releaseAfterMinutes`). The decision
// is made HERE, server-side, from the server clock — never from a client claim.
// Pure logic; no Firestore, no DOM. Shared by the routing candidate filters, the
// stage-unlock gate, and the participant "unlocks in…" countdown so they can't
// drift. Absent gate ⇒ always released (full backward compatibility).

/** A thing that may carry a scheduled-release gate (a Task or a Stage). */
export interface ReleaseGate {
  releaseAt?: string;          // ISO wall-clock instant; released once now >= it
  releaseAfterMinutes?: number; // minutes after run start; released once elapsed >= it
}

/**
 * Whether a gated item is released at `nowMs`. An item with no gate is always
 * released. When both fields are set, BOTH must be satisfied (the later of the
 * two wins) — a creator can require e.g. "at least 30 min in AND not before 10:00".
 * A `releaseAfterMinutes` gate with no known run start is treated as not-yet-
 * released (the run hasn't started, so nothing time-gated can be open).
 */
export function isReleased(
  gate: ReleaseGate | null | undefined,
  runStartedAt: string | number | null | undefined,
  nowMs: number,
): boolean {
  if (!gate) return true;
  const hasAt = typeof gate.releaseAt === 'string' && gate.releaseAt.trim().length > 0;
  const hasAfter = typeof gate.releaseAfterMinutes === 'number'
    && Number.isFinite(gate.releaseAfterMinutes)
    && gate.releaseAfterMinutes > 0;
  if (!hasAt && !hasAfter) return true;

  if (hasAt) {
    const at = Date.parse(gate.releaseAt as string);
    // An unparseable releaseAt must not silently open the gate.
    if (Number.isNaN(at) || nowMs < at) return false;
  }
  if (hasAfter) {
    const startMs = typeof runStartedAt === 'number'
      ? runStartedAt
      : (runStartedAt ? Date.parse(runStartedAt) : NaN);
    if (Number.isNaN(startMs)) return false; // no run start → nothing time-relative is open
    const elapsedMin = (nowMs - startMs) / 60_000;
    if (elapsedMin < (gate.releaseAfterMinutes as number)) return false;
  }
  return true;
}

/**
 * The instant (ms epoch) a gated item becomes available, for rendering a
 * countdown. Returns null when there is no time gate (already available) or when
 * a relative gate has no known run start. When both gates exist, the later wins.
 */
export function releaseInstantMs(
  gate: ReleaseGate | null | undefined,
  runStartedAt: string | number | null | undefined,
): number | null {
  if (!gate) return null;
  const candidates: number[] = [];
  if (typeof gate.releaseAt === 'string' && gate.releaseAt.trim()) {
    const at = Date.parse(gate.releaseAt);
    if (!Number.isNaN(at)) candidates.push(at);
  }
  if (typeof gate.releaseAfterMinutes === 'number'
    && Number.isFinite(gate.releaseAfterMinutes)
    && gate.releaseAfterMinutes > 0) {
    const startMs = typeof runStartedAt === 'number'
      ? runStartedAt
      : (runStartedAt ? Date.parse(runStartedAt) : NaN);
    if (!Number.isNaN(startMs)) candidates.push(startMs + gate.releaseAfterMinutes * 60_000);
  }
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

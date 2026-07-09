// Pure idempotency helpers for smart-station code submissions. They record which
// exact codes have already been accepted for a task (kept on gameState.smartVerifications)
// so a duplicate submission — a double-tap that fires two network calls, or a retried
// request whose first response was lost — can be detected and short-circuited inside the
// completion transaction. Pure (no Firestore) so the logic is unit-testable.

export function normalizeStationCode(code: string): string {
  return code.trim().toLowerCase();
}

// True when this exact code was already accepted for this task.
export function isDuplicateStationCode(
  verifications: Record<string, string[]> | undefined,
  taskId: string,
  code: string,
): boolean {
  const key = normalizeStationCode(code);
  return (verifications?.[taskId] ?? []).includes(key);
}

// Return the verifications record with this code recorded for the task. Idempotent —
// re-recording the same code yields an unchanged set (never a duplicate key).
export function recordStationCode(
  verifications: Record<string, string[]> | undefined,
  taskId: string,
  code: string,
): Record<string, string[]> {
  const key = normalizeStationCode(code);
  const existing = verifications?.[taskId] ?? [];
  if (existing.includes(key)) return { ...(verifications ?? {}) };
  return { ...(verifications ?? {}), [taskId]: [...existing, key] };
}

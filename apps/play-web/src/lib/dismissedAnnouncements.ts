// Persist the set of announcement ids a participant has dismissed, run-scoped,
// so a persistent GLOBAL banner the server still marks `active` stays dismissed
// across reloads/reconnects (a flaky-network run reloads often). Mirrors the
// localStorage pattern FeedPanel uses for per-run mutes: run-scoped key, JSON
// array of ids, defensive try/catch that FAILS OPEN — storage disabled / private
// mode / quota must never crash the live-ops banner, so on any error we behave
// exactly like today's in-memory Set.

/** Run-scoped so a dismissal never leaks across unrelated events. */
export const dismissedKey = (runId: string) => `rp.annDismiss.${runId}`;

/** Read the persisted dismissed-id set for a run. Any failure ⇒ empty set. */
export function loadDismissed(runId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(dismissedKey(runId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set(); // malformed JSON / storage unavailable — never white-screen
  }
}

/** Write a dismissed-id set for a run. Any failure is swallowed (fail open). */
export function saveDismissed(runId: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(dismissedKey(runId), JSON.stringify([...ids]));
  } catch { /* storage unavailable — the in-memory Set still suppresses */ }
}

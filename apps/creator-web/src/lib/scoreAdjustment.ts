// Manual score-adjustment parsing (change: creator-onboarding-and-plain-language).
//
// The run console used to send `parseInt(v) || 0` straight to adjustTeamScore, so
// a typo, a stray letter or an empty prompt submitted a ZERO-delta adjustment:
// no scoring effect, but a real callable round-trip and a permanent audit-log
// entry against that team. Anything that is not a deliberate, non-zero whole
// number is now rejected before the call is made.
//
// Pure: no React, no Firebase.

/** Largest adjustment a creator can apply in one go, in either direction. */
export const MAX_SCORE_DELTA = 100_000;

/**
 * The adjustment a creator meant, or `null` when the input is not a usable,
 * non-zero number. `null` means "do not call adjustTeamScore".
 */
export function parseScoreDelta(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  // Normalize the dashes a Hebrew/typographic keyboard produces to ASCII '-'.
  const text = raw.trim().replace(/[‐-―−]/g, '-');
  if (!text) return null;
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null;

  const n = Number(text);
  if (!Number.isFinite(n)) return null;

  const rounded = n < 0 ? -Math.round(-n) : Math.round(n);
  if (rounded === 0) return null;

  return Math.max(-MAX_SCORE_DELTA, Math.min(MAX_SCORE_DELTA, rounded));
}

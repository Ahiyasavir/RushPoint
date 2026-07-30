// Time on site accounting (change: admin-engagement-and-outreach).
//
// WHAT THIS MEASURES, AND WHAT IT CANNOT
// "How long has this creator spent in the console" is only observable on the CLIENT: the
// server sees isolated callable requests, not a session, and cannot tell a tab left open
// overnight from a person actually working. So the client measures ENGAGED time (tab
// visible and focused) and reports it in periodic flushes.
//
// That makes the number untrusted by construction, which is what every rule here is for.
// A flush is clamped so a broken clock, a machine resuming from sleep, or a hostile client
// cannot inject an implausible span; the total can only ever move forward, because the
// server applies these as increments.
//
// It is also NOT retroactive. Nothing recorded engagement before this shipped, so every
// existing account starts at zero and accumulates from its next visit. A zero here means
// "not measured yet", never "never visited".

/** The most engaged time a single flush may claim. The client flushes far more often than
 *  this (see the heartbeat), so a legitimate report is never near the cap; anything at or
 *  beyond it is a clock jump, a resumed laptop, or a forgery. */
export const MAX_ENGAGEMENT_FLUSH_MS = 15 * 60 * 1000;

/** Normalize one client reported flush into a trustworthy, non negative integer of
 *  milliseconds. Total: any shape of bad input becomes 0 rather than NaN or a throw,
 *  because this feeds a Firestore increment and a NaN there would poison the stored
 *  total permanently. */
export function clampEngagementDelta(ms: unknown): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(Math.min(ms, MAX_ENGAGEMENT_FLUSH_MS));
}

/** Split a stored total into whole hours plus the remaining whole minutes, for display.
 *  Formatting itself lives in the app dictionaries (this package is language free), so
 *  this returns parts rather than a string. Total: corrupt input reads as zero. */
export function engagementParts(ms: unknown): { hours: number; minutes: number } {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return { hours: 0, minutes: 0 };
  const totalMinutes = Math.floor(ms / 60_000);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

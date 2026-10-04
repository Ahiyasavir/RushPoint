// How long a Run Console inbox item has waited, as a unit a host reads at a
// glance (scripts/test-inbox-age.ts). Under an hour a clock, under two days whole
// hours, from two days whole days: "965 hours" was what a long-stuck team showed.
// Total: negative (clock skew) and junk read as zero.

export type InboxAge =
  | { kind: 'clock'; text: string }
  | { kind: 'hours'; n: number }
  | { kind: 'days'; n: number };

const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;

export function inboxAge(ms: number): InboxAge {
  const s = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  if (s < HOUR_S) return { kind: 'clock', text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` };
  if (s < 2 * DAY_S) return { kind: 'hours', n: Math.floor(s / HOUR_S) };
  return { kind: 'days', n: Math.floor(s / DAY_S) };
}

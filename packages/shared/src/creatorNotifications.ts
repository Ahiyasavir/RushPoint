// Creator notifications (change: creator-engagement-loop). Every item is about something REAL in the
// creator's own game: people joined it, played it, liked it, copied it, the event is close. Items live
// at `users/{uid}/notifications/{id}`, written only by the server; "unread" is derived from one stamp
// on the creator's profile (`notificationsSeenAt`), so there is no per-item read flag to keep in sync.
//
// The id is derived from what the item is ABOUT, never random: a retried write lands on the same
// document, and a day of likes on one game is one item with a growing count rather than twenty.
// Everything here is pure and total: junk in reads as "nothing", never a throw.

export type CreatorNotificationKind = 'firstJoin' | 'players' | 'finished' | 'liked' | 'copied' | 'rated' | 'eventSoon';
export type EventCountdown = 'd3' | 'd1' | 'd0';

export interface CreatorNotification {
  id: string;
  kind: CreatorNotificationKind;
  /** ISO time of the newest event the item describes. */
  createdAt: string;
  gameId?: string;
  runId?: string;
  /** What the sentence names: a game title, a team name, a number. Short values only. */
  params?: Record<string, string | number>;
  /** Coalesced items (likes, copies, photos) count how many happened. */
  count?: number;
}

/** Participant counts that earn a "your game passed N players" item. Ascending. */
export const PLAYER_MILESTONES: readonly number[] = [5, 10, 25, 50, 100, 250, 500, 1000];

const TZ = 'Asia/Jerusalem';
const clean = (v: unknown) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '_');

export function notificationId(
  kind: CreatorNotificationKind,
  parts: { runId?: string; gameId?: string; taskId?: string; milestone?: number; day?: string; threshold?: EventCountdown },
): string {
  const bits: unknown[] = [kind];
  switch (kind) {
    case 'firstJoin': case 'finished': case 'rated': bits.push(parts.runId); break;
    case 'players': bits.push(parts.runId, parts.milestone); break;
    case 'liked': bits.push(parts.taskId ? `t_${clean(parts.taskId)}` : parts.gameId, parts.day); break;
    case 'copied': bits.push(parts.taskId, parts.day); break;
    case 'eventSoon': bits.push(parts.gameId, parts.threshold); break;
  }
  return bits.map((b, i) => (i === 0 ? String(b) : clean(b))).join('-');
}

function parts(iso: string): Record<string, number> | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** The calendar day in Israel, `yyyy-mm-dd`. Likes coalesce per this day, not per UTC day. */
export function israelDayKey(iso: string): string | null {
  const p = parts(iso);
  if (!p) return null;
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** How many items are newer than the creator's last look. A junk stamp means "never looked". */
export function unreadCount(items: readonly { createdAt: string }[] | null | undefined, seenAt: string | null | undefined): number {
  const seen = seenAt ? Date.parse(seenAt) : Number.NaN;
  let n = 0;
  for (const it of items ?? []) {
    const t = Date.parse(it?.createdAt ?? '');
    if (!Number.isFinite(t)) continue;
    if (!Number.isFinite(seen) || t > seen) n++;
  }
  return n;
}

/** The red badge text: nothing at zero, the number up to 9, then "9+". */
export function badgeLabel(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 9 ? '9+' : String(Math.floor(n));
}

/** The milestones a count passed on its way from `before` to `after` (each is announced once). */
export function milestonesCrossed(before: number, after: number): number[] {
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) return [];
  return PLAYER_MILESTONES.filter((m) => m > before && m <= after);
}

/** The next goal to show ("6 more and you reach 50"). Null past the last one. */
export function nextMilestone(n: number): number | null {
  const v = Number.isFinite(n) ? n : 0;
  return PLAYER_MILESTONES.find((m) => m > v) ?? null;
}

function dayNumber(iso: string): number | null {
  const k = israelDayKey(iso);
  if (!k) return null;
  const [y, m, d] = k.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Which countdown an event date is at, in Israel calendar days: 3 days, the day before, the day. */
export function eventCountdownKind(eventAt: string, now: string): EventCountdown | null {
  const e = dayNumber(eventAt);
  const n = dayNumber(now);
  if (e == null || n == null) return null;
  const left = e - n;
  return left === 3 ? 'd3' : left === 1 ? 'd1' : left === 0 ? 'd0' : null;
}

/** 22:00 to 08:00 in Israel: a push waits; an in-app item simply sits in the list. */
export function isQuietHour(now: string): boolean {
  const p = parts(now);
  if (!p) return true;
  return p.hour >= 22 || p.hour < 8;
}

/** A like earns an item only when it is someone else's, on a game whose owner is known. */
export function shouldNotifyLike({ likerUid, ownerUid }: { likerUid: string; ownerUid: string }): boolean {
  return !!ownerUid && !!likerUid && likerUid !== ownerUid;
}

/**
 * `Game.eventAt` from a save. `null` or '' clears it; a parseable date between 2020 and 2100 is stored
 * as a normalised ISO instant; anything else is refused (null result), so the caller can say so LOUDLY
 * rather than store a value no countdown can read.
 */
export function normalizeEventAt(value: unknown): { value: string | null } | null {
  if (value === null || value === '') return { value: null };
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const year = new Date(ms).getUTCFullYear();
  if (year < 2020 || year > 2100) return null;
  return { value: new Date(ms).toISOString() };
}

/** Whole Israel days until the event: 0 on the day, null once it has passed or when there is none. */
export function daysUntilEvent(eventAt: string | null | undefined, now: string): number | null {
  if (!eventAt) return null;
  const e = dayNumber(eventAt);
  const n = dayNumber(now);
  if (e == null || n == null || e < n) return null;
  return e - n;
}

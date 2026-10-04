// "הקבוצות שלי": the teams a person follows in the run console and the staff app (change: followed-teams).
//
// Ahiya, 2026-09-30: counsellors and the operator follow a few teams they choose, with quick access and
// control, very simple, and find them on the map in a different colour. The list is kept per run and
// per person on the device (the apps own storage); everything here is pure and total so both apps show
// the same status and offer the same single action. Colour means "something is wrong" (ISA-101):
// only SOS / out of bounds (red) and waiting / stuck / paused (amber) are coloured.

export const MAX_FOLLOWED = 8;

/** Parse a stored list: strings only, no duplicates, only teams still in the run, at most 8. */
export function readFollowed(raw: string | null | undefined, knownTeamIds: readonly string[] | null | undefined): string[] {
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : []; } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const known = Array.isArray(knownTeamIds) ? new Set(knownTeamIds) : null;
  const out: string[] = [];
  for (const id of parsed) {
    if (typeof id !== 'string' || !id || out.includes(id)) continue;
    if (known && !known.has(id)) continue;
    out.push(id);
    if (out.length === MAX_FOLLOWED) break;
  }
  return out;
}

/** Follow or unfollow. A full list refuses a new team (and says so) but always lets one go. */
export function toggleFollowed(list: readonly string[], teamId: string): { list: string[]; refused?: 'full' } {
  const cur = Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  if (cur.includes(teamId)) return { list: cur.filter((x) => x !== teamId) };
  if (cur.length >= MAX_FOLLOWED) return { list: [...cur], refused: 'full' };
  return { list: [...cur, teamId] };
}

/** The previous (-1) / next (1) followed team, wrapping around; null when there is nowhere to go. */
export function neighbourFollowed(list: readonly string[], teamId: string, dir: 1 | -1): string | null {
  if (!Array.isArray(list) || list.length < 2) return null;
  const i = list.indexOf(teamId);
  if (i < 0) return null;
  return list[(i + dir + list.length) % list.length];
}

/** Followed teams first (in follow order), then the rest in their own order. */
export function sortFollowedFirst<T extends { id: string }>(teams: readonly T[], followed: readonly string[]): T[] {
  if (!Array.isArray(teams)) return [];
  const f = Array.isArray(followed) ? followed : [];
  const mine = f.map((id) => teams.find((t) => t?.id === id)).filter((t): t is T => !!t);
  return [...mine, ...teams.filter((t) => !f.includes(t?.id))];
}

export type FollowedStatusKind =
  | 'sos' | 'removed' | 'outOfBounds' | 'waitingReview' | 'stuck' | 'held' | 'notStarted' | 'finished' | 'playing';

export interface FollowedStatus {
  kind: FollowedStatusKind;
  /** alert = red (someone may be in trouble), warn = amber (needs you), neutral = grey. */
  tone: 'alert' | 'warn' | 'neutral';
  /** The oldest item waiting for a decision, when kind is waitingReview. */
  waiting?: { kind: 'task' | 'flash'; id: string; ageMs: number };
}

type TeamLike = {
  id?: unknown; removed?: unknown; held?: unknown; launched?: unknown; status?: unknown; outOfBounds?: unknown;
  taskSubmissions?: Record<string, { status?: unknown; submittedAt?: unknown } | null | undefined> | null;
  flashClaims?: Record<string, { status?: unknown; submittedAt?: unknown; at?: unknown } | null | undefined> | null;
};

const at = (iso: unknown) => (typeof iso === 'string' ? Date.parse(iso) : NaN);

/**
 * The one status a followed team's card shows, most important first:
 * SOS › removed › out of bounds › waiting for approval › stuck › paused › not started › finished › playing.
 * `stuck` is the caller's verdict (the console's attention rule); `sosTeamIds` are teams with an open SOS.
 */
export function followedTeamStatus(input: {
  team: TeamLike | null | undefined; nowMs: number; sosTeamIds?: readonly string[] | null; stuck?: boolean;
}): FollowedStatus {
  const t = (input?.team && typeof input.team === 'object' ? input.team : {}) as TeamLike;
  const now = Number.isFinite(input?.nowMs) ? input.nowMs : Date.now();
  if (typeof t.id === 'string' && Array.isArray(input?.sosTeamIds) && input.sosTeamIds.includes(t.id)) return { kind: 'sos', tone: 'alert' };
  if (t.removed === true) return { kind: 'removed', tone: 'neutral' };
  if (t.outOfBounds === true) return { kind: 'outOfBounds', tone: 'alert' };
  let oldest: FollowedStatus['waiting'] | undefined;
  const consider = (kind: 'task' | 'flash', id: string, whenMs: number) => {
    const ageMs = Number.isFinite(whenMs) && whenMs <= now ? now - whenMs : 0;
    if (!oldest || ageMs > oldest.ageMs) oldest = { kind, id, ageMs };
  };
  for (const [id, s] of Object.entries(t.taskSubmissions && typeof t.taskSubmissions === 'object' ? t.taskSubmissions : {})) {
    if (s && s.status === 'pending') consider('task', id, at(s.submittedAt));
  }
  for (const [id, c] of Object.entries(t.flashClaims && typeof t.flashClaims === 'object' ? t.flashClaims : {})) {
    if (c && c.status === 'submitted') consider('flash', id, Number.isFinite(at(c.submittedAt)) ? at(c.submittedAt) : at(c.at));
  }
  if (oldest) return { kind: 'waitingReview', tone: 'warn', waiting: oldest };
  if (t.status === 'finished') return { kind: 'finished', tone: 'neutral' };
  if (input?.stuck === true) return { kind: 'stuck', tone: 'warn' };
  if (t.held === true) return { kind: 'held', tone: 'warn' };
  if (t.launched === false) return { kind: 'notStarted', tone: 'neutral' };
  return { kind: 'playing', tone: 'neutral' };
}

export type FollowedAction =
  | { kind: 'approve'; item: { kind: 'task' | 'flash'; id: string } }
  | { kind: 'openAlert' } | { kind: 'resume' } | { kind: 'start' } | { kind: 'letIn'; taskId: string };

/**
 * The single action a followed team's card offers, or null (the card then only opens the team page).
 * Only what this person may do: `caps` mirrors the staff capabilities (the organizer has all of them;
 * `start` is the organizer's alone).
 */
export function followedTeamAction(
  status: FollowedStatus,
  caps: { review?: boolean; route?: boolean; hold?: boolean; start?: boolean; safety?: boolean },
  opts?: { sealedTaskId?: string | null },
): FollowedAction | null {
  const c = caps ?? {};
  switch (status?.kind) {
    case 'sos': return c.safety ? { kind: 'openAlert' } : null;
    case 'waitingReview': return c.review && status.waiting ? { kind: 'approve', item: { kind: status.waiting.kind, id: status.waiting.id } } : null;
    case 'held': return c.hold ? { kind: 'resume' } : null;
    case 'notStarted': return c.start ? { kind: 'start' } : null;
    case 'playing': case 'stuck':
      return c.route && typeof opts?.sealedTaskId === 'string' && opts.sealedTaskId ? { kind: 'letIn', taskId: opts.sealedTaskId } : null;
    default: return null;
  }
}

/** The one colour of a followed team on every map: indigo, never a warning colour (amber / red). */
export const FOLLOWED_MARKER_COLOR = '#4f46e5';

/**
 * How a team is drawn on a map (Ahiya: "see them on the map in a different colour"). A followed team is
 * bigger, in FOLLOWED_MARKER_COLOR with a ★, shows its name, and sits above the rest; with "mine only"
 * on, every other team is dimmed rather than hidden (a marshal still sees where the others are).
 */
export function teamMarkerLook(teamId: string, followed: readonly string[] | null | undefined, mineOnly: boolean):
  { followed: boolean; dimmed: boolean; zIndex: number } {
  const isFollowed = Array.isArray(followed) && followed.includes(teamId);
  return { followed: isFollowed, dimmed: mineOnly === true && !isFollowed, zIndex: isFollowed ? 2 : 1 };
}

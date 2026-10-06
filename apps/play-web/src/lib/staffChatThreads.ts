// Which team threads the staff app's chat lists (issue 45, Ahiya 2026-10-06: "אני רוצה שלכל איש
// צוות יהיה את הצאט שלו עם הקבוצות, אני רוצה שהוא יוכל לשלוח להם הודעות מעצמו מבחירה שלו").
//
// The thread document still exists once per team, shared by all of HQ (so the team sees one chat and
// the organizer sees everything). What changed is reach: a staff member can START a conversation with
// any team they pick, not only answer a team that already wrote, and can narrow the list to "mine".
// Pure and total; the screen only renders it.

export interface ThreadLike { teamId: string; messages: ReadonlyArray<{ senderId?: string }>; updatedAt: string }

/** Stored threads plus an empty one for every team this staff member opened that has none yet,
 *  the opened ones first (newest pick first), then the rest newest first. */
export function mergeOpenedThreads<T extends ThreadLike>(stored: readonly T[], opened: readonly string[]): ThreadLike[] {
  const rows: ThreadLike[] = Array.isArray(stored) ? [...stored] : [];
  const have = new Set(rows.map((r) => r.teamId));
  const fresh = (Array.isArray(opened) ? opened : [])
    .filter((id, i, a) => typeof id === 'string' && id && a.indexOf(id) === i && !have.has(id))
    .map((teamId) => ({ teamId, messages: [], updatedAt: '' }));
  return [...fresh, ...rows];
}

/** "Mine": a thread I wrote in, a team I opened, or a team I follow. */
export function isMyThread(th: ThreadLike, myUid: string | null | undefined, followed: readonly string[], opened: readonly string[]): boolean {
  if (followed.includes(th.teamId) || opened.includes(th.teamId)) return true;
  return !!myUid && th.messages.some((m) => m && m.senderId === myUid);
}

/** The teams offered by "new message", filtered by a search, sorted by name. Teams that already have
 *  a thread are offered too (picking one just opens it), so the list is the whole run. */
export function pickableTeams<T extends { id: string; displayName?: string }>(teams: readonly T[], query: string): T[] {
  const q = (query ?? '').trim().toLowerCase();
  return (Array.isArray(teams) ? teams : [])
    .filter((tm) => tm && typeof tm.id === 'string')
    .filter((tm) => !q || (tm.displayName ?? '').toLowerCase().includes(q))
    .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '', 'he'));
}

// CSV export + roster search/sort for the admin dashboard
// (change: admin-engagement-and-outreach). Pure, so the escaping rules are pinned by
// adminUsersExport.test.ts rather than discovered when a name containing a comma
// silently shifts every column after it.
import { engagementParts, type AdminUserSummary } from '@rushpoint/shared';

const HEADERS = [
  'email', 'name', 'signed_up', 'last_active', 'games_created',
  'runs_launched', 'players_reached', 'minutes_on_site', 'uid',
] as const;

/**
 * Escape one CSV field.
 *
 * Two separate hazards:
 *  • Structural — a comma, quote or newline must be quoted, or the row shape breaks.
 *  • Formula injection — a field starting with = + - or @ is EXECUTED by Excel and
 *    Google Sheets when the file is opened. This export is a list of real people's
 *    names, i.e. attacker influenced text, so a leading control character is prefixed
 *    with a single quote to neutralise it. Escaping for the parser is not enough.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** The roster as a CSV document, header row first. Minutes rather than milliseconds:
 *  the file is for a human in a spreadsheet, not for a machine. */
export function buildAdminUsersCsv(users: AdminUserSummary[]): string {
  const rows = users.map((u) => {
    const { hours, minutes } = engagementParts(u.engagementMs);
    return [
      u.email, u.displayName, u.createdAt, u.lastActiveAt,
      u.gamesCreatedCount, u.runsLaunchedCount, u.participantsReached,
      hours * 60 + minutes, u.uid,
    ].map(csvField).join(',');
  });
  return [HEADERS.join(','), ...rows].join('\n') + '\n';
}

/** Case insensitive substring match over the two fields a human would search by.
 *  Total: a row with no email or no name is still matched on whatever it does have. */
export function filterUsers(users: AdminUserSummary[], query: string): AdminUserSummary[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return users;
  return users.filter((u) =>
    (u.email ?? '').toLowerCase().includes(q) || (u.displayName ?? '').toLowerCase().includes(q));
}

export type AdminUserSort = 'lastActive' | 'engagement' | 'games' | 'runs' | 'players';

const NUM = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const TIME = (v: unknown): number => {
  if (typeof v !== 'string') return -Infinity;      // never active sorts last
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : -Infinity;
};

/** Sort a COPY of the roster, most interesting first for every key. Total: a corrupt
 *  or absent value sorts to the bottom rather than throwing or reordering randomly. */
export function sortUsers(users: AdminUserSummary[], key: AdminUserSort): AdminUserSummary[] {
  const by: Record<AdminUserSort, (u: AdminUserSummary) => number> = {
    lastActive: (u) => TIME(u.lastActiveAt),
    engagement: (u) => NUM(u.engagementMs),
    games: (u) => NUM(u.gamesCreatedCount),
    runs: (u) => NUM(u.runsLaunchedCount),
    players: (u) => NUM(u.participantsReached),
  };
  const score = by[key] ?? by.lastActive;
  return [...users].sort((a, b) => score(b) - score(a));
}

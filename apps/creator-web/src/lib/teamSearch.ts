// Find one team among many in the Run Console (change: team-dossier-and-search, D4).
//
// Field report 2026-09-25: "I want to be able to search for a team in teams and scores if I
// have many teams." The console already holds every team row, so this is a pure client
// decision run on every keystroke against live data: total by construction (a malformed row
// narrows the list, it never throws), and stable (ties keep the incoming order, so rows do
// not jump under the organizer's cursor while they type; the staff console learned that one).

export interface TeamSearchRow {
  id: string;
  displayName: string;
  memberNames?: string[];
  /** Names of the phones attached to the team. */
  deviceNames?: string[];
  /** The team's device join code (what a player reads out over the phone). */
  deviceJoinCode?: string;
  pendingReviews?: number;
  launched?: boolean;
  finished?: boolean;
  updatedAt?: string | null;
}

export type TeamFilter = 'all' | 'attention' | 'review' | 'notStarted' | 'finished';
export type TeamSort = 'rank' | 'name' | 'activity';

export interface TeamSearchOptions {
  query?: string;
  filter?: TeamFilter;
  /** Absent keeps the incoming order. */
  sort?: TeamSort;
  /** The console's own attention verdict (lib/teamAttention). Absent = nobody flagged. */
  needsAttention?: (id: string) => boolean;
  /** 1-based leaderboard rank, or null when unranked. */
  rankOf?: (id: string) => number | null;
}

const fold = (s: unknown) => (typeof s === 'string' ? s.toLowerCase() : '');
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function matches(row: TeamSearchRow, q: string): boolean {
  if (!q) return true;
  const fields = [row.displayName, ...strings(row.memberNames), ...strings(row.deviceNames), row.deviceJoinCode];
  return fields.some((f) => fold(f).includes(q));
}

function passes(row: TeamSearchRow, filter: TeamFilter, needsAttention?: (id: string) => boolean): boolean {
  switch (filter) {
    case 'attention': return needsAttention ? needsAttention(row.id) === true : false;
    case 'review': return typeof row.pendingReviews === 'number' && row.pendingReviews > 0;
    case 'notStarted': return row.launched !== true && row.finished !== true;
    case 'finished': return row.finished === true;
    default: return true;
  }
}

export function searchTeams<T extends TeamSearchRow>(rows: readonly T[] | null | undefined, opts: TeamSearchOptions = {}): T[] {
  if (!Array.isArray(rows)) return [];
  const q = fold(opts.query ?? '').trim();
  const filter = opts.filter ?? 'all';
  const valid = rows.filter((r): r is T => !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.displayName === 'string');
  const out = valid.filter((r) => matches(r, q) && passes(r, filter, opts.needsAttention));

  if (!opts.sort) return out;
  // Decorate with the incoming index so every comparator is stable on ties.
  const indexed = out.map((row, i) => ({ row, i }));
  const byIndex = (a: { i: number }, b: { i: number }) => a.i - b.i;
  if (opts.sort === 'rank') {
    const r = (id: string) => {
      const v = opts.rankOf?.(id);
      return typeof v === 'number' && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
    };
    indexed.sort((a, b) => (r(a.row.id) - r(b.row.id)) || byIndex(a, b));
  } else if (opts.sort === 'name') {
    indexed.sort((a, b) => a.row.displayName.localeCompare(b.row.displayName, undefined, { sensitivity: 'base' }) || byIndex(a, b));
  } else if (opts.sort === 'activity') {
    const t = (row: TeamSearchRow) => {
      const ms = typeof row.updatedAt === 'string' ? Date.parse(row.updatedAt) : NaN;
      return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
    };
    indexed.sort((a, b) => (t(b.row) - t(a.row)) || byIndex(a, b));
  }
  return indexed.map((x) => x.row);
}

// CSV export + roster search/sort (change: admin-engagement-and-outreach).
//
// CSV escaping is the kind of thing that looks fine until one creator's display name
// contains a comma and every column after it shifts by one, silently. Pinned here.
import { describe, it, expect } from 'vitest';
import { buildAdminUsersCsv, filterUsers, sortUsers } from './adminUsersExport';
import type { AdminUserSummary } from '@rushpoint/shared';

const user = (over: Partial<AdminUserSummary> = {}): AdminUserSummary => ({
  uid: 'u1', email: 'a@b.com', displayName: 'Ada', createdAt: '2026-01-01T00:00:00.000Z',
  lastSignInAt: null, gamesCreatedCount: 0, games: [], runsLaunchedCount: 0, runs: [],
  lastActiveAt: '2026-02-01T00:00:00.000Z', engagementMs: 0, participantsReached: 0,
  note: '', noteUpdatedAt: null,
  emailed: false, emailedAt: null,
  ...over,
});

describe('buildAdminUsersCsv', () => {
  it('starts with a header row and emits one row per user', () => {
    const csv = buildAdminUsersCsv([user({ uid: 'a' }), user({ uid: 'b' })]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('email');
  });

  it('quotes and escapes a value containing a comma', () => {
    const csv = buildAdminUsersCsv([user({ displayName: 'Savir, Ahiya' })]);
    expect(csv).toContain('"Savir, Ahiya"');
  });

  it('escapes an embedded double quote by doubling it', () => {
    const csv = buildAdminUsersCsv([user({ displayName: 'The "Boss"' })]);
    expect(csv).toContain('"The ""Boss"""');
  });

  it('quotes a value containing a newline so the row cannot split', () => {
    const csv = buildAdminUsersCsv([user({ displayName: 'a\nb' })]);
    // The embedded newline must be INSIDE quotes. Asserting on the quoted field itself
    // rather than on the start of the line, because the name is not the first column.
    expect(csv).toContain('"a\nb"');
    // And a naive line split must therefore see more physical lines than data rows,
    // which is exactly the breakage quoting exists to make survivable.
    expect(csv.trim().split('\n')).toHaveLength(3); // header + 2 physical lines of 1 row
  });

  it('renders a null email as empty, never the text null', () => {
    const csv = buildAdminUsersCsv([user({ email: null, displayName: null })]);
    expect(csv).not.toContain('null');
  });

  it('exports engagement as whole minutes, which is what a human reads', () => {
    const csv = buildAdminUsersCsv([user({ engagementMs: 90 * 60_000 })]);
    expect(csv).toContain('90');
  });

  it('never emits a formula injection prefix unquoted', () => {
    // A leading = or + makes Excel evaluate the cell. Neutralise it.
    const csv = buildAdminUsersCsv([user({ displayName: '=cmd()' })]);
    expect(csv).not.toMatch(/(^|,)=cmd/);
  });
});

describe('filterUsers', () => {
  const rows = [
    user({ uid: '1', email: 'ada@x.com', displayName: 'Ada Lovelace' }),
    user({ uid: '2', email: 'bob@y.com', displayName: 'Bob' }),
    user({ uid: '3', email: null, displayName: 'אחיה סביר' }),
  ];

  it('returns everything for an empty query', () => {
    expect(filterUsers(rows, '')).toHaveLength(3);
    expect(filterUsers(rows, '   ')).toHaveLength(3);
  });

  it('matches on email, case insensitively', () => {
    expect(filterUsers(rows, 'ADA@')).toHaveLength(1);
  });

  it('matches on display name', () => {
    expect(filterUsers(rows, 'lovelace')).toHaveLength(1);
  });

  it('matches Hebrew names', () => {
    expect(filterUsers(rows, 'אחיה')).toHaveLength(1);
  });

  it('a row with no email is still searchable by name and never throws', () => {
    expect(() => filterUsers(rows, 'x')).not.toThrow();
  });

  it('returns empty for no match rather than everything', () => {
    expect(filterUsers(rows, 'zzzznomatch')).toHaveLength(0);
  });
});

describe('sortUsers', () => {
  const a = user({ uid: 'a', displayName: 'A', engagementMs: 100, gamesCreatedCount: 5, lastActiveAt: '2026-01-01T00:00:00.000Z' });
  const b = user({ uid: 'b', displayName: 'B', engagementMs: 300, gamesCreatedCount: 1, lastActiveAt: '2026-03-01T00:00:00.000Z' });
  const c = user({ uid: 'c', displayName: 'C', engagementMs: 200, gamesCreatedCount: 3, lastActiveAt: null });

  it('sorts by last active, most recent first, with never-active last', () => {
    expect(sortUsers([a, b, c], 'lastActive').map((u) => u.uid)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by time on site, highest first', () => {
    expect(sortUsers([a, b, c], 'engagement').map((u) => u.uid)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by games created, highest first', () => {
    expect(sortUsers([a, b, c], 'games').map((u) => u.uid)).toEqual(['a', 'c', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = [a, b, c];
    sortUsers(input, 'engagement');
    expect(input.map((u) => u.uid)).toEqual(['a', 'b', 'c']);
  });

  it('is stable and total on corrupt rows', () => {
    const bad = user({ uid: 'x', engagementMs: undefined as never, lastActiveAt: undefined as never });
    expect(() => sortUsers([a, bad], 'engagement')).not.toThrow();
    expect(sortUsers([a, bad], 'engagement')).toHaveLength(2);
  });
});

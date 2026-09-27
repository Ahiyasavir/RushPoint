// team-dossier-and-search D4: finding one team among many, mid-event.
import { describe, it, expect } from 'vitest';
import { searchTeams, type TeamSearchRow } from '../teamSearch';

const rows: TeamSearchRow[] = [
  { id: 't1', displayName: 'האריות', memberNames: ['דנה', 'יוסי'], deviceNames: ['הטלפון של דנה'], deviceJoinCode: 'AB12CD',
    pendingReviews: 0, launched: true, finished: false, updatedAt: '2026-09-26T10:05:00Z' },
  { id: 't2', displayName: 'Eagles', memberNames: ['Noa'], deviceNames: [], deviceJoinCode: 'ZZ99YY',
    pendingReviews: 2, launched: true, finished: false, updatedAt: '2026-09-26T10:20:00Z' },
  { id: 't3', displayName: 'הנמרים', memberNames: [], deviceNames: [], pendingReviews: 0,
    launched: false, finished: false, updatedAt: '2026-09-26T09:00:00Z' },
  { id: 't4', displayName: 'Bears', memberNames: ['dan'], pendingReviews: 0,
    launched: true, finished: true, updatedAt: '2026-09-26T10:10:00Z' },
];
const ids = (r: TeamSearchRow[]) => r.map((x) => x.id);

describe('searchTeams: query', () => {
  it('an empty query returns every team in the incoming order', () => {
    expect(ids(searchTeams(rows, { query: '  ' }))).toEqual(['t1', 't2', 't3', 't4']);
  });
  it('matches the team name, Hebrew and Latin (case folded)', () => {
    expect(ids(searchTeams(rows, { query: 'נמר' }))).toEqual(['t3']);
    expect(ids(searchTeams(rows, { query: 'EAG' }))).toEqual(['t2']);
  });
  it('matches a member name, the field report example "דנ"', () => {
    expect(ids(searchTeams(rows, { query: 'דנ' }))).toEqual(['t1']);
  });
  it('matches a phone name and the team code', () => {
    expect(ids(searchTeams(rows, { query: 'הטלפון של' }))).toEqual(['t1']);
    expect(ids(searchTeams(rows, { query: 'zz99' }))).toEqual(['t2']);
  });
  it('a Latin member match is case-insensitive', () => {
    expect(ids(searchTeams(rows, { query: 'DAN' }))).toEqual(['t4']);
  });
  it('malformed rows narrow the list, never throw', () => {
    const junk = [...rows, null, { id: 'x' }, { id: 'y', displayName: 5, memberNames: 'nope' }] as never;
    expect(() => searchTeams(junk, { query: 'a' })).not.toThrow();
    expect(searchTeams(null as never, { query: 'a' })).toEqual([]);
  });
});

describe('searchTeams: quick filters', () => {
  it('waiting for review', () => {
    expect(ids(searchTeams(rows, { filter: 'review' }))).toEqual(['t2']);
  });
  it('not started, and finished', () => {
    expect(ids(searchTeams(rows, { filter: 'notStarted' }))).toEqual(['t3']);
    expect(ids(searchTeams(rows, { filter: 'finished' }))).toEqual(['t4']);
  });
  it('needs attention uses the console\'s own verdict', () => {
    expect(ids(searchTeams(rows, { filter: 'attention', needsAttention: (id) => id === 't3' || id === 't4' }))).toEqual(['t3', 't4']);
    expect(ids(searchTeams(rows, { filter: 'attention' }))).toEqual([]);
  });
  it('query and filter combine', () => {
    expect(ids(searchTeams(rows, { query: 'e', filter: 'review' }))).toEqual(['t2']);
  });
});

describe('searchTeams: sort', () => {
  it('by rank, unranked last, ties keep the incoming order', () => {
    const rank = new Map([['t4', 1], ['t2', 2]]);
    expect(ids(searchTeams(rows, { sort: 'rank', rankOf: (id) => rank.get(id) ?? null }))).toEqual(['t4', 't2', 't1', 't3']);
  });
  it('by name, locale aware', () => {
    expect(ids(searchTeams(rows, { sort: 'name' }))[0]).toBe('t4'); // "Bears" first among Latin names
  });
  it('by last activity, most recent first, unknown last', () => {
    const withUnknown = [...rows, { id: 't5', displayName: 'X', updatedAt: null } as TeamSearchRow];
    expect(ids(searchTeams(withUnknown, { sort: 'activity' }))).toEqual(['t2', 't4', 't1', 't3', 't5']);
  });
  it('does not mutate its input', () => {
    const copy = [...rows];
    searchTeams(rows, { sort: 'name' });
    expect(rows).toEqual(copy);
  });
});

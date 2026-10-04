// "הקבוצות שלי" in the run console (change: followed-teams). The list is kept per run and per person
// on this device; the rules (cap, prune, toggle) are pure in @rushpoint/shared. Storage may be blocked
// (private mode, cleared data): the list then lives for this session only, and nothing throws.
// Deliberately a copy of play-web's hook of the same name (packages/shared holds no React).
import { useCallback, useEffect, useState } from 'react';
import { readFollowed, toggleFollowed } from '@rushpoint/shared';

const keyOf = (runId: string, uid: string) => `rp-follow:${runId}:${uid}`;
const mineKeyOf = (key: string) => `${key}:mine`;

function load(key: string): string[] {
  try { return readFollowed(window.localStorage.getItem(key), null); } catch { return []; }
}
function loadMine(key: string): boolean {
  try { return window.localStorage.getItem(mineKeyOf(key)) === '1'; } catch { return false; }
}

/**
 * `teamIds` is the run's roster, or null while it has not loaded: a stored team is only dropped once
 * the roster is KNOWN not to hold it (pruning against an empty, still-loading list would forget
 * every followed team on each page load).
 */
export function useFollowedTeams(runId: string | undefined, uid: string | undefined, teamIds: readonly string[] | null) {
  const key = runId && uid ? keyOf(runId, uid) : null;
  const [list, setList] = useState<string[]>(() => (key ? load(key) : []));
  // A marshal who looks only at their own teams keeps that view across reloads.
  const [mineOnly, setMineOnlyState] = useState(() => (key ? loadMine(key) : false));

  useEffect(() => { setList(key ? load(key) : []); setMineOnlyState(key ? loadMine(key) : false); }, [key]);

  const rosterKey = teamIds ? teamIds.join(',') : null;
  useEffect(() => {
    if (!teamIds) return;
    setList((cur) => {
      const kept = cur.filter((id) => teamIds.includes(id));
      return kept.length === cur.length ? cur : kept;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey]);

  useEffect(() => {
    if (!key) return;
    try { window.localStorage.setItem(key, JSON.stringify(list)); } catch { /* this session only */ }
  }, [key, list]);

  const setMineOnly = useCallback((on: boolean) => {
    setMineOnlyState(on);
    if (key) { try { window.localStorage.setItem(mineKeyOf(key), on ? '1' : '0'); } catch { /* this session only */ } }
  }, [key]);

  /** Follow or unfollow; returns 'full' when a ninth team was refused. */
  const toggle = useCallback((teamId: string): 'full' | undefined => {
    const r = toggleFollowed(list, teamId);
    if (!r.refused) setList(r.list);
    return r.refused;
  }, [list]);

  // "Mine only" with nobody followed would show an empty console: it only applies once there is a list.
  return { list, isFollowed: (id: string) => list.includes(id), toggle, mineOnly: mineOnly && list.length > 0, setMineOnly };
}

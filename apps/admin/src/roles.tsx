import React, { createContext, useCallback, useContext, useState } from 'react';

// ─── Roles ──────────────────────────────────────────────────────────────────
// Simple (demo-grade) role gating: the operator picks who they are on first
// load; the choice is persisted locally and decides which admin pages/tabs are
// visible. There is no server-enforced claim here — see CLAUDE.md (assertJudge
// is already relaxed on the emulator). Swap for custom claims for production.
export type Role =
  | 'manager'
  | 'judge'
  | 'operator'
  | 'volunteer'
  | 'duelModerator'
  | 'arrivalApprover'
  | 'teneDistributor';

export const ALL_ROLES: Role[] = [
  'manager',
  'judge',
  'operator',
  'volunteer',
  'duelModerator',
  'arrivalApprover',
  'teneDistributor',
];

const ROLE_KEY    = 'rushpoint.admin.role';
const STATION_KEY = 'rushpoint.admin.stationId';

// Which route paths each role may see. The nav bar and the router both gate on
// this, so an out-of-scope deep link redirects to the role's first allowed page.
export const ROLE_ROUTES: Record<Role, string[]> = {
  // Event manager: full access to everything, including sensitive controls
  // (flash missions, leaderboard finalize, score overrides, station control).
  manager:   ['/control', '/heatmap', '/teams', '/checkins', '/leaderboard', '/judge', '/matchmaking', '/manager', '/builder', '/access-codes', '/station-reviews', '/readiness'],
  // Tene judge: only the grading console.
  judge:     ['/judge'],
  // Station operator: only their per-station console.
  operator:  ['/station'],
  // Volunteer (roaming / queue marshal): all-teams view with info, fines,
  // and the live emergency/help feed.
  volunteer: ['/volunteer'],
  // Duel moderator: runs the gate 1v1 matchmaking console only.
  duelModerator: ['/matchmaking'],
  // Arrival approver: manages the judge-arrival queue (check in / remove).
  arrivalApprover: ['/checkins'],
  // Tene distributor: per-hub console to hand baskets out and start the
  // 20-minute crafting clock for each team at their hub.
  teneDistributor: ['/tene'],
};

export function defaultRouteFor(role: Role): string {
  return ROLE_ROUTES[role][0] ?? '/';
}

export function canAccess(role: Role, path: string): boolean {
  return ROLE_ROUTES[role].some((r) => path === r || path.startsWith(r + '/'));
}

// ─── Context ────────────────────────────────────────────────────────────────
interface RoleState {
  role: Role | null;
  // The station a 'operator' supervises, stored as the station's **taskId** (the
  // doc id in public/data/tasks). Picked once at role-select; drives the whole
  // Station console — no second selection. Null for non-operator roles.
  stationId: string | null;
  setRole: (role: Role, stationId?: string) => void;
  clearRole: () => void;
}

const RoleContext = createContext<RoleState | undefined>(undefined);

function readStored<T extends string>(key: string): T | null {
  try {
    return ((globalThis as { localStorage?: Storage }).localStorage?.getItem(key) as T) ?? null;
  } catch {
    return null;
  }
}

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState]           = useState<Role | null>(() => readStored<Role>(ROLE_KEY));
  const [stationId, setStationIdState] = useState<string | null>(() => readStored<string>(STATION_KEY));

  const setRole = useCallback((next: Role, station?: string) => {
    try {
      const ls = (globalThis as { localStorage?: Storage }).localStorage;
      ls?.setItem(ROLE_KEY, next);
      if (next === 'operator' && station) ls?.setItem(STATION_KEY, station);
      else ls?.removeItem(STATION_KEY);
    } catch { /* storage unavailable */ }
    setRoleState(next);
    setStationIdState(next === 'operator' ? (station ?? null) : null);
  }, []);

  const clearRole = useCallback(() => {
    try {
      const ls = (globalThis as { localStorage?: Storage }).localStorage;
      ls?.removeItem(ROLE_KEY);
      ls?.removeItem(STATION_KEY);
    } catch { /* storage unavailable */ }
    setRoleState(null);
    setStationIdState(null);
  }, []);

  return (
    <RoleContext.Provider value={{ role, stationId, setRole, clearRole }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleState {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within a RoleProvider');
  return ctx;
}

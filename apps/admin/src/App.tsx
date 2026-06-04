import React, { useCallback, useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { onSnapshot, collection } from 'firebase/firestore';
import type { PendingArrival } from '@rushpoint/shared';
import HeatmapPage from './pages/HeatmapPage';
import TeamsPage from './pages/TeamsPage';
import CheckInsPage from './pages/CheckInsPage';
import LeaderboardPage from './pages/LeaderboardPage';
import JudgePage from './pages/JudgePage';
import MatchmakingPage from './pages/MatchmakingPage';
import ManagerPage from './pages/ManagerPage';
import ControlRoomPage from './pages/ControlRoomPage';
import BuilderPage from './pages/BuilderPage';
import StationPage from './pages/StationPage';
import VolunteerPage from './pages/VolunteerPage';
import TenePage from './pages/TenePage';
import AccessCodesPage from './pages/AccessCodesPage';
import StationReviewPage from './pages/StationReviewPage';
import ReadinessPage from './pages/ReadinessPage';
import RoleSelect from './components/RoleSelect';
import { useI18n } from './i18n';
import { useRole, canAccess, defaultRouteFor } from './roles';
import { db, APP_ID, ensureAuth } from './services/firebase';
import { callable } from './services/api';
import { usePoll } from './hooks/usePoll';

const listPendingArrivals = callable<void, { arrivals: PendingArrival[] }>('listPendingArrivals');

// Master nav list. Each item is shown only if the active role may access its
// route (see ROLE_ROUTES in roles.tsx).
const NAV_ITEMS = [
  { to: '/control', key: 'nav.control' },
  { to: '/heatmap', key: 'nav.liveMap' },
  { to: '/teams', key: 'nav.teams' },
  { to: '/checkins', key: 'nav.checkins' },
  { to: '/leaderboard', key: 'nav.leaderboard' },
  { to: '/judge', key: 'nav.judge' },
  { to: '/matchmaking', key: 'nav.matchmaking' },
  { to: '/manager', key: 'nav.manager' },
  { to: '/builder', key: 'nav.builder' },
  { to: '/station', key: 'nav.station' },
  { to: '/volunteer', key: 'nav.volunteer' },
  { to: '/tene', key: 'nav.tene' },
  { to: '/access-codes', key: 'nav.codes' },
  { to: '/station-reviews', key: 'nav.review' },
  { to: '/readiness', key: 'nav.readiness' },
];

export default function App() {
  const { t, toggle } = useI18n();
  const { role, stationId, clearRole } = useRole();

  // ── Live nav badge counts (pending check-ins / unacknowledged alerts) ───────
  // Only subscribed for roles that can reach the respective page, so the badge
  // never appears for roles that can't open it.
  const canCheckins = !!role && canAccess(role, '/checkins');
  const canAlerts = !!role && canAccess(role, '/manager');
  const [pendingCount, setPendingCount] = useState(0);
  const [alertCount, setAlertCount] = useState(0);

  const fetchPending = useCallback(async () => {
    if (!canCheckins) return;
    try {
      const { arrivals } = await listPendingArrivals();
      setPendingCount(arrivals.length);
    } catch {
      /* transient — keep last known count */
    }
  }, [canCheckins]);
  usePoll(fetchPending, 15000, canCheckins);

  useEffect(() => {
    if (!canAlerts) {
      setAlertCount(0);
      return;
    }
    let unsub: (() => void) | undefined;
    void ensureAuth().then(() => {
      unsub = onSnapshot(
        collection(db, `artifacts/${APP_ID}/public/data/adminAlerts`),
        (snap) => setAlertCount(snap.docs.filter((d) => d.data().acknowledged !== true).length),
        () => setAlertCount(0),
      );
    });
    return () => unsub?.();
  }, [canAlerts]);

  // No role chosen yet → full-screen role picker.
  if (!role) return <RoleSelect />;

  const home = defaultRouteFor(role);
  const visibleNav = NAV_ITEMS.filter((item) => canAccess(role, item.to));
  const roleLabel = role === 'operator' && stationId
    ? t('role.operatorAt', { n: stationId })
    : t(`role.${role}`);

  // A route element gated by the active role; redirects home if out of scope.
  const guard = (path: string, element: React.ReactNode) =>
    canAccess(role, path) ? element : <Navigate to={home} replace />;

  return (
    <div className="min-h-screen flex flex-col bg-app-bg">
      <header className="sticky top-0 z-50 bg-app-surface/80 backdrop-blur-xl border-b border-glass-border px-6 py-3 flex items-center gap-6">
        <span className="font-brand text-lg font-bold tracking-tight">
          Rush<span className="text-neon-green">Point</span>{' '}
          <span className="text-zinc-500 font-normal text-sm">{t('app.brandSuffix')}</span>
        </span>
        <nav className="flex gap-1">
          {visibleNav.map(({ to, key }) => {
            const badge =
              to === '/checkins' ? pendingCount : to === '/manager' ? alertCount : 0;
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `relative px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-neon-green/10 text-neon-green border border-neon-green/20 rounded-lg'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg'
                  }`
                }
              >
                {t(key)}
                {badge > 0 && (
                  <span className="absolute -top-1 -end-1 bg-neon-red text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                    {badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <button
            onClick={clearRole}
            title={t('role.switch')}
            className="border border-glass-border bg-glass-bg hover:bg-glass-hover text-zinc-300 hover:text-white rounded-lg px-3 py-1.5 text-sm transition-all backdrop-blur-sm"
          >
            <span className="text-zinc-500 me-1.5">●</span>{roleLabel}
          </button>
          <button
            onClick={toggle}
            title={t('lang.label')}
            className="border border-glass-border bg-glass-bg hover:bg-glass-hover text-zinc-300 hover:text-white rounded-lg px-3 py-1.5 text-sm transition-all backdrop-blur-sm"
          >
            {t('lang.toggle')}
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/heatmap" element={guard('/heatmap', <HeatmapPage />)} />
          <Route path="/teams" element={guard('/teams', <TeamsPage />)} />
          <Route path="/checkins" element={guard('/checkins', <CheckInsPage />)} />
          <Route path="/leaderboard" element={guard('/leaderboard', <LeaderboardPage />)} />
          <Route path="/judge" element={guard('/judge', <JudgePage />)} />
          <Route path="/matchmaking" element={guard('/matchmaking', <MatchmakingPage />)} />
          <Route path="/control" element={guard('/control', <ControlRoomPage />)} />
          <Route path="/manager" element={guard('/manager', <ManagerPage />)} />
          <Route path="/builder" element={guard('/builder', <BuilderPage />)} />
          <Route path="/station" element={guard('/station', <StationPage />)} />
          <Route path="/volunteer" element={guard('/volunteer', <VolunteerPage />)} />
          <Route path="/tene" element={guard('/tene', <TenePage />)} />
          <Route path="/access-codes" element={guard('/access-codes', <AccessCodesPage />)} />
          <Route path="/station-reviews" element={guard('/station-reviews', <StationReviewPage />)} />
          <Route path="/readiness" element={guard('/readiness', <ReadinessPage />)} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  );
}

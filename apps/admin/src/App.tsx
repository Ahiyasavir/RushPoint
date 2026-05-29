import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import HeatmapPage from './pages/HeatmapPage';
import TeamsPage from './pages/TeamsPage';
import CheckInsPage from './pages/CheckInsPage';
import LeaderboardPage from './pages/LeaderboardPage';
import JudgePage from './pages/JudgePage';
import MatchmakingPage from './pages/MatchmakingPage';
import ManagerPage from './pages/ManagerPage';
import { useI18n } from './i18n';

const NAV_ITEMS = [
  { to: '/heatmap', key: 'nav.liveMap' },
  { to: '/teams', key: 'nav.teams' },
  { to: '/checkins', key: 'nav.checkins' },
  { to: '/leaderboard', key: 'nav.leaderboard' },
  { to: '/judge', key: 'nav.judge' },
  { to: '/matchmaking', key: 'nav.matchmaking' },
  { to: '/manager', key: 'nav.manager' },
];

export default function App() {
  const { t, toggle } = useI18n();
  return (
    <div className="min-h-screen flex flex-col bg-app-bg">
      <header className="sticky top-0 z-50 bg-app-surface/80 backdrop-blur-xl border-b border-glass-border px-6 py-3 flex items-center gap-6">
        <span className="font-brand text-lg font-bold tracking-tight">
          Rush<span className="text-neon-green">Point</span>{' '}
          <span className="text-zinc-500 font-normal text-sm">{t('app.brandSuffix')}</span>
        </span>
        <nav className="flex gap-1">
          {NAV_ITEMS.map(({ to, key }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-neon-green/10 text-neon-green border border-neon-green/20 rounded-lg'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg'
                }`
              }
            >
              {t(key)}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={toggle}
          title={t('lang.label')}
          className="ms-auto border border-glass-border bg-glass-bg hover:bg-glass-hover text-zinc-300 hover:text-white rounded-lg px-3 py-1.5 text-sm transition-all backdrop-blur-sm"
        >
          {t('lang.toggle')}
        </button>
      </header>

      <main className="flex-1 min-h-0">
        <Routes>
          <Route path="/" element={<Navigate to="/heatmap" replace />} />
          <Route path="/heatmap" element={<HeatmapPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/checkins" element={<CheckInsPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/judge" element={<JudgePage />} />
          <Route path="/matchmaking" element={<MatchmakingPage />} />
          <Route path="/manager" element={<ManagerPage />} />
        </Routes>
      </main>
    </div>
  );
}

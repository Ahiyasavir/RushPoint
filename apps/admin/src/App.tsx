import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import HeatmapPage from './pages/HeatmapPage';
import TeamsPage from './pages/TeamsPage';
import CheckInsPage from './pages/CheckInsPage';
import LeaderboardPage from './pages/LeaderboardPage';
import JudgePage from './pages/JudgePage';
import MatchmakingPage from './pages/MatchmakingPage';
import { useI18n } from './i18n';

const NAV_ITEMS = [
  { to: '/heatmap', key: 'nav.liveMap' },
  { to: '/teams', key: 'nav.teams' },
  { to: '/checkins', key: 'nav.checkins' },
  { to: '/leaderboard', key: 'nav.leaderboard' },
  { to: '/judge', key: 'nav.judge' },
  { to: '/matchmaking', key: 'nav.matchmaking' },
];

export default function App() {
  const { t, toggle } = useI18n();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-3 flex items-center gap-8">
        <span className="font-bold text-lg tracking-tight text-white">
          RushPoint <span className="text-zinc-500 font-normal text-sm">{t('app.brandSuffix')}</span>
        </span>
        <nav className="flex gap-1">
          {NAV_ITEMS.map(({ to, key }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
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
          className="ms-auto px-3 py-1.5 rounded text-sm font-medium text-zinc-300 border border-zinc-700 hover:bg-zinc-800 transition-colors"
        >
          {t('lang.toggle')}
        </button>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/heatmap" replace />} />
          <Route path="/heatmap" element={<HeatmapPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/checkins" element={<CheckInsPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/judge" element={<JudgePage />} />
          <Route path="/matchmaking" element={<MatchmakingPage />} />
        </Routes>
      </main>
    </div>
  );
}

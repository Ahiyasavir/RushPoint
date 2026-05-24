import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import HeatmapPage from './pages/HeatmapPage';
import TeamsPage from './pages/TeamsPage';
import CheckInsPage from './pages/CheckInsPage';
import LeaderboardPage from './pages/LeaderboardPage';
import JudgePage from './pages/JudgePage';

const NAV_ITEMS = [
  { to: '/heatmap', label: 'Live Map' },
  { to: '/teams', label: 'Teams' },
  { to: '/checkins', label: 'Check-ins' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/judge', label: 'Judge' },
];

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-3 flex items-center gap-8">
        <span className="font-bold text-lg tracking-tight text-white">
          RushPoint <span className="text-zinc-500 font-normal text-sm">Admin</span>
        </span>
        <nav className="flex gap-1">
          {NAV_ITEMS.map(({ to, label }) => (
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
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/heatmap" replace />} />
          <Route path="/heatmap" element={<HeatmapPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/checkins" element={<CheckInsPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/judge" element={<JudgePage />} />
        </Routes>
      </main>
    </div>
  );
}

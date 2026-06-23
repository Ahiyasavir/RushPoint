import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './components/AuthGate';
import { useT } from './components/LanguageContext';
import { Spinner } from './components/ui';
import { DialogHost } from './components/dialog';

const DashboardPage  = lazy(() => import('./pages/DashboardPage'));
const BuilderPage    = lazy(() => import('./pages/BuilderPage'));
const GalleryPage    = lazy(() => import('./pages/GalleryPage'));
const WalletPage     = lazy(() => import('./pages/WalletPage'));
const RunConsolePage = lazy(() => import('./pages/RunConsolePage'));
const SettingsPage   = lazy(() => import('./pages/SettingsPage'));
const LegalPage      = lazy(() => import('./pages/LegalPage'));

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('rp-theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('rp-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark] as const;
}

export default function App() {
  const { user, signOut } = useAuth();
  const [dark, setDark] = useDarkMode();
  const t = useT();

  const NAV = [
    { to: '/',        label: t.nav.myGames,  end: true },
    { to: '/gallery', label: t.nav.gallery },
    { to: '/wallet',  label: t.nav.wallet },
    { to: '/settings',label: t.nav.settings },
  ];

  return (
    <div className="relative min-h-screen bg-[--surface-1] dark:bg-[--surface-0] text-[--ink-1] transition-colors duration-250">

      {/* ── Animated mesh gradient ── */}
      <div className="rp-mesh-layer" aria-hidden="true">
        <div className="rp-blob rp-blob-1" />
        <div className="rp-blob rp-blob-2" />
        <div className="rp-blob rp-blob-3" />
      </div>

      {/* ── Header ── */}
      <header className="sticky top-0 z-30 border-b border-[--rp-border] bg-[--surface-1]/80 dark:bg-[--surface-0]/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-6">
          <NavLink to="/" className="font-brand text-xl font-extrabold bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent tracking-tight">
            RushPoint
          </NavLink>
          <nav className="flex items-center gap-0.5 flex-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-rp-fire/10 text-rp-fire dark:bg-rp-fire/15'
                      : 'text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2]'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <span className="text-xs text-[--ink-3] hidden sm:block truncate max-w-[160px]">{user?.displayName ?? user?.email}</span>
          <button
            onClick={() => setDark((d) => !d)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm hover:bg-[--surface-2] transition-colors"
            title={dark ? t.common.lightMode : t.common.darkMode}
          >
            {dark ? '☀️' : '🌙'}
          </button>
          <button onClick={() => signOut()} className="text-xs text-[--ink-3] hover:text-rp-alert transition-colors">
            {t.common.signOut}
          </button>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-4 py-8">
        <Suspense fallback={<Spinner label="…" />}>
          <Routes>
            <Route path="/"                   element={<DashboardPage />} />
            <Route path="/build/:gameId"       element={<BuilderPage />} />
            <Route path="/gallery"             element={<GalleryPage />} />
            <Route path="/wallet"              element={<WalletPage />} />
            <Route path="/run/:gameId/:runId"  element={<RunConsolePage />} />
            <Route path="/settings"            element={<SettingsPage />} />
            <Route path="/privacy"             element={<LegalPage type="privacy" />} />
            <Route path="/terms"               element={<LegalPage type="terms" />} />
          </Routes>
        </Suspense>
      </main>
      <DialogHost />
    </div>
  );
}

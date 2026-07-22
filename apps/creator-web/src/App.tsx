import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { PAYMENTS_ENABLED } from '@rushpoint/shared';
import { useAuth } from './components/AuthGate';
import { useT } from './components/LanguageContext';
import { Spinner } from './components/ui';
import { DialogHost } from './components/dialog';
import { ToastHost } from './components/toast';
import ActiveRunBar from './components/ActiveRunBar';

const DashboardPage  = lazy(() => import('./pages/DashboardPage'));
const BuilderPage    = lazy(() => import('./pages/BuilderPage'));
const GalleryPage    = lazy(() => import('./pages/GalleryPage'));
const WalletPage     = lazy(() => import('./pages/WalletPage'));
const RunConsolePage = lazy(() => import('./pages/RunConsolePage'));
const RunsOverviewPage = lazy(() => import('./pages/RunsOverviewPage'));
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
  // The Builder is a full-width workspace (3-pane shell); every other route reads
  // best as a centred column. Widen the main container only on /build/*.
  const pathname = useLocation().pathname;
  const isBuilder = pathname.startsWith('/build/');

  // Mobile nav drawer: below `sm` the inline links collapse behind a hamburger.
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the drawer whenever the route changes (a link was tapped).
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // Free mode: hide the wallet/credits surface entirely while payments are off.
  const NAV = [
    { to: '/',        label: t.nav.myGames,  end: true },
    { to: '/live',    label: t.nav.liveRuns },
    { to: '/gallery', label: t.nav.gallery },
    ...(PAYMENTS_ENABLED ? [{ to: '/wallet', label: t.nav.wallet }] : []),
    { to: '/settings',label: t.nav.settings },
  ];

  return (
    // The Builder is an app-like, fixed-height workspace (no page scroll); every
    // other route is a normal scrolling document.
    <div className={`relative bg-[--surface-1] dark:bg-[--surface-0] text-[--ink-1] transition-colors duration-250 ${isBuilder ? 'h-screen overflow-hidden flex flex-col' : 'min-h-screen'}`}>

      {/* ── Animated mesh gradient ── */}
      <div className="rp-mesh-layer" aria-hidden="true">
        <div className="rp-blob rp-blob-1" />
        <div className="rp-blob rp-blob-2" />
        <div className="rp-blob rp-blob-3" />
      </div>

      {/* ── Global header ── hidden in the Builder, which hosts its own compact
          header bar (logo + back) so the workspace gets the full viewport height. */}
      {!isBuilder && (
      <header className="sticky top-0 z-30 shrink-0 border-b border-[--rp-border] bg-[--surface-1]/80 dark:bg-[--surface-0]/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3 sm:gap-6">
          {/* Hamburger — mobile only; toggles the collapsed nav drawer. */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="sm:hidden w-9 h-9 -ms-1 rounded-lg flex items-center justify-center text-lg hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
            aria-label={menuOpen ? t.common.closeMenu : t.common.openMenu}
            aria-expanded={menuOpen}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
          <NavLink to="/" className="font-brand text-xl font-extrabold bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent tracking-tight">
            RushPoint
          </NavLink>
          <nav className="hidden sm:flex items-center gap-0.5 flex-1">
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
          {/* On mobile the inline nav is gone; this spacer keeps the controls end-aligned. */}
          <div className="flex-1 sm:hidden" aria-hidden="true" />
          <span className="text-xs text-[--ink-3] hidden sm:block truncate max-w-[160px]">{user?.displayName ?? user?.email}</span>
          <button
            onClick={() => setDark((d) => !d)}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-sm hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
            aria-label={dark ? t.common.lightMode : t.common.darkMode}
            title={dark ? t.common.lightMode : t.common.darkMode}
          >
            {dark ? '☀️' : '🌙'}
          </button>
          <button onClick={() => signOut()} className="text-xs text-[--ink-3] hover:text-rp-alert transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60">
            {t.common.signOut}
          </button>
        </div>
        {/* Mobile nav drawer — collapses the inline links below `sm`. Closes on
            selection via the pathname effect above. */}
        {menuOpen && (
          <nav className="sm:hidden border-t border-[--rp-border] bg-[--surface-1] dark:bg-[--surface-0] px-3 py-2 flex flex-col gap-0.5">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-lg text-sm font-medium text-start transition-all duration-150 ${
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
        )}
      </header>
      )}

      <main className={`relative z-10 mx-auto w-full ${isBuilder ? 'max-w-[1680px] px-2 py-1.5 flex-1 min-h-0 overflow-hidden' : 'max-w-6xl px-4 py-8'}`}>
        <Suspense fallback={<Spinner label="…" />}>
          <Routes>
            <Route path="/"                   element={<DashboardPage />} />
            <Route path="/build/:gameId"       element={<BuilderPage />} />
            <Route path="/gallery"             element={<GalleryPage />} />
            {PAYMENTS_ENABLED && <Route path="/wallet" element={<WalletPage />} />}
            <Route path="/live"                element={<RunsOverviewPage />} />
            <Route path="/run/:gameId/:runId"  element={<RunConsolePage />} />
            <Route path="/settings"            element={<SettingsPage />} />
            <Route path="/privacy"             element={<LegalPage type="privacy" />} />
            <Route path="/terms"               element={<LegalPage type="terms" />} />
          </Routes>
        </Suspense>
      </main>
      {/* Sibling of the hosts (outside <main>) so it survives every route change. */}
      <ActiveRunBar />
      <DialogHost />
      <ToastHost />
    </div>
  );
}

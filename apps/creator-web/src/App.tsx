import { Suspense, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { PAYMENTS_ENABLED } from '@rushpoint/shared';
import { useAuth } from './components/AuthGate';
import { useEngagementTracker } from './hooks/useEngagementTracker';
import { useIsAdmin } from './hooks/useIsAdmin';
import { useT } from './components/LanguageContext';
import { Spinner } from './components/ui';
import { DialogHost } from './components/dialog';
import { ToastHost } from './components/toast';
import ActiveRunBar from './components/ActiveRunBar';
import { buildNavDestinations } from './lib/creatorNav';
import AppFooter from './components/AppFooter';
// First-run guided tour (change: creator-guided-tour). Mounted once, renders
// nothing unless it is running, and is replayable from here and from Settings.
import CreatorTour, { restartCreatorTour } from './components/CreatorTour';
import { lazyWithRetry } from './lib/lazyWithRetry';

// Every route goes through lazyWithRetry, never bare `lazy`: a rebuild or deploy
// renames every hashed chunk, so an open tab's entry bundle asks for a filename
// that no longer exists and the creator gets a crash screen on a healthy app.
const DashboardPage  = lazyWithRetry('dashboard', () => import('./pages/DashboardPage'));
const BuilderPage    = lazyWithRetry('builder', () => import('./pages/BuilderPage'));
const GalleryPage    = lazyWithRetry('gallery', () => import('./pages/GalleryPage'));
const WalletPage     = lazyWithRetry('wallet', () => import('./pages/WalletPage'));
const RunConsolePage = lazyWithRetry('runConsole', () => import('./pages/RunConsolePage'));
const RunsOverviewPage = lazyWithRetry('runsOverview', () => import('./pages/RunsOverviewPage'));
// Run history + the post-run per-player analysis (change: post-run-player-report).
// The report route also owns the spreadsheet export, which dynamic-imports
// `write-excel-file` — so that library is confined to this chunk, not the entry one.
const RunHistoryPage = lazyWithRetry('runHistory', () => import('./pages/RunHistoryPage'));
const RunReportPage  = lazyWithRetry('runReport', () => import('./pages/RunReportPage'));
const SettingsPage   = lazyWithRetry('settings', () => import('./pages/SettingsPage'));
// Recently deleted games (change: recoverable-game-deletion).
const TrashPage      = lazyWithRetry('trash', () => import('./pages/TrashPage'));
const LegalPage      = lazyWithRetry('legal', () => import('./pages/LegalPage'));
// Admin-only platform user activity report (change: admin-user-activity-dashboard).
// Not in buildNavDestinations — reachable only by direct URL, same treatment as /live.
const AdminUsersPage = lazyWithRetry('adminUsers', () => import('./pages/AdminUsersPage'));
// Admin-managed game templates (change: admin-manage-game-templates). Same
// treatment: not in buildNavDestinations, reachable only by direct URL.
const AdminTemplatesPage = lazyWithRetry('adminTemplates', () => import('./pages/AdminTemplatesPage'));
// Contact form messages from the marketing site (change: marketing-site). Same
// treatment again: admin only, direct URL, gated by the page and by the callable.
const AdminContactPage = lazyWithRetry('adminContact', () => import('./pages/AdminContactPage'));

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const stored = localStorage.getItem('rp-theme');
      if (stored) return stored === 'dark';
    } catch { /* storage blocked — fall back to the OS preference */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('rp-theme', dark ? 'dark' : 'light'); } catch { /* storage blocked — no-op */ }
  }, [dark]);
  return [dark, setDark] as const;
}

export default function App() {
  const { user, signOut } = useAuth();
  const [dark, setDark] = useDarkMode();
  const t = useT();
  // Time on site (change: admin-engagement-and-outreach). Gated on `user` so nothing is
  // measured and no call is made for a logged out visitor on the landing page.
  useEngagementTracker(!!user);
  // Decides only whether the admin dashboard appears in the menu (see useIsAdmin).
  const isAdmin = useIsAdmin(user);
  // The Builder is a full-width workspace (3-pane shell); every other route reads
  // best as a centred column. Widen the main container only on /build/*.
  const pathname = useLocation().pathname;
  const isBuilder = pathname.startsWith('/build/');
  // The live run console is an OPERATIONS surface, not a reading surface: it is
  // driven during an event and every row it cannot show is a scroll at the worst
  // possible moment (change: run-console-density). It gets the Builder's width
  // while keeping the ordinary scrolling shell, header and footer.
  const isRunConsole = pathname.startsWith('/run/');

  // Mobile nav drawer: below `sm` the inline links collapse behind a hamburger.
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the drawer whenever the route changes (a link was tapped).
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // One rule, rendered twice (desktop links + mobile drawer), so the two can
  // never diverge. Free mode hides the wallet entry; `/live` is no longer a
  // primary destination but its ROUTE below stays registered.
  const NAV = buildNavDestinations({ paymentsEnabled: PAYMENTS_ENABLED, isAdmin }).map((n) => ({
    ...n,
    label: t.nav[n.id],
  }));

  return (
    // The Builder is an app-like, fixed-height workspace (no page scroll); every
    // other route is a normal scrolling document. The Builder's height uses
    // `rp-h-dvh` (index.css), not a bare `h-dvh` Tailwind class: Tailwind's
    // compiled order puts `.h-dvh` BEFORE `.h-screen` in this build, so pairing
    // the two utility classes would let `h-screen`'s later, equal-specificity
    // rule always win — silently reverting to vh on every browser instead of
    // tracking the keyboard on the ones that support dvh. `rp-h-dvh` uses
    // `@supports` for an unambiguous, order-independent fallback instead.
    <div className={`relative bg-[--surface-1] dark:bg-[--surface-0] text-[--ink-1] transition-colors duration-250 ${isBuilder ? 'rp-h-dvh overflow-hidden flex flex-col' : 'min-h-screen overflow-x-clip'}`}>

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
                data-tour={`nav-${n.id}`}
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
          {/* The help affordance: replays the guided tour from step one, for a
              creator who skipped it or wants it again. */}
          <button
            onClick={() => restartCreatorTour()}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
            aria-label={t.tour.helpLabel}
            title={t.tour.helpLabel}
          >
            ?
          </button>
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

      <main className={`relative z-10 mx-auto w-full ${isBuilder ? 'max-w-[1680px] px-2 py-1.5 flex-1 min-h-0 overflow-hidden'
        : isRunConsole ? 'max-w-[1680px] px-4 py-5'
        : 'max-w-6xl px-4 py-8'}`}>
        <Suspense fallback={<Spinner label="…" />}>
          <Routes>
            <Route path="/"                   element={<DashboardPage />} />
            <Route path="/build/:gameId"       element={<BuilderPage />} />
            <Route path="/gallery"             element={<GalleryPage />} />
            {PAYMENTS_ENABLED && <Route path="/wallet" element={<WalletPage />} />}
            {/* Not in the primary nav (see buildNavDestinations), but deliberately
                still registered: the floating bar's "+N more" navigates here and
                bookmarks must keep resolving. */}
            <Route path="/live"                element={<RunsOverviewPage />} />
            <Route path="/history"             element={<RunHistoryPage />} />
            <Route path="/report/:gameId/:runId" element={<RunReportPage />} />
            <Route path="/run/:gameId/:runId"  element={<RunConsolePage />} />
            <Route path="/settings"            element={<SettingsPage />} />
            <Route path="/trash"               element={<TrashPage />} />
            {/* Admin-only, not in buildNavDestinations — reachable only by direct
                URL (bookmark it); the page itself gates on the admin claim. */}
            <Route path="/admin/users"         element={<AdminUsersPage />} />
            <Route path="/admin/templates"     element={<AdminTemplatesPage />} />
            <Route path="/admin/contact"       element={<AdminContactPage />} />
            <Route path="/privacy"             element={<LegalPage type="privacy" />} />
            <Route path="/terms"               element={<LegalPage type="terms" />} />
          </Routes>
        </Suspense>
      </main>

      {/* Legal footer — skipped in the Builder for the same reason as the header:
          that route is a fixed-height workspace that must not grow a page scroll. */}
      {!isBuilder && <AppFooter />}

      {/* Sibling of the hosts (outside <main>) so it survives every route change. */}
      <ActiveRunBar />
      <CreatorTour />
      <DialogHost />
      <ToastHost />
    </div>
  );
}

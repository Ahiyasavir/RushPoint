import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './components/AuthGate';
import { Spinner } from './components/ui';
import { DialogHost } from './components/dialog';

// Route-level code splitting — the Builder, Gallery and Run console each pull in
// the heavy MapLibre bundle, so they're loaded on demand. The landing + Dashboard
// (the first paint for most visitors) stay in a lean initial chunk.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const BuilderPage = lazy(() => import('./pages/BuilderPage'));
const GalleryPage = lazy(() => import('./pages/GalleryPage'));
const WalletPage = lazy(() => import('./pages/WalletPage'));
const RunConsolePage = lazy(() => import('./pages/RunConsolePage'));

const NAV = [
  { to: '/', label: 'My Games', end: true },
  { to: '/gallery', label: 'Gallery' },
  { to: '/wallet', label: 'Wallet' },
];

export default function App() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-app-bg text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-glass-border bg-app-bg/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-6">
          <NavLink to="/" className="font-brand text-lg font-extrabold text-neon-green">RushPoint</NavLink>
          <nav className="flex items-center gap-1 flex-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm ${isActive ? 'bg-app-raised text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <span className="text-xs text-zinc-500 hidden sm:block">{user?.email ?? user?.displayName}</span>
          <button onClick={() => signOut()} className="text-xs text-zinc-400 hover:text-neon-red">Sign out</button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <Suspense fallback={<Spinner label="Loading…" />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/build/:gameId" element={<BuilderPage />} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/run/:gameId/:runId" element={<RunConsolePage />} />
          </Routes>
        </Suspense>
      </main>
      <DialogHost />
    </div>
  );
}

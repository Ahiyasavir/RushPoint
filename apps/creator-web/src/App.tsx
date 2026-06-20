import { NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './components/AuthGate';
import DashboardPage from './pages/DashboardPage';
import BuilderPage from './pages/BuilderPage';
import GalleryPage from './pages/GalleryPage';
import WalletPage from './pages/WalletPage';
import RunConsolePage from './pages/RunConsolePage';
import { DialogHost } from './components/dialog';

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
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/build/:gameId" element={<BuilderPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/run/:gameId/:runId" element={<RunConsolePage />} />
        </Routes>
      </main>
      <DialogHost />
    </div>
  );
}

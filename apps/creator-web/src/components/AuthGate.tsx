import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import {
  watchAuth,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  signOut as fbSignOut,
} from '../services/firebase';
import { Button, Card, Input, Label } from './ui';

interface AuthCtx {
  user: User | null;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>({ user: null, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => watchAuth((u) => { setUser(u); setReady(true); }), []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-neon-green/30 border-t-neon-green animate-spin" />
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return <Ctx.Provider value={{ user, signOut: () => fbSignOut() }}>{children}</Ctx.Provider>;
}

function LoginScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(''); setBusy(true);
    try {
      if (mode === 'in') await signInWithEmail(email, password);
      else await signUpWithEmail(email, password);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setErr(''); setBusy(true);
    try { await signInWithGoogle(); }
    catch (e) { setErr(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Failed'); }
    finally { setBusy(false); }
  }

  const authCard = (
      <Card className="w-full max-w-sm p-7 relative">
        <div className="mb-6 text-center">
          <h1 className="font-brand text-2xl font-extrabold text-neon-green tracking-tight">RushPoint</h1>
          <p className="text-zinc-500 text-sm mt-1">Build &amp; run your own race adventures</p>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="email" />
          </div>
          <div>
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </div>

          {err && <p className="text-neon-red text-xs">{err}</p>}

          <Button className="w-full" disabled={busy || !email || !password} onClick={submit}>
            {mode === 'in' ? 'Sign in' : 'Create account'}
          </Button>

          <div className="flex items-center gap-3 text-zinc-600 text-xs">
            <div className="flex-1 h-px bg-glass-border" /> or <div className="flex-1 h-px bg-glass-border" />
          </div>

          <Button variant="ghost" className="w-full" disabled={busy} onClick={google}>
            Continue with Google
          </Button>

          <p className="text-center text-xs text-zinc-500">
            {mode === 'in' ? 'No account yet?' : 'Already have an account?'}{' '}
            <button className="text-neon-green hover:underline" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
              {mode === 'in' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </Card>
  );

  return <Landing authCard={authCard} />;
}

// Public marketing landing — what a logged-out visitor (or a participant who
// followed the viral CTA from the finish screen) sees. Sells the product, then
// drops them into the embedded sign-in card.
const FEATURES = [
  { icon: '🎯', title: 'Visual builder', body: 'Drag stages and geolocated tasks onto a map. Quiz, photo, geofence, smart-station, sequence — no code.' },
  { icon: '🗺️', title: 'Smart routing', body: 'Players are auto-routed between stops by distance, station load, and skill — so teams never bunch up.' },
  { icon: '📡', title: 'Live ops', body: 'Run the event from one console: live map, leaderboard, announcements, flash missions, SOS alerts.' },
  { icon: '🏆', title: 'Auto scoring', body: 'Three scoring presets rank teams instantly — speed, fixed points, or smart-weighted. No human judges.' },
];
const STEPS = [
  { n: '1', title: 'Build', body: 'Design stages + tasks in the visual builder, or start from a quick-start template.' },
  { n: '2', title: 'Launch', body: 'Start a live run and share a join code, link, or QR. Players join on their phones.' },
  { n: '3', title: 'Race', body: 'Teams play in the real world; the leaderboard updates automatically until the finish.' },
];

function Landing({ authCard }: { authCard: ReactNode }) {
  return (
    <div className="min-h-screen bg-app-bg text-zinc-100 relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-30 pointer-events-none" />
      <div className="absolute -top-40 -right-40 w-[36rem] h-[36rem] rounded-full bg-neon-green/10 blur-3xl pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4">
        {/* Top bar */}
        <div className="h-16 flex items-center justify-between">
          <span className="font-brand text-lg font-extrabold text-neon-green">RushPoint</span>
          <a href="#signin" className="text-sm text-zinc-400 hover:text-zinc-100">Sign in</a>
        </div>

        {/* Hero */}
        <div className="grid md:grid-cols-2 gap-10 items-center pt-8 pb-16">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-glass-border bg-app-raised px-3 py-1 text-xs text-zinc-400">
              ✨ Real-world team race adventures
            </div>
            <h1 className="font-brand text-4xl sm:text-5xl font-extrabold tracking-tight mt-4 leading-[1.05]">
              Build your own<br /><span className="text-neon-green">race adventure</span>
            </h1>
            <p className="text-zinc-400 text-lg mt-4 max-w-md">
              Design a real-world scavenger-hunt / amazing-race game, launch a live run,
              and score teams automatically. No code, no judges.
            </p>
            <div className="flex items-center gap-3 mt-6">
              <a href="#signin"><Button>Start building — free</Button></a>
              <span className="text-xs text-zinc-500">Demo game included</span>
            </div>
          </div>
          <div id="signin" className="flex md:justify-end justify-center scroll-mt-20">{authCard}</div>
        </div>

        {/* Features */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-16">
          {FEATURES.map((f) => (
            <Card key={f.title} className="p-5">
              <div className="text-2xl">{f.icon}</div>
              <div className="font-semibold mt-2">{f.title}</div>
              <p className="text-sm text-zinc-400 mt-1">{f.body}</p>
            </Card>
          ))}
        </div>

        {/* How it works */}
        <div className="pb-20">
          <h2 className="text-center font-brand text-2xl font-bold mb-8">From idea to start line in minutes</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {STEPS.map((s) => (
              <Card key={s.n} className="p-5">
                <div className="w-8 h-8 rounded-full bg-neon-green/15 text-neon-green font-bold flex items-center justify-center">{s.n}</div>
                <div className="font-semibold mt-3">{s.title}</div>
                <p className="text-sm text-zinc-400 mt-1">{s.body}</p>
              </Card>
            ))}
          </div>
          <div className="text-center mt-10">
            <a href="#signin"><Button>Create your first game</Button></a>
          </div>
        </div>

        <footer className="border-t border-glass-border py-6 text-center text-xs text-zinc-600">
          RushPoint — build &amp; run your own real-world race adventures.
        </footer>
      </div>
    </div>
  );
}

export default AuthProvider;

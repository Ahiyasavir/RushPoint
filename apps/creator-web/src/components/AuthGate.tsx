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
import { claimReferral } from '../services/calls';
import { dialog } from './dialog';
import { REFERRAL_BONUS_ILS, FREE_PARTICIPANTS_PER_RUN } from '@rushpoint/shared';

interface AuthCtx {
  user: User | null;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>({ user: null, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);

// Capture an invite (?ref=<uid>) the moment a visitor lands, before they sign
// up — it's replayed once after auth (see below). Kept in localStorage so it
// survives the OAuth redirect round-trip.
const REF_KEY = 'rp_ref';
const incomingRef = new URLSearchParams(window.location.search).get('ref');
if (incomingRef) { try { localStorage.setItem(REF_KEY, incomingRef); } catch { /* private mode */ } }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => watchAuth((u) => { setUser(u); setReady(true); }), []);

  // Once signed in, redeem a pending invite exactly once (server enforces the
  // one-claim-per-account + no-self-referral rules; we just fire and clear).
  useEffect(() => {
    if (!user) return;
    let ref: string | null = null;
    try { ref = localStorage.getItem(REF_KEY); } catch { /* private mode */ }
    if (!ref || ref === user.uid) { if (ref) { try { localStorage.removeItem(REF_KEY); } catch { /* */ } } return; }
    try { localStorage.removeItem(REF_KEY); } catch { /* */ }
    claimReferral({ referrerUid: ref })
      .then((r) => { if (r.ok && !r.alreadyClaimed) void dialog.alert(`🎁 Referral applied — ₪${r.bonusILS} added to your wallet!`); })
      .catch(() => { /* invalid/expired invite — silently ignore */ });
  }, [user]);

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
        <div className="grid md:grid-cols-2 gap-10 items-center pt-10 pb-20">
          <div>
            {incomingRef ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-neon-green/40 bg-neon-green/10 px-3 py-1 text-xs text-neon-green">
                🎁 You&apos;ve been invited — sign up and you both get ₪{REFERRAL_BONUS_ILS} credit
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-full border border-glass-border bg-app-raised px-3 py-1 text-xs text-zinc-400">
                ✨ Real-world team race adventures
              </div>
            )}
            <h1 className="font-brand text-4xl sm:text-5xl font-extrabold tracking-tight mt-4 leading-[1.05]">
              Build your own<br /><span className="text-neon-green">race adventure</span>
            </h1>
            <p className="text-zinc-400 text-lg mt-4 max-w-md">
              Design a real-world scavenger-hunt / amazing-race game, launch a live run,
              and score teams automatically. No code, no judges.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-6">
              <a href="#signin"><Button>Start building — free</Button></a>
              <a href="#how" className="text-sm text-zinc-400 hover:text-zinc-100 px-2 py-2">See how it works ↓</a>
            </div>
            <div className="flex items-center gap-5 mt-6 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5">✓ No credit card</span>
              <span className="flex items-center gap-1.5">✓ Demo game included</span>
              <span className="flex items-center gap-1.5">✓ {FREE_PARTICIPANTS_PER_RUN} free players / run</span>
            </div>
          </div>
          <div className="flex md:justify-end justify-center"><PhoneMockup /></div>
        </div>

        {/* Sign-up band */}
        <div id="signin" className="scroll-mt-20 flex flex-col items-center pb-20">
          <h2 className="font-brand text-2xl font-bold">Create your free account</h2>
          <p className="text-zinc-500 text-sm mt-1 mb-6">Your first game takes about five minutes.</p>
          {authCard}
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
        <div id="how" className="scroll-mt-20 pb-20">
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

// A pure-CSS mockup of the participant app mid-race — the product visual in the
// hero. Uses the warm "Trail" palette of play-web so the two apps read as one
// brand. No assets, so it can't 404 or slow first paint.
function PhoneMockup() {
  const board = [
    { rank: 1, name: 'The Falafel Five', score: 740, me: false },
    { rank: 2, name: 'Desert Foxes', score: 690, me: true },
    { rank: 3, name: 'Gate Crashers', score: 615, me: false },
  ];
  return (
    <div className="relative w-[260px] shrink-0" aria-hidden="true">
      <div className="absolute -inset-6 rounded-[3rem] bg-orange-500/20 blur-3xl" />
      <div className="relative rounded-[2.5rem] border border-white/10 bg-zinc-950 p-2.5 shadow-2xl">
        <div className="rounded-[2rem] overflow-hidden bg-orange-50">
          {/* status bar */}
          <div className="h-6 bg-orange-50 flex items-center justify-center">
            <div className="w-16 h-1.5 rounded-full bg-zinc-300" />
          </div>
          {/* app header */}
          <div className="px-4 pt-1 pb-3">
            <div className="text-[13px] font-extrabold text-orange-600">Old City Treasure Hunt</div>
            <div className="text-[10px] text-zinc-500">Score: <span className="font-mono text-orange-600">690</span></div>
            <div className="mt-2 flex gap-1">
              <div className="h-1.5 flex-1 rounded-full bg-orange-500" />
              <div className="h-1.5 flex-1 rounded-full bg-orange-500" />
              <div className="h-1.5 flex-1 rounded-full bg-zinc-200" />
            </div>
          </div>
          {/* map */}
          <div className="relative mx-4 h-28 rounded-xl overflow-hidden bg-gradient-to-br from-amber-100 to-orange-200">
            <svg viewBox="0 0 200 110" className="absolute inset-0 w-full h-full">
              <path d="M20 90 C 60 70, 80 40, 130 35 S 180 25, 185 18" fill="none" stroke="#ea580c" strokeWidth="3" strokeDasharray="6 6" strokeLinecap="round" />
              <circle cx="20" cy="90" r="6" fill="#16a34a" />
              <circle cx="130" cy="35" r="5" fill="#ea580c" />
              <circle cx="185" cy="18" r="5" fill="#f97316" />
            </svg>
            <div className="absolute bottom-1.5 right-1.5 text-[9px] bg-white/80 rounded px-1.5 py-0.5 text-zinc-600">240m to next</div>
          </div>
          {/* task card */}
          <div className="m-4 mt-3 rounded-xl border border-orange-200 bg-white p-3">
            <div className="text-[11px] font-semibold text-zinc-800">📷 Photo at Jaffa Gate</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">Snap your whole team under the arch.</div>
            <div className="mt-2 h-6 rounded-lg bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">Submit photo</div>
          </div>
          {/* leaderboard */}
          <div className="mx-4 mb-4 rounded-xl bg-white border border-zinc-200 p-2.5">
            <div className="text-[10px] font-semibold text-zinc-700 mb-1.5">🏆 Leaderboard</div>
            {board.map((r) => (
              <div key={r.rank} className={`flex items-center justify-between text-[10px] py-0.5 ${r.me ? 'text-orange-600 font-bold' : 'text-zinc-500'}`}>
                <span className="truncate"><span className="font-mono me-1.5">{r.rank}</span>{r.name}</span>
                <span className="font-mono">{r.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AuthProvider;

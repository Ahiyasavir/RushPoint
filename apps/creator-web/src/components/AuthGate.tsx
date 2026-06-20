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

  return (
    <div className="min-h-screen bg-app-bg flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-40 pointer-events-none" />
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
    </div>
  );
}

export default AuthProvider;

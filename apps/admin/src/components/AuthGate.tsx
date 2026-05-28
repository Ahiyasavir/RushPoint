import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, ensureAuth } from '../services/firebase';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void ensureAuth();
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setReady(true);
        unsub();
      }
    });
    return unsub;
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border border-neon-green/20 bg-neon-green/5 flex items-center justify-center">
            <div className="w-4 h-4 rounded-full bg-neon-green/30 animate-pulse" />
          </div>
          <span className="text-zinc-600 text-xs font-mono tracking-widest uppercase animate-pulse">Connecting…</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

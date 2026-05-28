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
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <span className="text-zinc-500 text-sm animate-pulse">Connecting…</span>
      </div>
    );
  }

  return <>{children}</>;
}

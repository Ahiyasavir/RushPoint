import { useEffect, useState } from 'react';
import { ensureAuth } from './services/firebase';
import { loadSession, type Session } from './store';
import JoinScreen from './screens/JoinScreen';
import PlayScreen from './screens/PlayScreen';
import { DialogHost } from './components/dialog';

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    ensureAuth().then(() => {
      setSession(loadSession());
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-bg">
        <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
      </div>
    );
  }

  return (
    <>
      {!session
        ? <JoinScreen onJoined={setSession} />
        : <PlayScreen session={session} onLeave={() => setSession(null)} />}
      <DialogHost />
    </>
  );
}

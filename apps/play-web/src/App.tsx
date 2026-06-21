import { useEffect, useState } from 'react';
import { ensureAuth } from './services/firebase';
import { loadSession, loadStaffSession, type Session } from './store';
import JoinScreen from './screens/JoinScreen';
import PlayScreen from './screens/PlayScreen';
import StaffConsole from './screens/StaffConsole';
import { DialogHost } from './components/dialog';

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  // Staff mode is entered via ?staff in the URL or a restored staff session.
  const [staffMode, setStaffMode] = useState(
    () => new URLSearchParams(window.location.search).has('staff') || !!loadStaffSession(),
  );

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

  if (staffMode) {
    return (
      <>
        <StaffConsole onExit={() => setStaffMode(false)} />
        <DialogHost />
      </>
    );
  }

  return (
    <>
      {!session
        ? <JoinScreen onJoined={setSession} onStaff={() => setStaffMode(true)} />
        : <PlayScreen session={session} onLeave={() => setSession(null)} />}
      <DialogHost />
    </>
  );
}

import { useEffect, useState } from 'react';
import { ensureAuth } from './services/firebase';
import { loadSession, loadStaffSession, type Session } from './store';
import JoinScreen from './screens/JoinScreen';
import PlayScreen from './screens/PlayScreen';
import StaffConsole from './screens/StaffConsole';
import GamePromoScreen from './screens/GamePromoScreen';
import PublicLeaderboardScreen from './screens/PublicLeaderboardScreen';
import ConnectionBanner from './components/ConnectionBanner';
import { DialogHost } from './components/dialog';

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  // Staff mode is entered via ?staff in the URL or a restored staff session.
  const [staffMode, setStaffMode] = useState(
    () => new URLSearchParams(window.location.search).has('staff') || !!loadStaffSession(),
  );
  // A shared promo link (`?game=<id>`) shows the public teaser for a game until
  // the visitor chooses to enter a code (or already has a live session).
  const [promoGameId, setPromoGameId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('game'),
  );
  // A shared standings link (`?board=<code>`) shows the public leaderboard.
  const [boardCode, setBoardCode] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('board'),
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
        <ConnectionBanner />
        <StaffConsole onExit={() => setStaffMode(false)} />
        <DialogHost />
      </>
    );
  }

  if (boardCode && !session) {
    return (
      <>
        <ConnectionBanner />
        <PublicLeaderboardScreen code={boardCode} onJoin={() => setBoardCode(null)} />
        <DialogHost />
      </>
    );
  }

  if (promoGameId && !session) {
    return (
      <>
        <ConnectionBanner />
        <GamePromoScreen gameId={promoGameId} onPlay={() => setPromoGameId(null)} />
        <DialogHost />
      </>
    );
  }

  return (
    <>
      <ConnectionBanner />
      {!session
        ? <JoinScreen onJoined={setSession} onStaff={() => setStaffMode(true)} />
        : <PlayScreen session={session} onLeave={() => setSession(null)} />}
      <DialogHost />
    </>
  );
}

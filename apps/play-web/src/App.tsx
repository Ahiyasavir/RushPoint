import { lazy, Suspense, useEffect, useState } from 'react';
import { ensureAuth } from './services/firebase';
import { loadSession, loadStaffSession, type Session } from './store';
import JoinScreen from './screens/JoinScreen';
import PlayScreen from './screens/PlayScreen';
import ConnectionBanner from './components/ConnectionBanner';
import { DialogHost } from './components/dialog';
import { parseChallengeParam, TV_ROUTE_PARAM, RECAP_ROUTE_PARAM } from '@rushpoint/shared';
import { I18nProvider, useT } from './i18nContext';
import { unlockAudio } from './lib/sound';
// Ceremony mode (change: ceremony-mode): lazy so the slideshow/confetti code
// stays out of the main bundle (same pattern as the MapLibre chunk).
const CeremonyScreen = lazy(() => import('./screens/CeremonyScreen'));
const StaffConsole = lazy(() => import('./screens/StaffConsole'));
const GamePromoScreen = lazy(() => import('./screens/GamePromoScreen'));
const PublicLeaderboardScreen = lazy(() => import('./screens/PublicLeaderboardScreen'));
const ChallengeTeaser = lazy(() => import('./screens/ChallengeTeaser'));
const TvLeaderboard = lazy(() => import('./screens/TvLeaderboard'));
const RunRecap = lazy(() => import('./screens/RunRecap'));

export default function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  );
}

function AppInner() {
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
  // `?board=<code>&ceremony` plays the awards finale instead (ceremony-mode).
  const [ceremony] = useState(
    () => new URLSearchParams(window.location.search).has('ceremony'),
  );
  // A "challenge a friend" deep link (`?challenge=<gameId>:<taskId>`) opens the
  // standalone single-task teaser for brand-new (signed-out) visitors.
  const [challenge, setChallenge] = useState(
    () => parseChallengeParam(new URLSearchParams(window.location.search).get('challenge')),
  );
  // A `?tv=<accessCode>` link opens the full-screen projection leaderboard.
  const tvCode = new URLSearchParams(window.location.search).get(TV_ROUTE_PARAM);
  // A `?recap=<accessCode>` link opens the public post-run recap (published only).
  const [recapCode, setRecapCode] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get(RECAP_ROUTE_PARAM),
  );

  const { dir, lang } = useT();

  const routeFallback = (
    <div className="min-h-screen flex items-center justify-center bg-app-bg">
      <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
    </div>
  );

  useEffect(() => {
    // Always leave the loading state, even if anonymous auth fails on a network
    // blip — otherwise the whole app hangs on the spinner forever. On failure we
    // still render (JoinScreen); the join flow re-attempts auth when it runs.
    ensureAuth()
      .then(() => setSession(loadSession()))
      .catch(() => { /* render anyway; do not trap the user on a spinner */ })
      .finally(() => setReady(true));
  }, []);

  // Reflect the active language on the document root for RTL/LTR.
  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
  }, [dir, lang]);

  // Unlock the Web Audio context on the first user gesture (change:
  // audio-haptic-feedback) so later cues are audible under the iOS/Safari autoplay
  // policy. Covers staff + returning sessions that never pass through the Join tap.
  // One-shot: the listeners remove themselves after the first interaction.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
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
        <Suspense fallback={routeFallback}>
          <StaffConsole onExit={() => setStaffMode(false)} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

  if (tvCode) {
    return (
      <>
        <Suspense fallback={routeFallback}>
          <TvLeaderboard code={tvCode} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

  if (recapCode) {
    return (
      <>
        <ConnectionBanner />
        <Suspense fallback={routeFallback}>
          <RunRecap code={recapCode} onJoin={() => setRecapCode(null)} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

  if (challenge && !session) {
    return (
      <>
        <ConnectionBanner />
        <Suspense fallback={routeFallback}>
          <ChallengeTeaser gameId={challenge.gameId} taskId={challenge.taskId} onJoin={() => setChallenge(null)} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

  if (boardCode) {
    return (
      <>
        <ConnectionBanner />
        {ceremony ? (
          <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-app-bg">
              <div className="w-10 h-10 rounded-full border-2 border-rp-fire/30 border-t-rp-fire animate-spin" />
            </div>
          }>
            <CeremonyScreen code={boardCode} />
          </Suspense>
        ) : (
          <Suspense fallback={routeFallback}>
            <PublicLeaderboardScreen code={boardCode} onJoin={() => setBoardCode(null)} />
          </Suspense>
        )}
        <DialogHost />
      </>
    );
  }

  if (promoGameId && !session) {
    return (
      <>
        <ConnectionBanner />
        <Suspense fallback={routeFallback}>
          <GamePromoScreen gameId={promoGameId} onPlay={() => setPromoGameId(null)}
            onInstantPlay={(s) => { setSession(s); setPromoGameId(null); }} />
        </Suspense>
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

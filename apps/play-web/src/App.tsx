import { Suspense, useCallback, useEffect, useState } from 'react';
import { ensureAuth } from './services/firebase';
import { clearSession, loadSession, loadStaffSession, type Session } from './store';
import JoinScreen from './screens/JoinScreen';
import PlayScreen from './screens/PlayScreen';
import ConnectionBanner from './components/ConnectionBanner';
import { DialogHost } from './components/dialog';
import { I18nProvider, useT } from './i18nContext';
import { unlockAudio } from './lib/sound';
import { resolvePlayRoute, resumeOrJoin, stripStaffParams } from './lib/playRoute';
import { lazyWithRetry } from './lib/lazyWithRetry';
// Every participant-facing chunk goes through lazyWithRetry so a stale
// service-worker shell (old hashed chunk 404s after a redeploy) self-heals with a
// one-shot reload instead of hanging Suspense forever — previously only
// StaffConsole was protected (wave-g robustness #2).
const CeremonyScreen = lazyWithRetry('ceremony', () => import('./screens/CeremonyScreen'));
const GamePromoScreen = lazyWithRetry('promo', () => import('./screens/GamePromoScreen'));
const PublicLeaderboardScreen = lazyWithRetry('board', () => import('./screens/PublicLeaderboardScreen'));
const ChallengeTeaser = lazyWithRetry('challenge', () => import('./screens/ChallengeTeaser'));
const TvLeaderboard = lazyWithRetry('tv', () => import('./screens/TvLeaderboard'));
const RunRecap = lazyWithRetry('recap', () => import('./screens/RunRecap'));

const StaffConsole = lazyWithRetry('staff', () => import('./screens/StaffConsole'));

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
  // The URL is the authority for routing (see lib/playRoute.ts). Held in state so
  // a history.replaceState (staff exit) re-resolves the route immediately.
  const [search, setSearch] = useState(() => window.location.search);
  // Staff mode: a stored staff session, or the "I'm staff" button on the join
  // screen. A staff *link* is detected from the URL by the resolver itself.
  const [staffMode, setStaffMode] = useState(() => !!loadStaffSession());
  // A route the visitor dismissed in-app ("I have a code" on the promo/board)
  // without changing the URL. Only ever downgrades to the plain join screen.
  const [dismissed, setDismissed] = useState(false);

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
      .catch(() => { /* render anyway; do not trap the user on a spinner */ })
      .finally(() => {
        const stored = loadSession();
        // Stale-session guard (issue 3): a join code in the URL that points at a
        // run this device is NOT in drops the persisted session, so the player
        // lands in the NEW game instead of silently reopening the old one. A link
        // for the SAME run is a no-op resume and keeps every bit of progress.
        const { clearSession: stale } = resolvePlayRoute({
          search: window.location.search,
          session: stored,
          hasStaffSession: !!loadStaffSession(),
        });
        if (stale) clearSession();
        setSession(stale ? null : stored);
        setReady(true);
      });
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

  // Leaving staff mode MUST rewrite the URL. Otherwise the same address
  // re-resolves — and a legacy staff link carries `game=<gameId>`, which the
  // promo route would happily render, instant-play button and all, quietly
  // turning a marshal into a participant.
  const exitStaff = useCallback(() => {
    const next = stripStaffParams(window.location.search);
    if (next !== window.location.search) {
      window.history.replaceState(null, '', `${window.location.pathname}${next}${window.location.hash}`);
    }
    setSearch(next);
    setStaffMode(false);
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-bg">
        <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
      </div>
    );
  }

  const { route } = resolvePlayRoute({ search, session, hasStaffSession: staffMode });

  if (route.kind === 'staff') {
    return (
      <>
        <ConnectionBanner />
        <Suspense fallback={routeFallback}>
          <StaffConsole ctx={route.ctx} onExit={exitStaff} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

  if (route.kind === 'tv') {
    return (
      <>
        <Suspense fallback={routeFallback}>
          <TvLeaderboard code={route.code} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

  if (route.kind === 'recap' && !dismissed) {
    return (
      <>
        <ConnectionBanner />
        <Suspense fallback={routeFallback}>
          <RunRecap code={route.code} onJoin={() => setDismissed(true)} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

  if (route.kind === 'ceremony') {
    return (
      <>
        <ConnectionBanner />
        <Suspense fallback={
          <div className="min-h-screen flex items-center justify-center bg-app-bg">
            <div className="w-10 h-10 rounded-full border-2 border-rp-fire/30 border-t-rp-fire animate-spin" />
          </div>
        }>
          <CeremonyScreen code={route.code} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

  if (route.kind === 'board' && !dismissed) {
    return (
      <>
        <ConnectionBanner />
        <Suspense fallback={routeFallback}>
          <PublicLeaderboardScreen code={route.code} onJoin={() => setDismissed(true)} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

  if (route.kind === 'challenge' && !dismissed) {
    return (
      <>
        <ConnectionBanner />
        <Suspense fallback={routeFallback}>
          <ChallengeTeaser gameId={route.gameId} taskId={route.taskId} onJoin={() => setDismissed(true)} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

  if (route.kind === 'promo' && !dismissed) {
    return (
      <>
        <ConnectionBanner />
        <Suspense fallback={routeFallback}>
          <GamePromoScreen gameId={route.gameId} onPlay={() => setDismissed(true)}
            onInstantPlay={(s) => { setSession(s); setDismissed(true); }} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

  // wave-g robustness #1: a player WITH an active session who opened an
  // informational overlay (`?board=`/`?recap=`/`?challenge=`/`?game=`) then tapped
  // its "join" button set `dismissed`, dropping the overlay. The bottom render only
  // resumed PlayScreen when `route.kind === 'play'` — which it isn't for those
  // routes — so they landed on a blank JoinScreen (progress survived in
  // localStorage, but it read as being kicked out). resumeOrJoin resumes play
  // whenever a session exists; a visitor with NO session still gets JoinScreen.
  const bottom = resumeOrJoin(route, !!session);
  return (
    <>
      <ConnectionBanner />
      {bottom === 'play' && session
        ? <PlayScreen session={session} onLeave={() => setSession(null)} />
        : <JoinScreen
            initialCode={route.kind === 'join' ? route.code : null}
            onJoined={setSession}
            onStaff={() => setStaffMode(true)}
          />}
      <DialogHost />
    </>
  );
}

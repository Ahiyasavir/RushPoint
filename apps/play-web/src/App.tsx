import { Suspense, useCallback, useEffect, useState } from 'react';
import { ensureAuth } from './services/firebase';
import { clearSession, loadSession, loadStaffSession, type Session } from './store';
import JoinScreen from './screens/JoinScreen';
import ConnectionBanner from './components/ConnectionBanner';
import { DialogHost } from './components/dialog';
import { Spinner } from './components/Spinner';
import { LoadingView } from './components/LoadingView';
import { I18nProvider, useT } from './i18nContext';
import { unlockAudio } from './lib/sound';
import { resolvePlayRoute, resumeOrJoin, stripStaffParams } from './lib/playRoute';
import { demoPromoSearch, shouldOfferDemo } from './lib/demoEntry';
import { lazyWithRetry } from './lib/lazyWithRetry';
// Every participant-facing chunk goes through lazyWithRetry so a stale
// service-worker shell (old hashed chunk 404s after a redeploy) self-heals with a
// one-shot reload instead of hanging Suspense forever — previously only
// StaffConsole was protected (wave-g robustness #2).
// PlayScreen was the LAST statically-imported screen, and by far the heaviest: it
// pulls TaskRunner (2.2k lines) and the whole gameplay engine into the entry
// chunk — which every first-time visitor downloads to look at the JOIN screen,
// before they have a game to play at all. Splitting it is what kept the initial
// payload under budget instead of ratcheting the number a second time.
//
// Safe for a mid-race resume: a player only reaches PlayScreen by joining, which
// is an online action, so the chunk lands while they are already connected and is
// served from the service-worker cache on every later resume. lazyWithRetry
// covers the stale-chunk-404 case a redeploy creates.
const PlayScreen = lazyWithRetry('play', () => import('./screens/PlayScreen'));
const CeremonyScreen = lazyWithRetry('ceremony', () => import('./screens/CeremonyScreen'));
const GamePromoScreen = lazyWithRetry('promo', () => import('./screens/GamePromoScreen'));
const PublicLeaderboardScreen = lazyWithRetry('board', () => import('./screens/PublicLeaderboardScreen'));
const ChallengeTeaser = lazyWithRetry('challenge', () => import('./screens/ChallengeTeaser'));
const TvLeaderboard = lazyWithRetry('tv', () => import('./screens/TvLeaderboard'));
const RunRecap = lazyWithRetry('recap', () => import('./screens/RunRecap'));

const StaffConsole = lazyWithRetry('staff', () => import('./screens/StaffConsole'));
// The legal documents (/terms, /privacy on this origin). Lazy for the same reason
// as every other route AND for weight: the policy text must never sit in the
// participant entry chunk (change: legal-pages-participant-origin).
const LegalScreen = lazyWithRetry('legal', () => import('./screens/LegalScreen'));

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

  const { t, dir, lang } = useT();

  // Route-level Suspense fallback (change: engaging-loaders): a branded, cycling
  // loader instead of a bare chasing ring while a lazy route chunk downloads.
  const routeFallback = (
    <div className="min-h-screen flex items-center justify-center bg-app-bg">
      <LoadingView messages={[t.common.loading, t.common.preparing, t.common.almostThere]} />
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
          pathname: window.location.pathname,
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

  // Leaving a run MUST also drop a `?game=` promo/instant-play param from the URL.
  // Otherwise the session clears but `search` state still carries `game=<id>`, and
  // the resolver re-routes the now-session-less device back to the demo PROMO
  // teaser (playRoute step 9) instead of the app's first page, the JoinScreen. We
  // strip ONLY `game` — join code / staff / tv / recap / board / challenge params
  // are untouched — then reflect it into `search` state so `route` re-derives to
  // `join`. (`game` alone can never be a staff route; that needs owner+run too.)
  const leaveRun = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('game')) {
      params.delete('game');
      const qs = params.toString();
      const next = qs ? `?${qs}` : '';
      window.history.replaceState(null, '', `${window.location.pathname}${next}${window.location.hash}`);
      setSearch(next);
    }
    setSession(null);
  }, []);

  // The cold-launch demo (change: cold-launch-demo-entry). A Play Store install
  // opens the app with a BARE url, which resolves to the access-code prompt and
  // nothing else. This rewrites the URL to the EXISTING public promo route for the
  // flagship instant-play demo, so the resolver re-derives `promo` and
  // GamePromoScreen's "Play now" starts a fresh solo run via `startInstantPlay` —
  // no new route, no new screen, no new callable. `replaceState` (not push)
  // matches exitStaff/leaveRun, and `leaveRun` already strips `game` again on the
  // way out, so finishing the demo returns to the join screen.
  const openDemo = useCallback(() => {
    const next = demoPromoSearch();
    window.history.replaceState(null, '', `${window.location.pathname}${next}${window.location.hash}`);
    setSearch(next);
    setDismissed(false);
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-bg">
        <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
      </div>
    );
  }

  const { route } = resolvePlayRoute({
    search,
    // The path is read for exactly two values, /terms and /privacy. Every other
    // path resolves precisely as it did before, so no player route can shift.
    pathname: window.location.pathname,
    session,
    hasStaffSession: staffMode,
  });

  // Legal documents come first: they must be readable with a session, with a
  // staff session, and with any query param attached.
  if (route.kind === 'legal') {
    return (
      <>
        <Suspense fallback={routeFallback}>
          <LegalScreen doc={route.doc} />
        </Suspense>
        <DialogHost />
      </>
    );
  }

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
            <Spinner size="lg" />
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
        ? (
          <Suspense fallback={routeFallback}>
            <PlayScreen session={session} onLeave={leaveRun} />
          </Suspense>
        )
        : <JoinScreen
            initialCode={route.kind === 'join' ? route.code : null}
            autoJoin={route.kind === 'join' && route.autoJoin === true}
            onJoined={setSession}
            onStaff={() => setStaffMode(true)}
            onDemo={shouldOfferDemo(route, !!session) ? openDemo : undefined}
          />}
      <DialogHost />
    </>
  );
}

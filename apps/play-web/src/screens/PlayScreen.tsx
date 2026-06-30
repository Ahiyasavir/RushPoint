import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { FIRESTORE_PATHS, computeStreak } from '@rushpoint/shared';
import { getMyTeamState, triggerSOS, updateLocation, type MyTeamState } from '../services/calls';
import { db, ensureAuth, uid } from '../services/firebase';
import { clearSession, type Session } from '../store';
import { useWakeLock } from '../hooks/useWakeLock';
import { Button, Progress, Screen } from '../components/ui';
import { useT } from '../i18nContext';
import { dialog } from '../components/dialog';
import TaskRunner from '../components/TaskRunner';
import InRunAlerts from '../components/InRunAlerts';
import type { NavTarget } from '../components/NavMap';
// Lazy-loaded so the heavy MapLibre bundle isn't in the initial download — the
// join screen doesn't need it; it loads when the participant starts racing.
const NavMap = lazy(() => import('../components/NavMap'));
import LiveOps from '../components/LiveOps';
import FinalScreen from './FinalScreen';
import { shareStoryCard } from '../lib/storyCard';

// Creator app — viral CTA baked into every shared progress card.
const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? 'https://rushpoint-creator.web.app');

export default function PlayScreen({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const { t } = useT();
  const [state, setState] = useState<MyTeamState | null>(null);
  const [err, setErr] = useState('');
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const timer = useRef<number>();
  const [sharing, setSharing] = useState(false);
  // Whether the team is currently launched/active — read by the geolocation
  // watcher (which mounts once) to decide if it should ping the live map.
  const activeRef = useRef(false);
  // Last time we pinged updateLocation, for ~20s client-side throttling.
  const lastPing = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const s = await getMyTeamState({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId });
      setState(s); setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.play.syncFailed);
    }
  }, [session, t]);

  useEffect(() => {
    let alive = true;
    let unsubDoc: (() => void) | undefined;

    void refresh(); // immediate first paint

    // Live trigger: our own team doc changes when the host starts the race,
    // routing assigns a task, our score moves, or we finish. Reacting to the
    // snapshot makes those feel instant instead of waiting for the next poll.
    // The snapshot is only a trigger — we still fetch the server-sanitized
    // state via getMyTeamState so answer keys never reach the client.
    void ensureAuth().then(() => {
      if (!alive) return;
      const teamId = uid();
      if (!teamId) return;
      const ref = doc(db, FIRESTORE_PATHS.team(session.ownerUid, session.gameId, session.runId, teamId));
      unsubDoc = onSnapshot(ref, () => { void refresh(); }, () => undefined);
    });

    // Slow fallback poll keeps the leaderboard fresh (it arrives via the
    // callable, not our team doc) and recovers if the listener can't attach.
    timer.current = window.setInterval(() => { void refresh(); }, 12_000);

    return () => {
      alive = false;
      unsubDoc?.();
      window.clearInterval(timer.current);
    };
  }, [refresh, session]);

  // Track the participant's live position for the navigation map, and report it
  // to the host's live team map (throttled to once per ~20s, only while active).
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        setMe({ lat, lng });
        const now = Date.now();
        if (activeRef.current && now - lastPing.current >= 20_000) {
          lastPing.current = now;
          updateLocation({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId, lat, lng })
            .catch(() => undefined);
        }
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [session]);

  // Keep the screen awake while actively racing (map open, navigating).
  useWakeLock(!!state && state.team.launched && state.team.status !== 'finished');

  async function leave() {
    if (await dialog.confirm(t.play.leaveConfirm)) { clearSession(); onLeave(); }
  }

  async function sos() {
    if (!(await dialog.confirm(t.play.sosConfirm, { confirmLabel: t.play.sosSend, danger: true }))) return;
    navigator.geolocation?.getCurrentPosition(
      (p) => triggerSOS({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId, lat: p.coords.latitude, lng: p.coords.longitude }),
      () => triggerSOS({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId }),
    );
    await dialog.alert(t.play.sosSent);
  }

  // Mid-race brag card — same branded story image as the finish screen, but with
  // a "we're racing / we're #N" headline. Every share carries the build-your-own
  // CTA, so an in-progress flex doubles as marketing for the creator app.
  async function shareProgress() {
    if (!state || sharing) return;
    setSharing(true);
    try {
      const { team, game } = state;
      const name = game.branding?.name ?? game.title;
      const done = team.stages.filter((s) => s.status === 'completed').length;
      const board = state.run.leaderboard;
      const rank = board?.published ? board.rankings.find((r) => r.teamId === team.id)?.rank : undefined;
      const headline = rank === 1 ? t.play.headlineFirst : rank && rank <= 3 ? t.play.headlineClimbing({ rank }) : t.play.headlineTrail;
      const text = t.play.shareText({
        team: team.displayName,
        game: name,
        rankPart: rank ? t.play.shareRankPart({ rank }) : '',
        score: team.score,
        url: CREATOR_URL.replace(/^https?:\/\//, ''),
      });
      await shareStoryCard({
        gameName: name,
        teamName: team.displayName,
        score: team.score,
        rank,
        stagesDone: `${done}/${game.stageCount}`,
        ctaUrl: CREATOR_URL,
        headline,
        scoreLabel: t.play.pointsSoFar,
      }, text);
    } finally { setSharing(false); }
  }

  if (!state) {
    return (
      <Screen>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          {err && <p className="text-danger text-sm">{err}</p>}
        </div>
      </Screen>
    );
  }

  const { team, game } = state;
  // Ping the live map only while the team is launched and still racing.
  activeRef.current = team.launched && team.status !== 'finished';
  const accent = game.branding?.primaryColor ?? '#F97316';
  const completedStages = team.stages.filter((s) => s.status === 'completed').length;

  if (team.status === 'finished') {
    return <FinalScreen state={state} onLeave={leave} />;
  }

  if (!team.launched) {
    return (
      <Screen>
        <Header game={game} score={team.score} accent={accent} onLeave={leave} />
        <LiveOps ctx={session} leaderboard={state.run.leaderboard} myTeamId={team.id} />
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <div className="text-5xl">⏳</div>
          <h2 dir="auto" className="text-xl font-bold">{t.play.youreIn({ name: team.displayName })}</h2>
          <p className="text-zinc-500">{t.play.waitingStart}</p>
        </div>
        <Button variant="danger" onClick={sos}>SOS</Button>
      </Screen>
    );
  }

  const activeStage = team.stages.find((s) => s.status === 'active');

  // Streak/momentum: consecutive completions across the run, in play order. A
  // skip or a long idle gap resets it (computeStreak). Chip hidden below 2.
  const { streak, milestone } = computeStreak(
    team.stages
      .flatMap((s) => s.tasks)
      .filter((rec) => rec.status === 'completed' || rec.status === 'skipped')
      .map((rec) => ({ status: rec.status, completedAt: rec.completedAt })),
    { now: new Date().toISOString() },
  );

  // Build map targets from the active stage's not-yet-completed tasks, joining
  // each run-record to its sanitized coordinates. The assigned task is "active".
  const targets: NavTarget[] = activeStage
    ? activeStage.tasks
        .filter((t) => t.status !== 'completed' && t.status !== 'skipped')
        .map((rec) => {
          const content = state.activeStageTasks.find((c) => c.id === rec.taskId);
          if (content?.locationless) return null; // general task — not on the map
          if (content?.locationHidden) return null; // hidden spot — found by clue, no pin
          const coords = content?.smart?.stationCoords ?? content?.coordinates;
          return coords && (coords.lat !== 0 || coords.lng !== 0)
            ? { id: rec.taskId, lat: coords.lat, lng: coords.lng, title: content?.title ?? 'Task', active: rec.status === 'assigned' }
            : null;
        })
        .filter((t): t is NavTarget => t !== null)
    : [];

  return (
    <Screen>
      <Header game={game} score={team.score} accent={accent} onLeave={leave} />
      <div className="mt-4 mb-2"><Progress done={completedStages} total={game.stageCount} /></div>
      <InRunAlerts hotZone={state.run.hotZone} outOfBounds={team.outOfBounds} />
      {streak >= 2 && (
        <div
          key={milestone ?? streak}
          className={`self-start mb-2 inline-flex items-center rounded-full bg-rp-fire/15 border border-rp-fire/30 px-3 py-1 text-sm font-bold text-rp-fire ${milestone ? 'animate-score-pop motion-reduce:animate-none' : ''}`}
        >
          {t.play.streak({ n: streak })}
        </div>
      )}
      <button onClick={shareProgress} disabled={sharing}
        className="self-end text-xs text-accent/90 hover:text-accent disabled:opacity-50 mb-2">
        {sharing ? t.play.creating : t.play.shareProgress}
      </button>

      <LiveOps ctx={session} leaderboard={state.run.leaderboard} myTeamId={team.id} />

      {activeStage && (
        <Suspense fallback={<div className="h-52 mb-4 rounded-xl bg-app-card border border-glass-border animate-pulse" />}>
          <NavMap targets={targets} me={me} accent={accent} className="h-52 mb-4" />
        </Suspense>
      )}

      <div className="flex-1">
        {activeStage ? (
          <TaskRunner session={session} state={state} stage={activeStage} onChanged={refresh} />
        ) : (
          <p className="text-center text-zinc-500 mt-10">{t.play.noActiveStage}</p>
        )}
      </div>

      <Button variant="danger" className="mt-4" onClick={sos}>SOS</Button>
    </Screen>
  );
}

function Header({ game, score, accent, onLeave }: {
  game: MyTeamState['game']; score: number; accent: string; onLeave: () => void;
}) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-between">
      <div>
        <div dir="auto" className="font-brand font-extrabold text-lg" style={{ color: accent }}>
          {game.branding?.name ?? game.title}
        </div>
        <div className="text-xs text-zinc-500">{t.play.score}: <span className="text-accent font-mono">{score}</span></div>
      </div>
      <button onClick={onLeave} className="text-xs text-zinc-500">{t.play.leave}</button>
    </div>
  );
}

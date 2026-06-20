import { useCallback, useEffect, useRef, useState } from 'react';
import { getMyTeamState, triggerSOS, updateLocation, type MyTeamState } from '../services/calls';
import { clearSession, type Session } from '../store';
import { Button, Progress, Screen } from '../components/ui';
import { dialog } from '../components/dialog';
import TaskRunner from '../components/TaskRunner';
import NavMap, { type NavTarget } from '../components/NavMap';
import FinalScreen from './FinalScreen';

export default function PlayScreen({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const [state, setState] = useState<MyTeamState | null>(null);
  const [err, setErr] = useState('');
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const timer = useRef<number>();
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
      setErr(e instanceof Error ? e.message : 'Sync failed');
    }
  }, [session]);

  useEffect(() => {
    refresh();
    timer.current = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer.current);
  }, [refresh]);

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

  async function leave() {
    if (await dialog.confirm('Leave this race? You can rejoin with the same code.')) { clearSession(); onLeave(); }
  }

  async function sos() {
    if (!(await dialog.confirm('Send an SOS alert to the organizers?', { confirmLabel: 'Send SOS', danger: true }))) return;
    navigator.geolocation?.getCurrentPosition(
      (p) => triggerSOS({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId, lat: p.coords.latitude, lng: p.coords.longitude }),
      () => triggerSOS({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId }),
    );
    await dialog.alert('SOS sent. Stay where you are — help is on the way.');
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
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <div className="text-5xl">⏳</div>
          <h2 className="text-xl font-bold">You&apos;re in, {team.displayName}!</h2>
          <p className="text-zinc-500">Waiting for the host to start the race…</p>
        </div>
        <Button variant="danger" onClick={sos}>SOS</Button>
      </Screen>
    );
  }

  const activeStage = team.stages.find((s) => s.status === 'active');

  // Build map targets from the active stage's not-yet-completed tasks, joining
  // each run-record to its sanitized coordinates. The assigned task is "active".
  const targets: NavTarget[] = activeStage
    ? activeStage.tasks
        .filter((t) => t.status !== 'completed' && t.status !== 'skipped')
        .map((rec) => {
          const content = state.activeStageTasks.find((c) => c.id === rec.taskId);
          const coords = content?.smart?.stationCoords ?? content?.coordinates;
          return coords
            ? { id: rec.taskId, lat: coords.lat, lng: coords.lng, title: content?.title ?? 'Task', active: rec.status === 'assigned' }
            : null;
        })
        .filter((t): t is NavTarget => t !== null)
    : [];

  return (
    <Screen>
      <Header game={game} score={team.score} accent={accent} onLeave={leave} />
      <div className="my-4"><Progress done={completedStages} total={game.stageCount} /></div>

      {activeStage && <NavMap targets={targets} me={me} accent={accent} className="h-52 mb-4" />}

      <div className="flex-1">
        {activeStage ? (
          <TaskRunner session={session} state={state} stage={activeStage} onChanged={refresh} />
        ) : (
          <p className="text-center text-zinc-500 mt-10">No active stage.</p>
        )}
      </div>

      <Button variant="danger" className="mt-4" onClick={sos}>SOS</Button>
    </Screen>
  );
}

function Header({ game, score, accent, onLeave }: {
  game: MyTeamState['game']; score: number; accent: string; onLeave: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="font-brand font-extrabold text-lg" style={{ color: accent }}>
          {game.branding?.name ?? game.title}
        </div>
        <div className="text-xs text-zinc-500">Score: <span className="text-accent font-mono">{score}</span></div>
      </div>
      <button onClick={onLeave} className="text-xs text-zinc-500">Leave</button>
    </div>
  );
}

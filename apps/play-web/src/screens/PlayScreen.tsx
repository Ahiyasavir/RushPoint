import { useCallback, useEffect, useRef, useState } from 'react';
import { getMyTeamState, triggerSOS, type MyTeamState } from '../services/calls';
import { clearSession, type Session } from '../store';
import { Button, Progress, Screen } from '../components/ui';
import { dialog } from '../components/dialog';
import TaskRunner from '../components/TaskRunner';
import FinalScreen from './FinalScreen';

export default function PlayScreen({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const [state, setState] = useState<MyTeamState | null>(null);
  const [err, setErr] = useState('');
  const timer = useRef<number>();

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
  const accent = game.branding?.primaryColor ?? '#22D3EE';
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

  return (
    <Screen>
      <Header game={game} score={team.score} accent={accent} onLeave={leave} />
      <div className="my-4"><Progress done={completedStages} total={game.stageCount} /></div>

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

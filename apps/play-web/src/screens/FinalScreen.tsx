import type { MyTeamState } from '../services/calls';
import { Button, Card, Screen } from '../components/ui';

export default function FinalScreen({ state, onLeave }: { state: MyTeamState; onLeave: () => void }) {
  const { team, run, game } = state;
  const accent = game.branding?.primaryColor ?? '#F97316';
  const myEntry = run.leaderboard?.rankings.find((r) => r.teamId === team.id);
  const myRank = myEntry?.rank;
  // Once finalized, the official score includes completion + time bonuses; before
  // that, show the live earned score.
  const finalScore = myEntry?.score ?? team.score;

  return (
    <Screen>
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
        <div className="text-7xl animate-bounce">🏆</div>
        <h1 className="font-brand text-3xl font-extrabold" style={{ color: accent }}>Finished!</h1>
        <p className="text-zinc-400">{team.displayName}, you completed every stage.</p>

        <Card className="p-6 w-full">
          <div className="text-xs text-zinc-500 uppercase tracking-widest">Final score</div>
          <div className="text-5xl font-bold text-accent my-1">{finalScore}</div>
          {myRank && <div className="text-sm text-zinc-400">Rank #{myRank}</div>}
        </Card>

        {run.leaderboard && run.leaderboard.rankings.length > 0 && (
          <Card className="p-4 w-full">
            <div className="text-sm font-medium text-zinc-300 mb-2 text-left">Leaderboard</div>
            <div className="space-y-1">
              {run.leaderboard.rankings.slice(0, 10).map((r) => (
                <div key={r.teamId} className={`flex items-center gap-3 text-sm ${r.teamId === team.id ? 'text-accent' : 'text-zinc-300'}`}>
                  <span className="w-5 text-zinc-500">{r.rank}</span>
                  <span className="flex-1 text-left">{r.teamName}</span>
                  <span className="font-mono">{r.score}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {!run.leaderboard && (
          <p className="text-zinc-500 text-sm">Waiting for the host to finalize the leaderboard…</p>
        )}
      </div>
      <Button variant="ghost" onClick={onLeave}>Leave</Button>
    </Screen>
  );
}

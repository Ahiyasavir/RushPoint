import { useState } from 'react';
import type { MyTeamState } from '../services/calls';
import { Button, Card, Screen } from '../components/ui';

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

export default function FinalScreen({ state, onLeave }: { state: MyTeamState; onLeave: () => void }) {
  const { team, run, game } = state;
  const accent = game.branding?.primaryColor ?? '#F97316';
  const myEntry = run.leaderboard?.rankings.find((r) => r.teamId === team.id);
  const myRank = myEntry?.rank;
  // Once finalized, the official score includes completion + time bonuses; before
  // that, show the live earned score.
  const finalScore = myEntry?.score ?? team.score;

  // ── Race recap stats ──
  const totalSec = team.startedAt && team.finishedAt
    ? (new Date(team.finishedAt).getTime() - new Date(team.startedAt).getTime()) / 1000
    : null;
  const completedStages = team.stages.filter((s) => s.status === 'completed');
  let fastest: { order: number; dur: number } | null = null;
  for (const s of completedStages) {
    if (s.startedAt && s.completedAt) {
      const dur = (new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000;
      if (!fastest || dur < fastest.dur) fastest = { order: s.order, dur };
    }
  }
  const hintsUsed = team.taskHintsUsed?.length ?? 0;
  const [shared, setShared] = useState(false);

  async function share() {
    const name = game.branding?.name ?? game.title;
    const text = `🏆 ${team.displayName} finished "${name}"`
      + `${myRank ? ` — rank #${myRank}` : ''}`
      + `${totalSec != null ? ` in ${fmtDuration(totalSec)}` : ''}! Score ${finalScore}.`;
    const navAny = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
    if (navAny.share) { try { await navAny.share({ title: 'RushPoint', text }); return; } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(text); setShared(true); setTimeout(() => setShared(false), 2500); } catch { /* no clipboard */ }
  }

  return (
    <Screen>
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
        <div className="text-7xl animate-bounce">🏆</div>
        <h1 className="font-brand text-3xl font-extrabold" style={{ color: accent }}>Finished!</h1>
        <p dir="auto" className="text-zinc-400">{team.displayName}, you completed every stage.</p>

        <Card className="p-6 w-full">
          <div className="text-xs text-zinc-500 uppercase tracking-widest">Final score</div>
          <div className="text-5xl font-bold text-accent my-1">{finalScore}</div>
          {myRank && <div className="text-sm text-zinc-400">Rank #{myRank}</div>}
        </Card>

        {/* Race recap — a shareable wrap-up of the run */}
        <Card className="p-4 w-full">
          <div className="text-sm font-medium text-zinc-300 mb-3 text-start">Your race, wrapped</div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total time" value={totalSec != null ? fmtDuration(totalSec) : '—'} />
            <Stat label="Stages done" value={`${completedStages.length}/${game.stageCount}`} />
            <Stat label="Fastest stage" value={fastest ? `#${fastest.order + 1} · ${fmtDuration(fastest.dur)}` : '—'} />
            <Stat label="Hints used" value={String(hintsUsed)} />
          </div>
          <Button variant="ghost" className="mt-4" onClick={share}>{shared ? 'Copied ✓' : 'Share my result'}</Button>
        </Card>

        {run.leaderboard && run.leaderboard.rankings.length > 0 && (
          <Card className="p-4 w-full">
            <div className="text-sm font-medium text-zinc-300 mb-2 text-start">Leaderboard</div>
            <div className="space-y-1">
              {run.leaderboard.rankings.slice(0, 10).map((r) => (
                <div key={r.teamId} className={`flex items-center gap-3 text-sm ${r.teamId === team.id ? 'text-accent' : 'text-zinc-300'}`}>
                  <span className="w-5 text-zinc-500">{r.rank}</span>
                  <span dir="auto" className="flex-1 text-start">{r.teamName}</span>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-app-raised rounded-lg px-3 py-2 text-start">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="text-base font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

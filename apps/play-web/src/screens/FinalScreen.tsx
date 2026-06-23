import { useState } from 'react';
import type { MyTeamState } from '../services/calls';
import { Button, Card, Screen } from '../components/ui';
import { shareStoryCard } from '../lib/storyCard';

const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? 'https://rushpoint-creator.web.app');

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

const MEDAL = ['🥇', '🥈', '🥉'];
const MEDAL_BG = [
  'bg-gradient-to-r from-yellow-400/20 to-amber-300/10 border-yellow-400/30',
  'bg-gradient-to-r from-gray-300/20 to-gray-200/10 border-gray-300/30',
  'bg-gradient-to-r from-orange-400/20 to-orange-300/10 border-orange-400/30',
];

export default function FinalScreen({ state, onLeave }: { state: MyTeamState; onLeave: () => void }) {
  const { team, run, game } = state;
  const accent = game.branding?.primaryColor ?? '#FF5722';
  const myEntry = run.leaderboard?.rankings.find((r) => r.teamId === team.id);
  const myRank = myEntry?.rank;
  const finalScore = myEntry?.score ?? team.score;

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
  const [busy, setBusy] = useState(false);

  async function share() {
    setBusy(true);
    try {
      const name = game.branding?.name ?? game.title;
      const text = `🏆 ${team.displayName} סיימה את "${name}"`
        + `${myRank ? ` · מקום #${myRank}` : ''}`
        + `${totalSec != null ? ` תוך ${fmtDuration(totalSec)}` : ''}! `
        + `רוצים לבנות מירוץ הרפתקה משלכם? ${CREATOR_URL.replace(/^https?:\/\//, '')}`;
      const result = await shareStoryCard({
        gameName: name,
        teamName: team.displayName,
        score: finalScore,
        rank: myRank,
        totalTime: totalSec != null ? fmtDuration(totalSec) : undefined,
        stagesDone: `${completedStages.length}/${game.stageCount}`,
        ctaUrl: CREATOR_URL,
      }, text);
      if (result === 'downloaded' || result === 'copied') { setShared(true); setTimeout(() => setShared(false), 2500); }
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-5">

        {/* Trophy + title */}
        <div className="animate-score-pop">
          <div
            className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mx-auto mb-3"
            style={{ background: `radial-gradient(circle at 40% 35%, ${accent}30, ${accent}08)`, boxShadow: `0 0 40px ${accent}40` }}
          >
            🏆
          </div>
          <h1 className="font-brand text-4xl font-extrabold" style={{ color: accent }}>Finished!</h1>
          <p dir="auto" className="text-zinc-400 mt-1">{team.displayName}, you completed every stage.</p>
        </div>

        {/* Score card */}
        <Card className="p-6 w-full" style={{ borderColor: `${accent}30` }}>
          <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Final Score</div>
          <div
            className="text-6xl font-brand font-extrabold my-2 animate-score-pop bg-gradient-to-r bg-clip-text text-transparent"
            style={{ backgroundImage: `linear-gradient(135deg, ${accent}, ${accent}99)` }}
          >
            {finalScore}
          </div>
          {myRank && (
            <div className="flex items-center justify-center gap-2">
              <span className="text-lg">{MEDAL[myRank - 1] ?? '🏅'}</span>
              <span className="text-sm font-medium text-zinc-300">Rank #{myRank}</span>
            </div>
          )}
        </Card>

        {/* Race recap */}
        <Card className="p-4 w-full">
          <div className="text-sm font-semibold text-zinc-300 mb-3 text-start">🗂️ Your race, wrapped</div>
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Total time" value={totalSec != null ? fmtDuration(totalSec) : '—'} accent={accent} />
            <Stat label="Stages done" value={`${completedStages.length}/${game.stageCount}`} accent={accent} />
            <Stat label="Fastest stage" value={fastest ? `#${fastest.order + 1} · ${fmtDuration(fastest.dur)}` : '—'} accent={accent} />
            <Stat label="Hints used" value={String(hintsUsed)} accent={accent} />
          </div>
          <Button className="mt-4" disabled={busy} onClick={share}>
            {busy ? 'Creating…' : shared ? '✓ Saved!' : '📸 Share my result'}
          </Button>
        </Card>

        {/* Leaderboard */}
        {run.leaderboard && run.leaderboard.rankings.length > 0 && (
          <Card className="p-4 w-full">
            <div className="text-sm font-semibold text-zinc-300 mb-3 text-start">🏅 Leaderboard</div>
            <div className="space-y-1.5">
              {run.leaderboard.rankings.slice(0, 10).map((r, i) => {
                const isMe = r.teamId === team.id;
                const medalBg = i < 3 ? MEDAL_BG[i] : '';
                return (
                  <div
                    key={r.teamId}
                    className={`
                      flex items-center gap-3 text-sm px-3 py-2 rounded-xl border
                      animate-fade-up
                      ${isMe ? 'border-rp-fire/30 bg-rp-fire/8 text-zinc-100' : `${medalBg || 'border-transparent'} text-zinc-400`}
                    `}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <span className="w-6 text-center">{MEDAL[i] ?? <span className="text-zinc-500 text-xs">{r.rank}</span>}</span>
                    <span dir="auto" className="flex-1 text-start font-medium">{r.teamName}</span>
                    <span className="font-mono text-xs font-semibold" style={{ color: isMe ? accent : undefined }}>{r.score}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {!run.leaderboard && (
          <p className="text-zinc-500 text-sm">Waiting for the host to finalize the leaderboard…</p>
        )}
      </div>

      {/* Viral footer — hidden for Pro runs (white-label). The ?ref tag credits
          the host with a free run if a participant signs up as a creator. */}
      {run.billingType !== 'pro' && (
        <a href={`${CREATOR_URL}/?ref=${team.ownerUid}`} target="_blank" rel="noreferrer"
          className="block mt-2 rounded-2xl border border-glass-border bg-white/70 px-4 py-3 text-center hover:bg-white transition-colors">
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 mb-0.5">
            <span>⚡</span> Powered by RushPoint
          </div>
          <div className="text-sm font-semibold" style={{ color: accent }}>
            Build your own race, free →
          </div>
        </a>
      )}
      <Button variant="ghost" onClick={onLeave} className="mt-2">Leave</Button>
    </Screen>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-app-raised rounded-xl px-3 py-2.5 text-start">
      <div className="text-[11px] text-zinc-500 mb-0.5">{label}</div>
      <div className="text-base font-semibold font-brand" style={{ color: accent }}>{value}</div>
    </div>
  );
}

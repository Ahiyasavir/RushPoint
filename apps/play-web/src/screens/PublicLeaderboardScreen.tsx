import { useCallback, useEffect, useState } from 'react';
import { getPublicLeaderboard, type PublicLeaderboard } from '../services/calls';
import { Button, Card, Screen } from '../components/ui';

const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? 'https://rushpoint-creator.web.app');

const MEDALS = ['🥇', '🥈', '🥉'];

// Public, shareable standings for a run (`?board=<code>`). Spectators, dropped-out
// teammates, and finished players can all watch the board without joining. Polls
// while live; stops once finished. Shows standings only once the host publishes.
export default function PublicLeaderboardScreen({ code, onJoin }: { code: string; onJoin: () => void }) {
  const [data, setData] = useState<PublicLeaderboard | null | undefined>(undefined);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setData(await getPublicLeaderboard({ code })); setErr(''); }
    catch (e) { setErr(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Could not load'); setData(null); }
  }, [code]);

  useEffect(() => { void load(); }, [load]);

  // Live polling until the race finishes (and the board is frozen).
  useEffect(() => {
    if (data?.runStatus === 'finished' || data?.frozen) return;
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
  }, [data?.runStatus, data?.frozen, load]);

  const accent = data?.branding?.primaryColor ?? '#F97316';

  async function share() {
    const url = window.location.href;
    const nav = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: data?.title ?? 'RushPoint', url }); return; } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(url); } catch { /* no clipboard */ }
  }

  if (data === undefined) {
    return (
      <Screen>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
        </div>
      </Screen>
    );
  }

  if (!data || err) {
    return (
      <Screen>
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <div className="text-5xl">🏁</div>
          <h1 className="font-brand text-2xl font-extrabold text-accent">Leaderboard unavailable</h1>
          <p className="text-zinc-500 text-sm">{err || 'This race could not be found.'}</p>
          <Button className="mt-2" onClick={onJoin}>Enter a code</Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="text-center mb-5">
        <div className="text-xs uppercase tracking-widest text-zinc-500">Live standings</div>
        <h1 dir="auto" className="font-brand text-2xl font-extrabold mt-1" style={{ color: accent }}>{data.title}</h1>
        <div className="text-xs text-zinc-500 mt-1">
          {data.runStatus === 'finished' ? '🏁 Final results' : data.frozen ? '❄️ Standings frozen' : '🔴 Live'}
        </div>
      </div>

      <div className="flex-1">
        {!data.published ? (
          <Card className="p-8 text-center">
            <div className="text-4xl mb-2">⏳</div>
            <p className="text-zinc-300">Standings haven&apos;t been published yet.</p>
            <p className="text-zinc-500 text-sm mt-1">Hang tight — the host reveals them during the race.</p>
          </Card>
        ) : data.rankings.length === 0 ? (
          <Card className="p-8 text-center text-zinc-500">No teams yet.</Card>
        ) : (
          <div className="space-y-2">
            {data.rankings.map((r) => (
              <Card key={r.teamId} className="px-4 py-3 flex items-center gap-3">
                <span className="w-8 text-center text-lg font-bold">{MEDALS[r.rank - 1] ?? <span className="text-zinc-500 text-sm">#{r.rank}</span>}</span>
                <div className="flex-1 min-w-0">
                  <div dir="auto" className="truncate font-medium text-zinc-100">{r.teamName}</div>
                  <div className="text-[11px] text-zinc-500">{r.completedStages} stages</div>
                </div>
                <span className="font-mono font-bold" style={{ color: accent }}>{r.score}</span>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Button variant="ghost" className="mt-4" onClick={share}>🔗 Share this leaderboard</Button>
      <a href={CREATOR_URL} target="_blank" rel="noreferrer"
        className="block text-center text-sm text-accent font-medium py-3 hover:underline">
        ✨ Build your own race adventure →
      </a>
    </Screen>
  );
}

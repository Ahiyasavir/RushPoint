import { useCallback, useEffect, useState } from 'react';
import { getPublicLeaderboard, type PublicLeaderboard } from '../services/calls';
import { Button, Card, Screen } from '../components/ui';
import { useT } from '../i18nContext';

const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? 'https://rushpoint-creator.web.app');

const MEDALS = ['🥇', '🥈', '🥉'];
const MEDAL_BG = [
  'bg-gradient-to-r from-yellow-400/15 to-amber-300/5 border-yellow-400/25',
  'bg-gradient-to-r from-gray-300/15 to-gray-200/5 border-gray-300/25',
  'bg-gradient-to-r from-orange-400/15 to-orange-300/5 border-orange-400/25',
];

export default function PublicLeaderboardScreen({ code, onJoin }: { code: string; onJoin: () => void }) {
  const { t } = useT();
  const [data, setData] = useState<PublicLeaderboard | null | undefined>(undefined);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setData(await getPublicLeaderboard({ code })); setErr(''); }
    catch (e) { setErr(e instanceof Error ? e.message.replace('Firebase: ', '') : t.board.couldNotLoad); setData(null); }
  }, [code, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (data?.runStatus === 'finished' || data?.frozen) return;
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
  }, [data?.runStatus, data?.frozen, load]);

  const accent = data?.branding?.primaryColor ?? '#FF5722';

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
          <div className="w-8 h-8 rounded-full border-2 border-rp-fire/30 border-t-rp-fire animate-spin" />
        </div>
      </Screen>
    );
  }

  if (!data || err) {
    return (
      <Screen>
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 animate-race-in">
          <div className="text-5xl">🏁</div>
          <h1 className="font-brand text-2xl font-extrabold bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent">
            {t.board.unavailable}
          </h1>
          <p className="text-zinc-500 text-sm">{err || t.board.notFound}</p>
          <Button className="mt-2" onClick={onJoin}>{t.board.enterCode}</Button>
        </div>
      </Screen>
    );
  }

  const isLive = data.runStatus !== 'finished' && !data.frozen;

  return (
    <Screen>
      {/* Header */}
      <div className="text-center mb-5 animate-race-in">
        <div className="flex items-center justify-center gap-1.5 mb-2">
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-rp-go animate-pulse' : 'bg-zinc-500'}`} />
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            {data.runStatus === 'finished' ? t.board.finalResults : data.frozen ? t.board.frozen : t.board.live}
          </span>
        </div>
        <h1 dir="auto" className="font-brand text-2xl font-extrabold" style={{ color: accent }}>{data.title}</h1>
      </div>

      <div className="flex-1">
        {!data.published ? (
          <Card className="p-8 text-center">
            <div className="text-4xl mb-3">⏳</div>
            <p className="font-medium text-zinc-300">{t.board.notPublished}</p>
            <p className="text-zinc-500 text-sm mt-1">{t.board.revealsDuring}</p>
          </Card>
        ) : data.rankings.length === 0 ? (
          <Card className="p-8 text-center text-zinc-500">{t.board.noTeams}</Card>
        ) : (
          <div className="space-y-2">
            {data.rankings.map((r, i) => (
              <div
                key={r.teamId}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl border animate-fade-up
                  ${i < 3 ? MEDAL_BG[i] : 'bg-app-card border-glass-border'}
                  shadow-task-card
                `}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <span className="w-8 text-center text-xl">
                  {MEDALS[i] ?? <span className="text-zinc-500 text-sm font-mono">#{r.rank}</span>}
                </span>
                <div className="flex-1 min-w-0">
                  <div dir="auto" className="truncate font-semibold text-zinc-100">{r.teamName}</div>
                  <div className="text-[11px] text-zinc-500">{t.board.stagesCount({ n: r.completedStages })}</div>
                </div>
                <span className="font-brand font-bold text-base" style={{ color: accent }}>{r.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Button variant="ghost" className="mt-4" onClick={share}>{t.board.share}</Button>
      <a href={CREATOR_URL} target="_blank" rel="noreferrer"
        className="block text-center text-sm font-semibold py-3 hover:underline bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent"
      >
        {t.board.buildOwn}
      </a>
    </Screen>
  );
}

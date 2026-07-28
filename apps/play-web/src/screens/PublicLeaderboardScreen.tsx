import { useCallback, useEffect, useState } from 'react';
import { getPublicLeaderboard, type PublicLeaderboard } from '../services/calls';
import { Button, Card, Screen } from '../components/ui';
import { LoadingView } from '../components/LoadingView';
import { useT } from '../i18nContext';
import { isFinalTime, boardTimeSeconds, formatDuration } from '../lib/boardTime';
import { CANONICAL_CREATOR_URL } from '@rushpoint/shared';

const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? CANONICAL_CREATOR_URL);

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
  const [refreshing, setRefreshing] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try { setData(await getPublicLeaderboard({ code })); setErr(''); setNowTick(Date.now()); }
    catch (e) {
      // Never render a raw Firebase error code (e.g. auth/admin-restricted-operation)
      // to players (WO-5) — show one friendly localized line, log the code for us.
      console.warn('public leaderboard load failed:', e instanceof Error ? e.message : e);
      setErr(t.board.couldNotLoad);
      setData(null);
    }
    finally { setRefreshing(false); }
  }, [code, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (data?.runStatus === 'finished' || data?.frozen) return;
    const id = window.setInterval(load, 8000);
    return () => window.clearInterval(id);
  }, [data?.runStatus, data?.frozen, load]);

  // Tick once a second so the "updated Ns ago" stamp stays accurate between polls.
  useEffect(() => {
    if (data?.runStatus === 'finished' || data?.frozen) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [data?.runStatus, data?.frozen]);

  const accent = data?.branding?.primaryColor ?? '#FF5722';

  async function share() {
    const url = window.location.href;
    const nav = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: data?.title ?? 'RushPoint', url }); return; } catch { /* cancelled */ } }
    // Confirm the copy (change: play-no-silent-failures): a clipboard write with
    // an empty catch gave the visitor no way to know whether anything happened.
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* no clipboard */ }
  }

  if (data === undefined) {
    return (
      <Screen>
        <div className="flex-1 flex items-center justify-center">
          <LoadingView messages={[t.board.loadingA, t.board.loadingB]} />
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
          {/* The only CTA used to ask for a code the visitor does not have
              (change: play-no-silent-failures). `load` is a stable useCallback. */}
          <Button className="mt-2" loading={refreshing} onClick={() => void load()}>{t.board.retry}</Button>
          <Button variant="ghost" onClick={onJoin}>{t.board.enterCode}</Button>
        </div>
      </Screen>
    );
  }

  const isLive = data.runStatus !== 'finished' && !data.frozen;
  // The `time_only` preset ranks purely by time; its `score` is a meaningless
  // placeholder (e.g. 500/0). Surface the time as the primary value and hide the
  // score column, mirroring FinalScreen.
  const isTimeOnly = data.scoringPreset === 'time_only';

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
        {isLive && (
          <div className="flex items-center justify-center gap-2 mt-2 text-[11px] text-zinc-500">
            <span>
              {/* Age is measured from the SERVER snapshot time (data.updatedAt),
                  not the client fetch, so a throttled/stale board reads honestly. */}
              {data.updatedAt == null
                ? t.board.justNow
                : t.board.updatedAgo({ s: Math.max(0, Math.round((nowTick - Date.parse(data.updatedAt)) / 1000)) })}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing}
              aria-label={t.board.refresh}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:text-ink-fire disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
            >
              <span aria-hidden="true" className={refreshing ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
              {t.board.refresh}
            </button>
          </div>
        )}
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
                <div className="flex flex-col items-end">
                  {(() => {
                    const sec = boardTimeSeconds(r);
                    const final = isFinalTime(r);
                    // A finished team shows its real completion time (solid mono).
                    // A still-playing team's time is an ever-growing ELAPSED value —
                    // render it distinctly (italic, dimmer, ⏱ prefix) and labelled so
                    // it can't be mistaken for a finisher's final time.
                    if (isTimeOnly) {
                      // time_only: the score is a placeholder — show the time as the
                      // primary value instead.
                      return (
                        <span
                          title={final ? t.board.finalTime : t.board.elapsed}
                          aria-label={final ? t.board.finalTime : t.board.elapsed}
                          className={
                            final
                              ? 'font-brand font-bold text-base tabular-nums'
                              : 'font-brand font-bold text-base tabular-nums italic opacity-80'
                          }
                          style={{ color: accent }}
                        >
                          {final ? '' : '⏱ '}{sec != null ? formatDuration(sec) : '—'}
                        </span>
                      );
                    }
                    return (
                      <>
                        <span className="font-brand font-bold text-base" style={{ color: accent }}>{r.score}</span>
                        {sec != null && (
                          <span
                            title={final ? t.board.finalTime : t.board.elapsed}
                            aria-label={final ? t.board.finalTime : t.board.elapsed}
                            className={
                              final
                                ? 'text-[11px] text-zinc-500 font-mono tabular-nums'
                                : 'text-[11px] text-zinc-500 italic font-mono tabular-nums opacity-80'
                            }
                          >
                            {final ? '' : '⏱ '}{formatDuration(sec)}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Button variant="ghost" className="mt-4" onClick={share}>{copied ? t.board.linkCopied : t.board.share}</Button>
      <a href={CREATOR_URL} target="_blank" rel="noreferrer"
        className="block text-center text-sm font-semibold py-3 hover:underline bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent"
      >
        {t.board.buildOwn}
      </a>
    </Screen>
  );
}

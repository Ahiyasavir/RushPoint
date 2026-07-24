import { useCallback, useEffect, useRef, useState } from 'react';
import { detectLeaderChange } from '@rushpoint/shared';
import { getPublicLeaderboard, type PublicLeaderboard } from '../services/calls';
import { useT } from '../i18nContext';
import { Spinner } from '../components/Spinner';
import { isFinalTime, boardTimeSeconds, formatDuration } from '../lib/boardTime';

const MEDALS = ['🥇', '🥈', '🥉'];
const REFRESH_MS = 12_000; // ≤ 15s per spec

/**
 * Full-screen, auto-refreshing standings for projection (`?tv=<accessCode>`).
 * Reuses getPublicLeaderboard (published gate enforced server-side). When the
 * leading team changes between refreshes, the new leader's row flashes.
 */
export default function TvLeaderboard({ code }: { code: string }) {
  const { t } = useT();
  const [data, setData] = useState<PublicLeaderboard | null | undefined>(undefined);
  const prevTopId = useRef<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const [newLeaderId, setNewLeaderId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getPublicLeaderboard({ code });
      const topId = next.published ? (next.rankings[0]?.teamId ?? null) : null;
      if (detectLeaderChange(prevTopId.current, topId)) {
        setNewLeaderId(topId);
        if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(
          () => setNewLeaderId((cur) => (cur === topId ? null : cur)),
          6000,
        );
      }
      prevTopId.current = topId;
      setLoadError(false);
      setData(next);
    } catch {
      setLoadError(true);
      setData(null);
    }
  }, [code]);

  useEffect(() => { void load(); }, [load]);
  // Cancel any pending leader-flash timer on unmount (long-lived TV board).
  useEffect(() => () => {
    if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
  }, []);
  useEffect(() => {
    if (data?.runStatus === 'finished' || data?.frozen) return;
    const id = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [data?.runStatus, data?.frozen, load]);

  const accent = data?.branding?.primaryColor ?? '#FF5722';
  const published = !!data?.published;
  const rankings = published ? data!.rankings : [];
  // time_only ranks purely by time; its `score` is a placeholder — surface the
  // time as the primary value (mirrors FinalScreen / the public leaderboard).
  const isTimeOnly = data?.scoringPreset === 'time_only';

  if (data === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-bg">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!published || rankings.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center gap-4 bg-app-bg p-8">
        <div className="text-7xl">📺</div>
        <h1 className="font-brand text-4xl font-extrabold text-zinc-200">{data?.title ?? 'RushPoint'}</h1>
        <p className={`text-2xl ${loadError ? 'text-rp-fire font-semibold' : 'text-zinc-500'}`}>
          {loadError ? t.tv.loadError : t.tv.notAvailable}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg p-6 sm:p-10 flex flex-col">
      <div className="text-center mb-8">
        <div className="text-sm uppercase tracking-[0.3em] text-zinc-500 mb-1">{t.tv.liveStandings}</div>
        <h1 dir="auto" className="font-brand text-5xl sm:text-6xl font-extrabold" style={{ color: accent }}>
          {data!.title}
        </h1>
      </div>

      <div className="flex-1 max-w-5xl w-full mx-auto space-y-3">
        {rankings.slice(0, 12).map((r, i) => {
          const isLeaderFlash = r.teamId === newLeaderId;
          const medalBg = i === 0
            ? 'border-yellow-400/40 bg-gradient-to-r from-yellow-400/15 to-amber-300/5'
            : 'border-glass-border bg-app-card';
          return (
            <div key={r.teamId}
              className={`flex items-center gap-5 rounded-2xl border px-6 py-4 ${medalBg} ${isLeaderFlash ? 'animate-score-pop motion-reduce:animate-none ring-2 ring-rp-fire' : ''}`}>
              <span className="w-14 text-center text-3xl font-brand font-extrabold text-zinc-300">
                {MEDALS[i] ?? r.rank}
              </span>
              <div className="flex-1 min-w-0">
                <div dir="auto" className="text-3xl font-bold text-zinc-100 truncate">{r.teamName}</div>
                {isLeaderFlash && (
                  <div className="text-sm font-semibold text-ink-fire">{t.tv.nowLeading}</div>
                )}
              </div>
              <div className="text-end">
                {(() => {
                  // A finished team shows its real completion time; a still-playing
                  // team's time is an ever-growing ELAPSED value — mark it (⏱ prefix,
                  // dimmer italic, labelled) so it can't be misread as a finish time
                  // on the projection board (mirrors the public leaderboard).
                  const sec = boardTimeSeconds(r);
                  const final = isFinalTime(r);
                  if (isTimeOnly) {
                    // time_only: score is a placeholder — show the time as primary.
                    return (
                      <div
                        title={final ? t.board.finalTime : t.board.elapsed}
                        aria-label={final ? t.board.finalTime : t.board.elapsed}
                        className={
                          final
                            ? 'text-3xl font-brand font-extrabold'
                            : 'text-3xl font-brand font-extrabold italic opacity-80'
                        }
                        style={{ color: accent }}
                      >
                        {final ? '' : '⏱ '}{sec != null ? formatDuration(sec) : '—'}
                      </div>
                    );
                  }
                  return (
                    <>
                      <div className="text-3xl font-brand font-extrabold" style={{ color: accent }}>{r.score}</div>
                      {sec != null && (
                        <div
                          title={final ? t.board.finalTime : t.board.elapsed}
                          aria-label={final ? t.board.finalTime : t.board.elapsed}
                          className={final ? 'text-sm text-zinc-500 font-mono' : 'text-sm text-zinc-500 italic font-mono'}
                        >
                          {final ? '' : '⏱ '}{formatDuration(sec)}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

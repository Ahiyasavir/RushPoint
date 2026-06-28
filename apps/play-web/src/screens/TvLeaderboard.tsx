import { useCallback, useEffect, useRef, useState } from 'react';
import { detectLeaderChange } from '@rushpoint/shared';
import { getPublicLeaderboard, type PublicLeaderboard } from '../services/calls';
import { useT } from '../i18nContext';

const MEDALS = ['🥇', '🥈', '🥉'];
const REFRESH_MS = 12_000; // ≤ 15s per spec

function fmtTime(e: { durationSeconds?: number; totalMinutes?: number }): string {
  const sec = e.durationSeconds ?? (e.totalMinutes != null ? e.totalMinutes * 60 : null);
  if (sec == null) return '';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

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
      setData(next);
    } catch {
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

  if (data === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-bg">
        <div className="w-10 h-10 rounded-full border-2 border-rp-fire/30 border-t-rp-fire animate-spin" />
      </div>
    );
  }

  if (!published || rankings.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center gap-4 bg-app-bg p-8">
        <div className="text-7xl">📺</div>
        <h1 className="font-brand text-4xl font-extrabold text-zinc-200">{data?.title ?? 'RushPoint'}</h1>
        <p className="text-2xl text-zinc-500">{t.tv.notAvailable}</p>
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
                  <div className="text-sm font-semibold text-rp-fire">{t.tv.nowLeading}</div>
                )}
              </div>
              <div className="text-right">
                <div className="text-3xl font-brand font-extrabold" style={{ color: accent }}>{r.score}</div>
                <div className="text-sm text-zinc-500 font-mono">{fmtTime(r)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

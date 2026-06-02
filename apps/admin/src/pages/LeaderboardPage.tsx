import React, { useEffect, useState } from 'react';
import { onSnapshot, doc } from 'firebase/firestore';
import { SLOT_COUNT } from '@rushpoint/shared';
import { db, APP_ID, ensureAuth } from '../services/firebase';
import { callable } from '../services/api';
import { useI18n } from '../i18n';

const triggerLeaderboardFreeze = callable<{ freeze: boolean }>('triggerLeaderboardFreeze');
const finalizeLeaderboard      = callable<Record<string, never>, { count: number }>('finalizeLeaderboard');

interface RankingEntry {
  rank: number;
  teamId: string;
  teamName: string;
  score: number;
  rawScore?: number;
  completedSlots: number;
  finishedAt: string | null;
  durationMinutes: number | null;
}

interface LeaderboardDoc {
  rankings: RankingEntry[];
  frozen: boolean;
  frozenAt?: string;
  finalizedAt?: string;
  updatedAt: string;
}

const MEDAL = ['🥇', '🥈', '🥉'];

export default function LeaderboardPage() {
  const { t } = useI18n();
  const [lb, setLb]               = useState<LeaderboardDoc | null>(null);
  const [loading, setLoading]      = useState(true);
  const [freezing, setFreezing]    = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError]          = useState('');
  const [toast, setToast]          = useState('');
  // Reveal mode: how many entries are currently shown (from last place upward).
  const [revealIndex, setRevealIndex] = useState<number | null>(null);

  const lbPath = `artifacts/${APP_ID}/public/data/leaderboard/current`;

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void ensureAuth().then(() => {
      unsub = onSnapshot(
        doc(db, lbPath),
        (snap) => {
          setLoading(false);
          if (snap.exists()) setLb(snap.data() as LeaderboardDoc);
          else setLb(null);
        },
        () => setLoading(false),
      );
    });
    return () => unsub?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  async function handleFreeze(freeze: boolean) {
    setFreezing(true);
    setError('');
    try {
      await triggerLeaderboardFreeze({ freeze });
      showToast(freeze ? '🔒 Leaderboard frozen.' : '🔓 Leaderboard unfrozen.');
    } catch {
      setError('freeze-error');
    } finally {
      setFreezing(false);
    }
  }

  async function handleFinalize() {
    setFinalizing(true);
    setError('');
    try {
      const data = await finalizeLeaderboard({});
      showToast(`✅ Finalized — ${data.count} teams ranked.`);
      setRevealIndex(null);
    } catch {
      setError(t('leaderboard.finalizeError'));
    } finally {
      setFinalizing(false);
    }
  }

  const rankings     = lb?.rankings ?? [];
  const isFrozen     = lb?.frozen ?? false;
  const finalizedAt  = lb?.finalizedAt;
  const inReveal     = revealIndex !== null;

  // In reveal mode we show from last place (index = rankings.length - 1) upward.
  // revealIndex = 0 means show only last place, revealIndex = n-1 means show all.
  const visibleRankings = inReveal
    ? rankings.slice(rankings.length - 1 - revealIndex!)
    : rankings;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('leaderboard.title')}</h1>
          <p className="text-zinc-500 text-sm">
            {isFrozen
              ? <span className="text-neon-gold font-medium">{t('leaderboard.frozenNote')}</span>
              : finalizedAt
                ? <span className="text-neon-green">{t('leaderboard.finalizedAt', { time: new Date(finalizedAt).toLocaleTimeString() })}</span>
                : t('leaderboard.live')}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {/* Finalize */}
          <button
            onClick={handleFinalize}
            disabled={finalizing || freezing}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-neon-green/10 border border-neon-green/30 text-neon-green hover:bg-neon-green/20 disabled:opacity-50 transition-all"
          >
            {finalizing ? t('leaderboard.finalizing') : t('leaderboard.finalize')}
          </button>

          {/* Freeze / Unfreeze */}
          <button
            onClick={() => handleFreeze(!isFrozen)}
            disabled={freezing || finalizing}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 ${
              isFrozen
                ? 'bg-neon-gold/10 border border-neon-gold/30 text-neon-gold hover:bg-neon-gold/20'
                : 'bg-white/5 border border-glass-border text-zinc-300 hover:bg-white/10'
            }`}
          >
            {isFrozen ? t('leaderboard.unfreeze') : t('leaderboard.freeze')}
          </button>

          {/* Reveal mode */}
          {rankings.length > 0 && isFrozen && (
            <button
              onClick={() => {
                if (!inReveal) {
                  setRevealIndex(0);
                } else if (revealIndex! < rankings.length - 1) {
                  setRevealIndex((i) => (i ?? 0) + 1);
                } else {
                  setRevealIndex(null);
                }
              }}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-neon-purple/10 border border-neon-purple/30 text-neon-purple hover:bg-neon-purple/20 transition-all"
            >
              {!inReveal
                ? t('leaderboard.reveal')
                : revealIndex! < rankings.length - 1
                  ? t('leaderboard.revealNext')
                  : t('leaderboard.revealDone')}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {toast && (
        <div className="mb-4 px-4 py-2 rounded-xl bg-app-card border border-glass-border text-zinc-200 text-sm">
          {toast}
        </div>
      )}

      {/* ── Reveal banner ───────────────────────────────────────────────── */}
      {inReveal && visibleRankings.length > 0 && (
        <div className="mb-4 rounded-2xl bg-neon-purple/5 border border-neon-purple/30 px-6 py-5 text-center backdrop-blur-sm">
          <p className="text-neon-purple text-sm font-medium mb-1">
            {t('leaderboard.revealPos', { rank: visibleRankings[0].rank })}
          </p>
          <p className="text-white text-3xl font-brand font-bold">{visibleRankings[0].teamName}</p>
          <p className="text-neon-purple text-xl mt-1">{visibleRankings[0].score} pts</p>
        </div>
      )}

      {/* ── Rankings table ──────────────────────────────────────────────── */}
      {loading ? (
        <div className="rounded-2xl bg-app-card border border-glass-border p-12 text-center text-zinc-600">
          {t('common.loading')}
        </div>
      ) : rankings.length === 0 ? (
        <div className="rounded-2xl bg-app-card border border-glass-border p-12 text-center text-zinc-600">
          {isFrozen ? t('leaderboard.frozenBody') : t('leaderboard.noFinishers')}
        </div>
      ) : (
        <div className="rounded-2xl bg-app-card border border-glass-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-glass-border text-zinc-500 text-xs uppercase tracking-widest">
                <th className="text-start px-4 py-3 w-10">{t('leaderboard.colRank')}</th>
                <th className="text-start px-4 py-3">{t('leaderboard.colTeam')}</th>
                <th className="text-end px-4 py-3">{t('leaderboard.colScore')}</th>
                <th className="text-end px-4 py-3 hidden sm:table-cell">{t('leaderboard.colRaw')}</th>
                <th className="text-end px-4 py-3 hidden md:table-cell">{t('leaderboard.colSlots')}</th>
                <th className="text-end px-4 py-3 hidden md:table-cell">{t('leaderboard.colDuration')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRankings.map((entry) => (
                <tr
                  key={entry.teamId}
                  className={`border-b border-glass-border transition-colors ${
                    entry.rank === 1 ? 'bg-neon-gold/5 border-neon-gold/10' :
                    entry.rank === 2 ? 'bg-white/[0.03]' :
                    entry.rank === 3 ? 'bg-neon-orange/5' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-center font-bold text-lg">
                    {entry.rank <= 3 ? (
                      <span style={{ filter: 'drop-shadow(0 0 6px currentColor)' }}>
                        {MEDAL[entry.rank - 1]}
                      </span>
                    ) : entry.rank}
                  </td>
                  <td className="px-4 py-3 font-medium text-white">{entry.teamName}</td>
                  <td className="px-4 py-3 text-end text-neon-green font-bold font-mono tabular-nums">{entry.score}</td>
                  <td className="px-4 py-3 text-end text-zinc-500 hidden sm:table-cell">
                    {entry.rawScore != null && entry.rawScore !== entry.score ? entry.rawScore : '—'}
                  </td>
                  <td className="px-4 py-3 text-end text-zinc-400 hidden md:table-cell">
                    {entry.completedSlots}/{SLOT_COUNT}
                  </td>
                  <td className="px-4 py-3 text-end text-zinc-500 hidden md:table-cell">
                    {entry.durationMinutes != null
                      ? t('leaderboard.minsLabel', { m: Math.round(entry.durationMinutes) })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { onSnapshot, collection } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, APP_ID, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';

interface QueueEntry {
  teamId: string;
  teamName: string;
  score: number;
  joinedAt: string;
  status: 'waiting' | 'matched' | 'resolved';
  matchId?: string;
}

interface MatchDoc {
  id: string;
  teamAId: string;
  teamAName: string;
  teamBId: string;
  teamBName: string;
  scoreA: number;
  scoreB: number;
  createdAt: string;
  resolvedAt?: string;
  winnerId?: string;
}

export default function MatchmakingPage() {
  const { t } = useI18n();
  const [queue, setQueue]     = useState<QueueEntry[]>([]);
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [toast, setToast]     = useState('');
  const [resolving, setResolving] = useState<string | null>(null);

  const queuePath   = `artifacts/${APP_ID}/public/data/matchQueue`;
  const matchesPath = `artifacts/${APP_ID}/public/data/matches`;

  useEffect(() => {
    let unsubQ: (() => void) | undefined;
    let unsubM: (() => void) | undefined;
    void ensureAuth().then(() => {
      unsubQ = onSnapshot(
        collection(db, queuePath),
        (snap) => setQueue(snap.docs.map((d) => ({ teamId: d.id, ...d.data() } as QueueEntry))),
      );
      unsubM = onSnapshot(
        collection(db, matchesPath),
        (snap) => setMatches(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MatchDoc))),
      );
    });
    return () => { unsubQ?.(); unsubM?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  async function handleResolve(matchId: string, winnerId: string, winnerName: string) {
    setResolving(matchId + winnerId);
    try {
      await ensureAuth();
      const fn = httpsCallable(functions, 'resolveMatch');
      await fn({ matchId, winnerId });
      showToast(t('match.resolved', { winner: winnerName, bonus: '150' }));
    } catch {
      showToast(t('match.resolveError'));
    } finally {
      setResolving(null);
    }
  }

  const waiting  = queue.filter((q) => q.status === 'waiting');
  const matched  = queue.filter((q) => q.status === 'matched');
  const activeM  = matches.filter((m) => !m.resolvedAt);
  const resolvedM = matches.filter((m) => m.resolvedAt);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">{t('match.title')}</h1>
        <p className="text-zinc-500 text-sm">{t('match.subtitle')}</p>
      </div>

      {toast && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Queue ─────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            {t('match.queueTitle')} ({waiting.length + matched.length})
          </h2>
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 divide-y divide-zinc-800">
            {waiting.length + matched.length === 0 ? (
              <p className="px-4 py-6 text-zinc-600 text-sm text-center">{t('match.empty')}</p>
            ) : (
              [...waiting, ...matched].map((entry) => (
                <div key={entry.teamId} className="px-4 py-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-white text-sm">{entry.teamName}</p>
                    <p className="text-xs text-zinc-500">
                      {t('match.score', { score: entry.score })} ·{' '}
                      {t('match.waited', { min: Math.round((Date.now() - new Date(entry.joinedAt).getTime()) / 60000) })}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    entry.status === 'waiting'
                      ? 'bg-yellow-900/50 text-yellow-300'
                      : 'bg-blue-900/50 text-blue-300'
                  }`}>
                    {t(`match.${entry.status}`)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── Active matches ────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            {t('match.activeTitle')} ({activeM.length})
          </h2>
          <div className="space-y-3">
            {activeM.length === 0 ? (
              <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-6 text-zinc-600 text-sm text-center">
                {t('match.noMatches')}
              </div>
            ) : (
              activeM.map((m) => (
                <div key={m.id} className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-center flex-1">
                      <p className="font-semibold text-white">{m.teamAName}</p>
                      <p className="text-xs text-zinc-500">{m.scoreA} pts</p>
                    </div>
                    <span className="text-zinc-600 text-sm font-bold px-2">{t('match.vs')}</span>
                    <div className="text-center flex-1">
                      <p className="font-semibold text-white">{m.teamBName}</p>
                      <p className="text-xs text-zinc-500">{m.scoreB} pts</p>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-600 text-center mb-3">
                    {t('match.bonusPts', { bonus: '150' })}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleResolve(m.id, m.teamAId, m.teamAName)}
                      disabled={resolving !== null}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-emerald-900 text-emerald-300 hover:bg-emerald-800 disabled:opacity-50 transition-colors"
                    >
                      {resolving === m.id + m.teamAId ? t('match.resolving') : t('match.winA', { name: m.teamAName })}
                    </button>
                    <button
                      onClick={() => handleResolve(m.id, m.teamBId, m.teamBName)}
                      disabled={resolving !== null}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-emerald-900 text-emerald-300 hover:bg-emerald-800 disabled:opacity-50 transition-colors"
                    >
                      {resolving === m.id + m.teamBId ? t('match.resolving') : t('match.winB', { name: m.teamBName })}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* ── Resolved matches ──────────────────────────────────────────────── */}
      {resolvedM.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Resolved ({resolvedM.length})
          </h2>
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 divide-y divide-zinc-800">
            {resolvedM.map((m) => (
              <div key={m.id} className="px-4 py-3 flex items-center justify-between text-sm">
                <span className="text-zinc-300">{m.teamAName} {t('match.vs')} {m.teamBName}</span>
                <span className="text-emerald-400 font-medium">
                  {m.winnerId === m.teamAId ? m.teamAName : m.teamBName} 🏆
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

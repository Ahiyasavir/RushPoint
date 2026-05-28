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
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('match.title')}</h1>
        <p className="text-zinc-500 text-sm">{t('match.subtitle')}</p>
      </div>

      {toast && (
        <div className="rounded-xl bg-app-card border border-glass-border text-zinc-200 text-sm px-4 py-2 mb-4">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Queue ─────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
            {t('match.queueTitle')} ({waiting.length + matched.length})
          </h2>
          <div className="rounded-2xl bg-app-card border border-glass-border divide-y divide-glass-border">
            {waiting.length + matched.length === 0 ? (
              <p className="px-4 py-6 text-zinc-600 text-sm text-center">{t('match.empty')}</p>
            ) : (
              [...waiting, ...matched].map((entry) => (
                <div key={entry.teamId} className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-app-raised transition-colors">
                  <div>
                    <p className="font-semibold text-white text-sm">{entry.teamName}</p>
                    <p className="text-xs text-zinc-500">
                      {t('match.score', { score: entry.score })} ·{' '}
                      {t('match.waited', { min: Math.round((Date.now() - new Date(entry.joinedAt).getTime()) / 60000) })}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${
                    entry.status === 'waiting'
                      ? 'bg-neon-gold/10 text-neon-gold border-neon-gold/30'
                      : 'bg-neon-blue/10 text-neon-blue border-neon-blue/30'
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
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
            {t('match.activeTitle')} ({activeM.length})
          </h2>
          <div className="space-y-3">
            {activeM.length === 0 ? (
              <div className="rounded-2xl bg-app-card border border-glass-border px-4 py-6 text-zinc-600 text-sm text-center">
                {t('match.noMatches')}
              </div>
            ) : (
              activeM.map((m) => (
                <div key={m.id} className="rounded-2xl bg-app-card border border-neon-orange/20 p-5 hover:border-neon-orange/40 transition-all">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-center flex-1">
                      <p className="font-semibold text-white">{m.teamAName}</p>
                      <p className="text-xs text-zinc-500">{m.scoreA} pts</p>
                    </div>
                    <span className="text-zinc-500 text-sm font-bold px-3 py-1 rounded-lg bg-app-raised border border-glass-border">
                      {t('match.vs')}
                    </span>
                    <div className="text-center flex-1">
                      <p className="font-semibold text-white">{m.teamBName}</p>
                      <p className="text-xs text-zinc-500">{m.scoreB} pts</p>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-600 text-center mb-3 font-mono">
                    {t('match.bonusPts', { bonus: '150' })}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleResolve(m.id, m.teamAId, m.teamAName)}
                      disabled={resolving !== null}
                      className="flex-1 py-2 rounded-xl text-sm font-semibold bg-neon-green/10 border border-neon-green/30 text-neon-green hover:bg-neon-green/20 disabled:opacity-50 transition-all"
                    >
                      {resolving === m.id + m.teamAId ? t('match.resolving') : t('match.winA', { name: m.teamAName })}
                    </button>
                    <button
                      onClick={() => handleResolve(m.id, m.teamBId, m.teamBName)}
                      disabled={resolving !== null}
                      className="flex-1 py-2 rounded-xl text-sm font-semibold bg-neon-green/10 border border-neon-green/30 text-neon-green hover:bg-neon-green/20 disabled:opacity-50 transition-all"
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
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
            Resolved ({resolvedM.length})
          </h2>
          <div className="rounded-2xl bg-app-card border border-glass-border divide-y divide-glass-border">
            {resolvedM.map((m) => (
              <div key={m.id} className="px-4 py-3 flex items-center justify-between text-sm">
                <span className="text-zinc-300">{m.teamAName} {t('match.vs')} {m.teamBName}</span>
                <span className="text-neon-green font-medium">
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

import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';
import AlertsBanner from '../components/AlertsBanner';

interface Arrival {
  checkInId: string;
  teamId: string;
  teamName: string;
  teamCode: string;
  taskId: string;
  taskTitle: string;
  timestamp: string | null;
  arrivedAt: string | null;
}

const listPendingArrivals = httpsCallable(functions, 'listPendingArrivals');
const cancelCheckIn = httpsCallable(functions, 'cancelCheckIn');
const checkInArrival = httpsCallable(functions, 'checkInArrival');

export default function CheckInsPage() {
  const { t } = useI18n();
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await ensureAuth();
      const res = await listPendingArrivals();
      setArrivals((res.data as { arrivals: Arrival[] }).arrivals ?? []);
    } catch (e) {
      setError(t('checkins.loadError'));
      console.error('[checkins] listPendingArrivals failed:', e);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  // Confirm the team physically arrived → freezes their clock and moves them into
  // the judge's scoring queue. Until a volunteer does this, the team is NOT shown
  // to the judges.
  const confirm = useCallback(async (a: Arrival) => {
    setConfirmingId(a.checkInId);
    setError('');
    try {
      await ensureAuth();
      await checkInArrival({ teamId: a.teamId, checkInId: a.checkInId });
      setArrivals((prev) => prev.filter((x) => x.checkInId !== a.checkInId));
    } catch (e) {
      setError(t('checkins.confirmError'));
      console.error('[checkins] checkInArrival failed:', e);
    } finally {
      setConfirmingId(null);
    }
  }, [t]);

  const remove = useCallback(async (a: Arrival) => {
    if (!window.confirm(t('checkins.removeConfirm'))) return;
    setRemovingId(a.checkInId);
    setError('');
    try {
      await ensureAuth();
      await cancelCheckIn({ teamId: a.teamId, checkInId: a.checkInId });
      setArrivals((prev) => prev.filter((x) => x.checkInId !== a.checkInId));
    } catch (e) {
      setError(t('checkins.removeError'));
      console.error('[checkins] cancelCheckIn failed:', e);
    } finally {
      setRemovingId(null);
    }
  }, [t]);

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      {/* ── Live SOS / call-staff alerts (shared component) ──────────────── */}
      <AlertsBanner />

      <div className="flex items-center justify-between mb-1">
        <h1 className="font-brand text-2xl font-bold text-white">{t('checkins.title')}</h1>
        <button
          onClick={() => void load()}
          className="text-sm text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg border border-glass-border hover:bg-white/5 transition-all"
        >
          {t('common.refresh')}
        </button>
      </div>
      <p className="text-zinc-500 text-sm mb-6">{t('checkins.subtitle')}</p>

      {error && (
        <div className="mb-6 rounded-xl bg-red-950/50 border border-red-500/30 px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-app-card border border-glass-border p-12 text-center text-zinc-500">
          {t('common.loading')}
        </div>
      ) : arrivals.length === 0 ? (
        <div className="rounded-2xl bg-app-card border border-glass-border p-12 text-center text-zinc-600">
          {t('checkins.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {arrivals.map((a) => (
            <div
              key={a.checkInId}
              className="flex items-center justify-between rounded-2xl bg-app-card border border-glass-border px-5 py-4 hover:border-neon-green/20 transition-all"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{a.teamName}</span>
                  {a.teamCode && (
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-app-raised text-zinc-400">
                      {a.teamCode}
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-500 mt-0.5">{a.taskTitle}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void confirm(a)}
                  disabled={confirmingId === a.checkInId || removingId === a.checkInId}
                  className="text-sm px-4 py-2 rounded-xl bg-neon-green/10 border border-neon-green/40 text-neon-green font-semibold hover:bg-neon-green/20 transition-all disabled:opacity-40"
                >
                  {confirmingId === a.checkInId ? t('checkins.confirming') : t('checkins.confirmArrival')}
                </button>
                <button
                  onClick={() => void remove(a)}
                  disabled={removingId === a.checkInId || confirmingId === a.checkInId}
                  className="text-xs px-2.5 py-1 rounded-full border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-all disabled:opacity-40"
                >
                  {removingId === a.checkInId ? t('common.loading') : t('checkins.remove')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
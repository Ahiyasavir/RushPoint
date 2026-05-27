import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';

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

export default function CheckInsPage() {
  const { t } = useI18n();
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-white">{t('checkins.title')}</h1>
        <button onClick={() => void load()} className="text-sm text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-zinc-800">{t('common.refresh')}</button>
      </div>
      <p className="text-zinc-500 text-sm mb-6">{t('checkins.subtitle')}</p>

      {error && (
        <div className="mb-6 rounded-lg bg-red-950 border border-red-800 px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-12 text-center text-zinc-500">{t('common.loading')}</div>
      ) : arrivals.length === 0 ? (
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-12 text-center text-zinc-600">{t('checkins.empty')}</div>
      ) : (
        <div className="space-y-3">
          {arrivals.map((a) => (
            <div key={a.checkInId} className="flex items-center justify-between rounded-xl bg-zinc-900 border border-zinc-800 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{a.teamName}</span>
                  {a.teamCode && (
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{a.teamCode}</span>
                  )}
                </div>
                <p className="text-sm text-zinc-500 mt-0.5">{a.taskTitle}</p>
              </div>
              <span className={a.arrivedAt
                ? 'text-xs px-2 py-1 rounded-full border bg-sky-950 border-sky-800 text-sky-300'
                : 'text-xs px-2 py-1 rounded-full border bg-amber-950 border-amber-800 text-amber-300'}>
                {a.arrivedAt ? t('checkins.checkedIn') : t('checkins.waiting')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
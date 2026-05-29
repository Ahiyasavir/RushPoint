import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { onSnapshot, collection } from 'firebase/firestore';
import { db, functions, APP_ID, ensureAuth } from '../services/firebase';
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

interface AlertDoc {
  id: string;
  type: string;
  teamName?: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  location?: { lat: number; lng: number };
}

const listPendingArrivals = httpsCallable(functions, 'listPendingArrivals');

export default function CheckInsPage() {
  const { t } = useI18n();
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [ackingId, setAckingId] = useState<string | null>(null);

  // Live SOS / admin alerts (unacknowledged only).
  useEffect(() => {
    let unsub: (() => void) | undefined;
    void ensureAuth().then(() => {
      unsub = onSnapshot(
        collection(db, `artifacts/${APP_ID}/public/data/adminAlerts`),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as AlertDoc)
            .filter((a) => !a.acknowledged)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          setAlerts(list);
        },
        () => setAlerts([]),
      );
    });
    return () => unsub?.();
  }, []);

  async function handleAck(alertId: string) {
    setAckingId(alertId);
    try {
      await ensureAuth();
      await httpsCallable(functions, 'acknowledgeAlert')({ alertId });
    } catch (e) {
      console.error('[checkins] acknowledgeAlert failed:', e);
    } finally {
      setAckingId(null);
    }
  }

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
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      {/* ── Live SOS / emergency alerts ──────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-4 rounded-2xl bg-neon-red/10 border border-neon-red/40 px-5 py-4 animate-pulse"
              style={{ animationDuration: '2.5s' }}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🆘</span>
                <div>
                  <p className="font-bold text-neon-red">
                    {a.teamName ?? t('alerts.unknownTeam')}
                    <span className="ms-2 text-xs font-mono text-neon-red/60 uppercase">{a.type}</span>
                  </p>
                  <p className="text-sm text-zinc-300">{a.message}</p>
                  {a.location && (
                    <a
                      href={`https://maps.google.com/?q=${a.location.lat},${a.location.lng}`}
                      target="_blank" rel="noreferrer"
                      className="text-xs text-neon-blue hover:underline font-mono"
                    >
                      📍 {a.location.lat.toFixed(5)}, {a.location.lng.toFixed(5)}
                    </a>
                  )}
                </div>
              </div>
              <button
                onClick={() => void handleAck(a.id)}
                disabled={ackingId === a.id}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-neon-red/40 text-neon-red hover:bg-neon-red/15 disabled:opacity-40 transition-all whitespace-nowrap"
              >
                {ackingId === a.id ? t('alerts.acking') : t('alerts.ack')}
              </button>
            </div>
          ))}
        </div>
      )}

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
              <span className={
                a.arrivedAt
                  ? 'text-xs px-2.5 py-1 rounded-full border bg-neon-blue/10 border-neon-blue/30 text-neon-blue'
                  : 'text-xs px-2.5 py-1 rounded-full border bg-neon-gold/10 border-neon-gold/30 text-neon-gold'
              }>
                {a.arrivedAt ? t('checkins.checkedIn') : t('checkins.waiting')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
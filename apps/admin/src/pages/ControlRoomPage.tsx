import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import type { PendingArrival } from '@rushpoint/shared';
import { db, ensureAuth, APP_ID } from '../services/firebase';
import { callable } from '../services/api';
import { usePoll } from '../hooks/usePoll';
import { useI18n } from '../i18n';

// ─── Types ──────────────────────────────────────────────────────────────────
interface AlertDoc {
  id: string;
  kind?: 'emergency' | 'technical';
  teamName?: string;
  message?: string;
  acknowledged?: boolean;
}
interface StationDoc {
  id: string;
  title?: string;
  status?: 'active' | 'paused' | 'closed';
}

const listPendingArrivals = callable<{ status?: string }, { arrivals: PendingArrival[] }>('listPendingArrivals');

const POLL_MS = 12000;

// ═══════════════════════════════════════════════════════════════════════════════
// Control Room — one prioritized "needs attention" triage view for the organizer:
// active SOS alerts, teams over their station time cap, paused/closed stations,
// and the pending-judge-review backlog. Composes data the other pages already
// read; every row routes to the existing page where the organizer can act.
// ═══════════════════════════════════════════════════════════════════════════════
export default function ControlRoomPage() {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [alerts, setAlerts]     = useState<AlertDoc[]>([]);
  const [stations, setStations] = useState<StationDoc[]>([]);
  const [arrivals, setArrivals] = useState<PendingArrival[]>([]);
  const [now, setNow]           = useState(Date.now());
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      await ensureAuth();
      const [alertSnap, taskSnap, arr] = await Promise.all([
        getDocs(collection(db, `artifacts/${APP_ID}/public/data/adminAlerts`)),
        getDocs(collection(db, `artifacts/${APP_ID}/public/data/tasks`)),
        listPendingArrivals({ status: 'arrived' }),
      ]);
      setAlerts(
        alertSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<AlertDoc, 'id'>) }))
          .filter((a) => !a.acknowledged),
      );
      setStations(
        taskSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<StationDoc, 'id'>) }))
          .filter((s) => s.status === 'paused' || s.status === 'closed')
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
      setArrivals(arr.arrivals ?? []);
      setNow(Date.now());
    } catch {
      setError(t('ctrl.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  usePoll(load, POLL_MS);

  // Teams checked in at the judge past their station's max cap — mirrors the
  // JudgePage timeout warning (Task.maxDurationMinutes vs elapsed since arrival).
  const overCap = arrivals
    .map((a) => {
      const startedMs = a.arrivedAt ? Date.parse(a.arrivedAt) : NaN;
      const elapsedMin = Number.isNaN(startedMs) ? 0 : Math.floor((now - startedMs) / 60000);
      return { a, elapsedMin };
    })
    .filter(({ a, elapsedMin }) => !!a.maxDurationMinutes && elapsedMin > (a.maxDurationMinutes ?? 0));

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 md:p-8">
        <div className="rounded-2xl bg-app-card border border-glass-border p-12 text-center text-zinc-500">
          {t('ctrl.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('ctrl.title')}</h1>
          <p className="text-zinc-500 text-sm">{t('ctrl.subtitle')}</p>
        </div>
        <button
          onClick={() => void load()}
          className="shrink-0 text-sm text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg border border-glass-border hover:bg-white/5 transition-all"
        >
          ↻ {t('common.refresh')}
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-950/50 border border-red-500/30 px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {/* 1. Active SOS / help alerts (highest priority) */}
      <Section
        title={t('ctrl.sosTitle')}
        count={alerts.length}
        action={t('ctrl.openManager')}
        onAction={() => navigate('/manager')}
        tone="red"
      >
        {alerts.length === 0 ? (
          <Empty label={t('ctrl.allClear')} />
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => {
              const emergency = (a.kind ?? 'emergency') === 'emergency';
              return (
                <Row key={a.id} onClick={() => navigate('/manager')} tone={emergency ? 'red' : 'orange'}>
                  <span className="text-lg">{emergency ? '🆘' : '🛠️'}</span>
                  <span className="font-semibold text-white truncate">{a.teamName ?? t('alerts.unknownTeam')}</span>
                  <span className="text-xs font-mono uppercase opacity-70">
                    {emergency ? t('alerts.emergency') : t('alerts.technical')}
                  </span>
                  {a.message && <span className="text-zinc-400 text-sm truncate">— {a.message}</span>}
                </Row>
              );
            })}
          </div>
        )}
      </Section>

      {/* 2. Teams over their station time cap */}
      <Section
        title={t('ctrl.capTitle')}
        count={overCap.length}
        action={t('ctrl.openJudge')}
        onAction={() => navigate('/judge')}
        tone="orange"
      >
        {overCap.length === 0 ? (
          <Empty label={t('ctrl.allClear')} />
        ) : (
          <div className="space-y-2">
            {overCap.map(({ a, elapsedMin }) => (
              <Row key={a.checkInId} onClick={() => navigate('/judge')} tone="orange">
                <span className="text-lg">⏱</span>
                <span className="font-semibold text-white truncate">{a.teamName}</span>
                <span className="text-zinc-400 text-sm truncate">{a.taskTitle}</span>
                <span className="ms-auto shrink-0 font-mono text-sm text-neon-red">
                  {t('ctrl.capElapsed', { elapsed: elapsedMin, max: a.maxDurationMinutes ?? 0 })}
                </span>
              </Row>
            ))}
          </div>
        )}
      </Section>

      {/* 3. Paused / closed stations */}
      <Section
        title={t('ctrl.stationsTitle')}
        count={stations.length}
        action={t('ctrl.openManager')}
        onAction={() => navigate('/manager')}
        tone="orange"
      >
        {stations.length === 0 ? (
          <Empty label={t('ctrl.allClear')} />
        ) : (
          <div className="space-y-2">
            {stations.map((s) => (
              <Row key={s.id} onClick={() => navigate('/manager')} tone={s.status === 'closed' ? 'red' : 'orange'}>
                <span className="text-lg">{s.status === 'closed' ? '⛔' : '⏸'}</span>
                <span className="font-semibold text-white truncate">{s.title || s.id}</span>
                <span className="ms-auto shrink-0 text-xs font-mono uppercase opacity-70">
                  {s.status === 'closed' ? t('mgr.statusClosed') : t('mgr.statusPaused')}
                </span>
              </Row>
            ))}
          </div>
        )}
      </Section>

      {/* 4. Pending judge reviews (backlog count) */}
      <Section
        title={t('ctrl.reviewsTitle')}
        count={arrivals.length}
        action={t('ctrl.openJudge')}
        onAction={() => navigate('/judge')}
        tone="blue"
      >
        {arrivals.length === 0 ? (
          <Empty label={t('ctrl.allClear')} />
        ) : (
          <Row onClick={() => navigate('/judge')} tone="blue">
            <span className="text-lg">⚖️</span>
            <span className="text-zinc-200 text-sm">{t('ctrl.reviewsCount', { n: arrivals.length })}</span>
          </Row>
        )}
      </Section>
    </div>
  );
}

// ─── Building blocks ────────────────────────────────────────────────────────
type Tone = 'red' | 'orange' | 'blue';

const COUNT_TONE: Record<Tone, string> = {
  red: 'bg-neon-red/15 text-neon-red border-neon-red/40',
  orange: 'bg-neon-orange/15 text-neon-orange border-neon-orange/40',
  blue: 'bg-neon-blue/15 text-neon-blue border-neon-blue/40',
};

const ROW_TONE: Record<Tone, string> = {
  red: 'hover:border-neon-red/40',
  orange: 'hover:border-neon-orange/40',
  blue: 'hover:border-neon-blue/40',
};

function Section({
  title, count, action, onAction, tone, children,
}: {
  title: string;
  count: number;
  action: string;
  onAction: () => void;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-white font-semibold text-lg">
          {title}
          <span className={`inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full border text-xs font-bold tabular-nums ${
            count > 0 ? COUNT_TONE[tone] : 'bg-app-card text-zinc-500 border-glass-border'
          }`}>
            {count}
          </span>
        </h2>
        <button
          onClick={onAction}
          className="text-sm text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg border border-glass-border hover:bg-white/5 transition-all"
        >
          {action} →
        </button>
      </div>
      {children}
    </section>
  );
}

function Row({
  children, onClick, tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone: Tone;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 text-start rounded-xl bg-app-card border border-glass-border px-4 py-3 transition-all ${ROW_TONE[tone]}`}
    >
      {children}
    </button>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-app-card border border-glass-border px-4 py-3 text-neon-green/80 text-sm">
      <span>✓</span>
      <span>{label}</span>
    </div>
  );
}

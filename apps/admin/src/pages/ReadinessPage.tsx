import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { FIRESTORE_PATHS } from '@rushpoint/shared';
import { callable } from '../services/api';
import { db, APP_ID } from '../services/firebase';
import { useI18n } from '../i18n';

// Event-day pre-flight: three on-demand checks (seed integrity, code provisioning,
// callable health) rolled up into a single green/red go-live banner. On-demand only
// — no polling; the manager re-runs it with the Re-check button before doors open.

type CheckState = 'pending' | 'pass' | 'fail';

interface CheckResult {
  state: CheckState;
  message: string;
}

const listTeamsFn = callable<void, { teams: unknown[] }>('listTeams');

// Resolve, or reject after `ms` so a hung emulator can't leave the check spinning.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function ReadinessPage() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<CheckResult>({ state: 'pending', message: '' });
  const [codes, setCodes] = useState<CheckResult>({ state: 'pending', message: '' });
  const [callableCheck, setCallableCheck] = useState<CheckResult>({ state: 'pending', message: '' });
  const [running, setRunning] = useState(false);

  const runChecks = useCallback(async () => {
    setRunning(true);
    setTasks({ state: 'pending', message: '' });
    setCodes({ state: 'pending', message: '' });
    setCallableCheck({ state: 'pending', message: '' });

    // (1) public/data/tasks — report the task count or 'empty'.
    try {
      const snap = await getDocs(collection(db, FIRESTORE_PATHS.public(APP_ID, 'tasks')));
      if (snap.size === 0) setTasks({ state: 'fail', message: t('readiness.tasksEmpty') });
      else setTasks({ state: 'pass', message: t('readiness.tasksOk', { n: snap.size }) });
    } catch (err: unknown) {
      setTasks({ state: 'fail', message: errMsg(err) });
    }

    // (2) accessCodes — report total + unclaimed count.
    try {
      const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'accessCodes'));
      const unclaimed = snap.docs.filter((d) => {
        const data = d.data() as Record<string, unknown>;
        const status = (data.status as string | undefined)
          ?? ((data.claimed as boolean | undefined) ? 'used' : 'unused');
        return status === 'unused';
      }).length;
      if (snap.size === 0) setCodes({ state: 'fail', message: t('readiness.codesEmpty') });
      else setCodes({ state: 'pass', message: t('readiness.codesOk', { n: snap.size, free: unclaimed }) });
    } catch (err: unknown) {
      setCodes({ state: 'fail', message: errMsg(err) });
    }

    // (3) listTeams callable — confirm core functions are reachable.
    try {
      await withTimeout(listTeamsFn(), 5000);
      setCallableCheck({ state: 'pass', message: t('readiness.callableOk') });
    } catch (err: unknown) {
      setCallableCheck({ state: 'fail', message: errMsg(err) });
    }

    setRunning(false);
  }, [t]);

  useEffect(() => { void runChecks(); }, [runChecks]);

  const checks: { key: string; result: CheckResult }[] = [
    { key: 'readiness.tasks', result: tasks },
    { key: 'readiness.codes', result: codes },
    { key: 'readiness.callable', result: callableCheck },
  ];

  const anyPending = checks.some((c) => c.result.state === 'pending');
  const anyFail = checks.some((c) => c.result.state === 'fail');
  const allGood = !anyPending && !anyFail;

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('readiness.title')}</h1>
          <p className="text-zinc-500 text-sm">{t('readiness.subtitle')}</p>
        </div>
        <button
          onClick={() => void runChecks()}
          disabled={running}
          className="px-4 py-2 text-sm rounded-xl border border-glass-border text-zinc-300 hover:text-white hover:bg-white/5 disabled:opacity-40 transition-all backdrop-blur-sm"
        >
          {running ? t('readiness.checking') : t('readiness.recheck')}
        </button>
      </div>

      <div
        className={`mb-6 rounded-2xl border px-6 py-8 text-center backdrop-blur-sm ${
          anyPending
            ? 'border-glass-border bg-app-surface'
            : allGood
              ? 'border-neon-green/40 bg-neon-green/5'
              : 'border-neon-red/40 bg-neon-red/5'
        }`}
      >
        <div
          className={`font-brand text-4xl font-extrabold tracking-tight ${
            anyPending ? 'text-zinc-500' : allGood ? 'text-neon-green' : 'text-neon-red'
          }`}
        >
          {anyPending ? t('readiness.checking') : allGood ? t('readiness.allGood') : t('readiness.actionNeeded')}
        </div>
      </div>

      <div className="rounded-2xl border border-glass-border overflow-hidden">
        {checks.map(({ key, result }, i) => (
          <div
            key={key}
            className={`flex items-start gap-4 px-5 py-4 bg-app-card ${
              i > 0 ? 'border-t border-glass-border' : ''
            }`}
          >
            <span
              className={`text-xl leading-none mt-0.5 ${
                result.state === 'pass'
                  ? 'text-neon-green'
                  : result.state === 'fail'
                    ? 'text-neon-red'
                    : 'text-zinc-600'
              }`}
            >
              {result.state === 'pass' ? '✓' : result.state === 'fail' ? '✕' : '…'}
            </span>
            <div className="min-w-0">
              <div className="text-white text-sm font-medium">{t(key)}</div>
              <div className="text-zinc-500 text-sm break-words">
                {result.state === 'pending' ? t('readiness.running') : result.message}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

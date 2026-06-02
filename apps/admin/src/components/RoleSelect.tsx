import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, APP_ID, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';
import { ALL_ROLES, useRole, type Role } from '../roles';

interface StationOption { id: string; title: string }

const ROLE_META: Record<Role, { icon: string; titleKey: string; descKey: string; accent: string }> = {
  manager:   { icon: '🎛️', titleKey: 'role.manager',   descKey: 'role.managerDesc',   accent: 'border-neon-green/40 hover:bg-neon-green/10' },
  judge:     { icon: '⚖️', titleKey: 'role.judge',     descKey: 'role.judgeDesc',     accent: 'border-neon-gold/40 hover:bg-neon-gold/10' },
  operator:  { icon: '📍', titleKey: 'role.operator',  descKey: 'role.operatorDesc',  accent: 'border-neon-blue/40 hover:bg-neon-blue/10' },
  volunteer: { icon: '🤝', titleKey: 'role.volunteer', descKey: 'role.volunteerDesc', accent: 'border-neon-orange/40 hover:bg-neon-orange/10' },
  duelModerator:   { icon: '⚔️', titleKey: 'role.duelModerator',   descKey: 'role.duelModeratorDesc',   accent: 'border-neon-blue/40 hover:bg-neon-blue/10' },
  arrivalApprover: { icon: '🏁', titleKey: 'role.arrivalApprover', descKey: 'role.arrivalApproverDesc', accent: 'border-neon-gold/40 hover:bg-neon-gold/10' },
  teneDistributor: { icon: '🧺', titleKey: 'role.teneDistributor', descKey: 'role.teneDistributorDesc', accent: 'border-neon-orange/40 hover:bg-neon-orange/10' },
};

export default function RoleSelect() {
  const { t } = useI18n();
  const { setRole } = useRole();
  // Operator must bind to one real station (a task) before entering — picked
  // once here, so the Station console needs no second selection.
  const [pendingOperator, setPendingOperator] = useState(false);
  const [stations, setStations] = useState<StationOption[] | null>(null); // null = still loading
  const [station, setStation] = useState('');

  // Load the real station list (tasks) when the operator sub-screen opens.
  useEffect(() => {
    if (!pendingOperator) return;
    void ensureAuth().then(async () => {
      const snap = await getDocs(collection(db, `artifacts/${APP_ID}/public/data/tasks`));
      const opts = snap.docs
        .map((d) => ({ id: d.id, title: (d.data() as { title?: string }).title ?? d.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
      setStations(opts);
      setStation((cur) => cur || opts[0]?.id || '');
    });
  }, [pendingOperator]);

  function choose(role: Role) {
    if (role === 'operator') { setPendingOperator(true); return; }
    setRole(role);
  }

  if (pendingOperator) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-glass-border bg-app-surface/60 p-8 backdrop-blur-xl">
          <button onClick={() => setPendingOperator(false)} className="text-sm text-zinc-500 hover:text-white mb-4">
            ← {t('common.back')}
          </button>
          <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('role.pickStation')}</h1>
          <p className="text-zinc-500 text-sm mb-6">{t('role.pickStationHint')}</p>
          <div className="flex items-center gap-3">
            <select
              value={station}
              onChange={(e) => setStation(e.target.value)}
              disabled={!stations || stations.length === 0}
              className="flex-1 px-4 py-3 rounded-xl bg-app-card border border-glass-border text-white text-lg disabled:opacity-50"
            >
              {stations === null ? (
                <option value="">{t('role.loadingStations')}</option>
              ) : stations.length === 0 ? (
                <option value="">{t('role.noStations')}</option>
              ) : (
                stations.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.id})</option>)
              )}
            </select>
            <button
              onClick={() => setRole('operator', station)}
              disabled={!station}
              className="px-6 py-3 rounded-xl bg-neon-green text-black font-bold hover:opacity-90 disabled:opacity-50"
            >
              {t('role.enter')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <span className="font-brand text-2xl font-bold tracking-tight">
            Rush<span className="text-neon-green">Point</span>
          </span>
          <h1 className="font-brand text-xl font-semibold text-white mt-4">{t('role.chooseTitle')}</h1>
          <p className="text-zinc-500 text-sm mt-1">{t('role.chooseHint')}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ALL_ROLES.map((role) => {
            const m = ROLE_META[role];
            return (
              <button
                key={role}
                onClick={() => choose(role)}
                className={`text-start rounded-2xl border bg-app-card p-5 transition-all ${m.accent}`}
              >
                <div className="text-3xl mb-2">{m.icon}</div>
                <p className="text-white font-semibold">{t(m.titleKey)}</p>
                <p className="text-zinc-500 text-sm mt-1">{t(m.descKey)}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

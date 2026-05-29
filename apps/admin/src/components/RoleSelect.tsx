import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { ALL_ROLES, useRole, type Role } from '../roles';

// Number of physical stations at the event (operators pick theirs).
const STATION_COUNT = 25;

const ROLE_META: Record<Role, { icon: string; titleKey: string; descKey: string; accent: string }> = {
  manager:   { icon: '🎛️', titleKey: 'role.manager',   descKey: 'role.managerDesc',   accent: 'border-neon-green/40 hover:bg-neon-green/10' },
  judge:     { icon: '⚖️', titleKey: 'role.judge',     descKey: 'role.judgeDesc',     accent: 'border-neon-gold/40 hover:bg-neon-gold/10' },
  operator:  { icon: '📍', titleKey: 'role.operator',  descKey: 'role.operatorDesc',  accent: 'border-neon-blue/40 hover:bg-neon-blue/10' },
  volunteer: { icon: '🤝', titleKey: 'role.volunteer', descKey: 'role.volunteerDesc', accent: 'border-neon-orange/40 hover:bg-neon-orange/10' },
};

export default function RoleSelect() {
  const { t } = useI18n();
  const { setRole } = useRole();
  // Operator must pick a station before entering.
  const [pendingOperator, setPendingOperator] = useState(false);
  const [station, setStation] = useState('1');

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
              className="flex-1 px-4 py-3 rounded-xl bg-app-card border border-glass-border text-white text-lg"
            >
              {Array.from({ length: STATION_COUNT }, (_, i) => String(i + 1)).map((n) => (
                <option key={n} value={n}>{t('role.stationN', { n })}</option>
              ))}
            </select>
            <button
              onClick={() => setRole('operator', station)}
              className="px-6 py-3 rounded-xl bg-neon-green text-black font-bold hover:opacity-90"
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

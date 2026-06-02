import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { TeamSummary as Team } from '@rushpoint/shared';
import { callable } from '../services/api';
import { useI18n } from '../i18n';
import AlertsBanner from '../components/AlertsBanner';

const listTeams = callable<void, { teams: Team[] }>('listTeams');
const startCraftingForTeam = callable<{ teamId: string }>('startCraftingForTeam');

// Three Tene hubs (basket-crafting zones). The distributor picks the one they
// are staffing; it scopes the help text and which counter the start affects.
const HUBS = ['1', '2', '3'];

export default function TenePage() {
  const { t } = useI18n();
  const [hub, setHub] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listTeams();
      setTeams(res.teams ?? []);
    } catch (e) {
      setError(t('tene.loadError'));
      console.error('[tene] listTeams failed:', e);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  // Teams at the basket/crafting leg: orange (heading to the hub) or gold
  // (at the hub) that have NOT yet started the 20-min clock.
  const atHub = useMemo(
    () => teams.filter((tm) => !tm.crafting && (tm.stageType === 'orange' || tm.stageType === 'gold')),
    [teams],
  );

  const start = useCallback(async (tm: Team) => {
    setBusyId(tm.id);
    setError('');
    try {
      await startCraftingForTeam({ teamId: tm.id });
      // Reflect locally so the row drops out of the queue immediately.
      setTeams((prev) => prev.map((x) => (x.id === tm.id ? { ...x, crafting: true } : x)));
    } catch (e) {
      setError(t('tene.startError'));
      console.error('[tene] startCraftingForTeam failed:', e);
    } finally {
      setBusyId(null);
    }
  }, [t]);

  // Hub picker (shown until the distributor chooses which hub they staff).
  if (!hub) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-glass-border bg-app-surface/60 p-8 backdrop-blur-xl">
          <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('tene.pickHub')}</h1>
          <p className="text-zinc-500 text-sm mb-6">{t('tene.pickHubHint')}</p>
          <div className="grid grid-cols-3 gap-3">
            {HUBS.map((h) => (
              <button
                key={h}
                onClick={() => setHub(h)}
                className="rounded-2xl border border-neon-orange/40 bg-app-card p-6 text-center hover:bg-neon-orange/10 transition-all"
              >
                <div className="text-3xl mb-1">🧺</div>
                <p className="text-white font-semibold">{t('tene.hubN', { n: h })}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <AlertsBanner />

      <div className="flex items-center justify-between mb-1">
        <h1 className="font-brand text-2xl font-bold text-white">{t('tene.hubN', { n: hub })}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHub(null)}
            className="text-sm text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg border border-glass-border hover:bg-white/5 transition-all"
          >
            {t('tene.switchHub')}
          </button>
          <button
            onClick={() => void load()}
            className="text-sm text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg border border-glass-border hover:bg-white/5 transition-all"
          >
            {t('common.refresh')}
          </button>
        </div>
      </div>
      <p className="text-zinc-500 text-sm mb-6">{t('tene.subtitle')}</p>

      {error && (
        <div className="mb-6 rounded-xl bg-red-950/50 border border-red-500/30 px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-app-card border border-glass-border p-12 text-center text-zinc-500">
          {t('common.loading')}
        </div>
      ) : atHub.length === 0 ? (
        <div className="rounded-2xl bg-app-card border border-glass-border p-12 text-center text-zinc-600">
          {t('tene.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {atHub.map((tm) => (
            <div
              key={tm.id}
              className="flex items-center justify-between rounded-2xl bg-app-card border border-glass-border px-5 py-4 hover:border-neon-orange/20 transition-all"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{tm.name}</span>
                  {tm.code && (
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-app-raised text-zinc-400">
                      {tm.code}
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-500 mt-0.5">
                  {tm.memberNames.length > 0 ? tm.memberNames.join(' · ') : t('tene.noMembers')}
                </p>
              </div>
              <button
                onClick={() => void start(tm)}
                disabled={busyId === tm.id}
                className="text-sm px-4 py-2 rounded-xl bg-neon-orange/10 border border-neon-orange/40 text-neon-orange font-semibold hover:bg-neon-orange/20 transition-all disabled:opacity-40"
              >
                {busyId === tm.id ? '…' : t('tene.startCrafting')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

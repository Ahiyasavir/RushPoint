import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { SLOT_COUNT } from '@rushpoint/shared';
import { functions, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';

const STATUS_COLORS: Record<string, string> = {
  registered: 'bg-zinc-800 text-zinc-300 border border-zinc-700',
  active: 'bg-neon-blue/10 text-neon-blue border border-neon-blue/30',
  park: 'bg-neon-orange/10 text-neon-orange border border-neon-orange/30',
  finished: 'bg-neon-green/10 text-neon-green border border-neon-green/30',
};

interface TeamRow {
  id: string;
  name: string;
  code: string;
  status: string;
  memberNames: string[];
  startedAt: string | null;
  score: number;
  completedSlots: number;
  stageIndex: number | null;
  stageType: 'green' | 'gate' | 'orange' | 'gold' | null;
  judging: boolean;
  crafting: boolean;
  finished: boolean;
  launched: boolean;
  launchAt: string | null;
}

// A team that has registered but not yet been launched by the admin.
function isWaiting(team: TeamRow): boolean {
  return team.launched === false;
}
// A launched team whose countdown is still running.
function isLaunching(team: TeamRow): boolean {
  return team.launched && !!team.launchAt && new Date(team.launchAt).getTime() > Date.now();
}

// Map a team's live stage to a short bilingual label + accent colour.
function stageLabel(team: TeamRow, t: (k: string, v?: Record<string, string | number>) => string): { text: string; cls: string } {
  if (isWaiting(team))   return { text: t('teams.statusWaiting'),   cls: 'bg-zinc-800 text-zinc-300 border-zinc-600' };
  if (isLaunching(team)) return { text: t('teams.statusLaunching'), cls: 'bg-neon-green/10 text-neon-green border-neon-green/30' };
  if (team.finished) return { text: t('teams.stageFinished'), cls: 'bg-neon-green/10 text-neon-green border-neon-green/30' };
  if (team.judging)  return { text: t('teams.stageJudging'),  cls: 'bg-neon-blue/10 text-neon-blue border-neon-blue/30' };
  if (team.crafting) return { text: t('teams.stageCrafting'), cls: 'bg-neon-gold/10 text-neon-gold border-neon-gold/30' };
  if (team.stageType == null) return { text: '—', cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
  const accent: Record<string, string> = {
    green:  'bg-neon-green/10 text-neon-green border-neon-green/30',
    gate:   'bg-neon-blue/10 text-neon-blue border-neon-blue/30',
    orange: 'bg-neon-orange/10 text-neon-orange border-neon-orange/30',
    gold:   'bg-neon-gold/10 text-neon-gold border-neon-gold/30',
  };
  const n = (team.stageIndex ?? 0) + 1;
  return { text: t('teams.stageOf', { n, name: t(`slot.${team.stageType}`) }), cls: accent[team.stageType] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700' };
}

const listTeamsFn = httpsCallable<void, { teams: TeamRow[] }>(functions, 'listTeams');
const skipTaskFn = httpsCallable<
  { teamId: string },
  { success: boolean; allDone: boolean; awardedScore: number; newScore: number }
>(functions, 'skipTask');
const createCodeFn = httpsCallable<
  { code?: string; label?: string },
  { success: boolean; code: string; label: string | null }
>(functions, 'adminCreateCode');
const deleteTeamFn = httpsCallable<
  { teamId: string },
  { success: boolean; teamId: string; releasedCode: string | null }
>(functions, 'adminDeleteTeam');
const launchTeamsFn = httpsCallable<
  { teamIds: string[] },
  { success: boolean; count: number; launchAt: string }
>(functions, 'launchTeams');

export default function TeamsPage() {
  const { t } = useI18n();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Two-step skip: first click arms the confirm, second click executes.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [skippingId, setSkippingId] = useState<string | null>(null);

  // Create-code form + two-step delete.
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteArmId, setDeleteArmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Launch selection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [launching, setLaunching] = useState(false);

  const fetchTeams = useCallback(async () => {
    try {
      await ensureAuth();
      const result = await listTeamsFn();
      setTeams(result.data.teams);
      setLastRefreshed(new Date());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('teams.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleSkip = useCallback(async (teamId: string) => {
    setSkippingId(teamId);
    setConfirmId(null);
    setError(null);
    setNotice(null);
    try {
      await ensureAuth();
      const res = await skipTaskFn({ teamId });
      setNotice(t('teams.skipDone', { score: res.data.awardedScore }));
      await fetchTeams();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('teams.skipError'));
    } finally {
      setSkippingId(null);
    }
  }, [t, fetchTeams]);

  const handleCreateCode = useCallback(async () => {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      await ensureAuth();
      const res = await createCodeFn({
        code: newCode.trim() || undefined,
        label: newLabel.trim() || undefined,
      });
      setNotice(t('teams.codeCreated', { code: res.data.code }));
      setNewCode(''); setNewLabel(''); setShowAdd(false);
      await fetchTeams();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('teams.codeCreateError'));
    } finally {
      setCreating(false);
    }
  }, [newCode, newLabel, t, fetchTeams]);

  const handleDelete = useCallback(async (teamId: string) => {
    setDeletingId(teamId);
    setDeleteArmId(null);
    setError(null);
    setNotice(null);
    try {
      await ensureAuth();
      const res = await deleteTeamFn({ teamId });
      setNotice(t('teams.deleteDone', { code: res.data.releasedCode ?? '—' }));
      setSelected((prev) => { const n = new Set(prev); n.delete(teamId); return n; });
      await fetchTeams();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('teams.deleteError'));
    } finally {
      setDeletingId(null);
    }
  }, [t, fetchTeams]);

  const toggleSelect = useCallback((teamId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId); else next.add(teamId);
      return next;
    });
  }, []);

  const handleLaunch = useCallback(async () => {
    const teamIds = [...selected];
    if (teamIds.length === 0) return;
    setLaunching(true);
    setError(null);
    setNotice(null);
    try {
      await ensureAuth();
      const res = await launchTeamsFn({ teamIds });
      setNotice(t('teams.launchDone', { n: res.data.count }));
      setSelected(new Set());
      await fetchTeams();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('teams.launchError'));
    } finally {
      setLaunching(false);
    }
  }, [selected, t, fetchTeams]);

  useEffect(() => {
    void fetchTeams();
    const interval = setInterval(() => void fetchTeams(), 30_000);
    return () => clearInterval(interval);
  }, [fetchTeams]);

  const waitingCount = teams.filter(isWaiting).length;

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('teams.title')}</h1>
          <p className="text-zinc-500 text-sm">
            {loading ? t('common.loading') : t('teams.count', { n: teams.length })}
            {lastRefreshed && !loading && (
              <span className="ms-2 text-zinc-600">
                · {t('teams.updated', { time: lastRefreshed.toLocaleTimeString() })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              onClick={() => void handleLaunch()}
              disabled={launching}
              className="px-3 py-1.5 text-sm rounded-xl border border-neon-green/50 bg-neon-green/10 text-neon-green hover:bg-neon-green/20 disabled:opacity-40 transition-all"
            >
              {launching ? t('teams.launching') : t('teams.launchSelected', { n: selected.size })}
            </button>
          )}
          <button
            onClick={() => { setShowAdd((v) => !v); setError(null); setNotice(null); }}
            className="px-3 py-1.5 text-sm rounded-xl border border-neon-green/40 text-neon-green hover:bg-neon-green/10 transition-all backdrop-blur-sm"
          >
            {showAdd ? t('teams.addCancel') : `+ ${t('teams.createCode')}`}
          </button>
          <button
            onClick={() => { setLoading(true); void fetchTeams(); }}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-xl border border-glass-border text-zinc-300 hover:bg-white/5 hover:text-white disabled:opacity-40 transition-all backdrop-blur-sm"
          >
            {loading ? t('teams.refreshing') : t('common.refresh')}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 rounded-2xl border border-neon-green/30 bg-neon-green/5 backdrop-blur-sm">
          <p className="text-xs text-zinc-400 mb-3">{t('teams.createCodeHint')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('teams.fieldCode')}</label>
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder={t('teams.fieldCodePlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-app-surface border border-glass-border text-white text-sm font-mono focus:border-neon-green/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('teams.fieldLabel')}</label>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t('teams.fieldLabelPlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-app-surface border border-glass-border text-white text-sm focus:border-neon-green/50 outline-none"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => void handleCreateCode()}
              disabled={creating}
              className="px-4 py-2 text-sm rounded-xl bg-neon-green/10 border border-neon-green/40 text-neon-green hover:bg-neon-green/20 disabled:opacity-40 transition-all"
            >
              {creating ? t('teams.creating') : t('teams.createCodeBtn')}
            </button>
          </div>
        </div>
      )}

      {waitingCount > 0 && (
        <div className="mb-4 px-4 py-2 rounded-xl bg-neon-green/5 border border-neon-green/20 text-zinc-400 text-xs">
          {t('teams.selectHint')}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-950/50 border border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      {notice && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-neon-green/5 border border-neon-green/30 text-neon-green text-sm">
          {notice}
        </div>
      )}

      <div className="rounded-2xl border border-glass-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-app-surface text-zinc-500 text-xs uppercase tracking-widest">
            <tr>
              <th className="px-3 py-3 w-8"></th>
              <th className="text-start px-4 py-3">{t('teams.colTeam')}</th>
              <th className="text-start px-4 py-3">{t('teams.colCode')}</th>
              <th className="text-start px-4 py-3">{t('teams.colStatus')}</th>
              <th className="text-start px-4 py-3">{t('teams.colStage')}</th>
              <th className="text-end px-4 py-3">{t('teams.colSlots')}</th>
              <th className="text-end px-4 py-3">{t('teams.colScore')}</th>
              <th className="text-end px-4 py-3">{t('teams.colAction')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && teams.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-600">
                  {t('teams.loadingRow')}
                </td>
              </tr>
            ) : teams.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-600">
                  {t('teams.empty')}
                </td>
              </tr>
            ) : (
              teams.map((team) => {
                const finished = team.status === 'finished';
                const isSkipping = skippingId === team.id;
                const isConfirming = confirmId === team.id;
                const waiting = isWaiting(team);
                return (
                  <tr key={team.id} className="bg-app-card hover:bg-app-raised transition-colors border-b border-glass-border">
                    <td className="px-3 py-3 text-center">
                      {waiting && (
                        <input
                          type="checkbox"
                          checked={selected.has(team.id)}
                          onChange={() => toggleSelect(team.id)}
                          className="accent-neon-green w-4 h-4 cursor-pointer"
                          aria-label={t('teams.launch')}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{team.name}</div>
                      {team.memberNames.length > 0 && (
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {team.memberNames.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-400">{team.code}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[team.status] ?? 'bg-zinc-800 text-zinc-400'}`}>
                        {t(`status.${team.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const s = stageLabel(team, t);
                        return (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>
                            {s.text}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-end font-mono text-zinc-400">
                      {team.completedSlots}/{SLOT_COUNT}
                    </td>
                    <td className="px-4 py-3 text-end font-mono text-neon-green font-semibold tabular-nums">
                      {team.score.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="flex items-center justify-end gap-2">
                        {!finished && !waiting && (
                          <button
                            onClick={() =>
                              isConfirming ? void handleSkip(team.id) : setConfirmId(team.id)
                            }
                            onBlur={() => isConfirming && setConfirmId(null)}
                            disabled={isSkipping}
                            className={`px-3 py-1 text-xs border transition-all disabled:opacity-40 ${
                              isConfirming
                                ? 'bg-neon-orange/10 border-neon-orange/30 text-neon-orange hover:bg-neon-orange/20 rounded-lg'
                                : 'border-glass-border text-zinc-500 hover:text-white hover:bg-white/5 rounded-lg'
                            }`}
                          >
                            {isSkipping
                              ? t('teams.skipping')
                              : isConfirming
                                ? t('teams.confirmSkip')
                                : t('teams.skip')}
                          </button>
                        )}
                        <button
                          onClick={() =>
                            deleteArmId === team.id ? void handleDelete(team.id) : setDeleteArmId(team.id)
                          }
                          onBlur={() => deleteArmId === team.id && setDeleteArmId(null)}
                          disabled={deletingId === team.id}
                          className={`px-3 py-1 text-xs border rounded-lg transition-all disabled:opacity-40 ${
                            deleteArmId === team.id
                              ? 'bg-red-500/15 border-red-500/40 text-red-300 hover:bg-red-500/25'
                              : 'border-glass-border text-zinc-500 hover:text-red-300 hover:border-red-500/30'
                          }`}
                        >
                          {deletingId === team.id
                            ? t('teams.deleting')
                            : deleteArmId === team.id
                              ? t('teams.confirmDelete')
                              : t('teams.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, APP_ID, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';
import { useRole } from '../roles';
import AlertsBanner from '../components/AlertsBanner';

// ─── Types ────────────────────────────────────────────────────────────────────
interface StationTask { id: string; title: string }
interface StationTeam {
  teamId: string;
  teamName: string;
  teamCode: string;
  memberNames: string[];
  memberCount: number;
  captainPhone: string;
  slotIndex: number;
  startedAt: string | null;
}

const getStationTeams   = httpsCallable<{ taskId: string }, { taskTitle: string; teams: StationTeam[] }>(functions, 'getStationTeams');
const stationReleaseTeam = httpsCallable(functions, 'stationReleaseTeam');
const stationCallHelp    = httpsCallable(functions, 'stationCallHelp');

const STATION_TASK_KEY = 'rushpoint.admin.stationTaskId';

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Station Operator console (#7). The operator binds to one station (task), sees the
// teams currently on it with full info, deducts for missing members, decides
// pass/fail and releases them, and can summon roaming staff.
// ═══════════════════════════════════════════════════════════════════════════════
export default function StationPage() {
  const { t } = useI18n();
  const { stationId } = useRole();

  const [tasks, setTasks] = useState<StationTask[]>([]);
  const [taskId, setTaskId] = useState<string>(() => {
    try { return localStorage.getItem(STATION_TASK_KEY) ?? ''; } catch { return ''; }
  });
  const [teams, setTeams] = useState<StationTeam[]>([]);
  const [missing, setMissing] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [helpArmed, setHelpArmed] = useState(false);

  const flash = (m: string) => { setNotice(m); window.setTimeout(() => setNotice(null), 4000); };

  // Load the station (task) list once so the operator can bind to theirs.
  useEffect(() => {
    void ensureAuth().then(async () => {
      const snap = await getDocs(collection(db, `artifacts/${APP_ID}/public/data/tasks`));
      setTasks(snap.docs.map((d) => ({ id: d.id, title: (d.data() as { title?: string }).title ?? d.id }))
        .sort((a, b) => a.id.localeCompare(b.id)));
    });
  }, []);

  const loadTeams = useCallback(async () => {
    if (!taskId) { setTeams([]); return; }
    try {
      await ensureAuth();
      const res = await getStationTeams({ taskId });
      setTeams(res.data.teams ?? []);
    } catch {
      setTeams([]);
    }
  }, [taskId]);

  useEffect(() => {
    void loadTeams();
    const id = setInterval(() => void loadTeams(), 15_000);
    return () => clearInterval(id);
  }, [loadTeams]);

  function pickTask(id: string) {
    setTaskId(id);
    try { localStorage.setItem(STATION_TASK_KEY, id); } catch { /* ignore */ }
  }

  async function release(team: StationTeam, passed: boolean) {
    setBusyId(team.teamId);
    try {
      await ensureAuth();
      await stationReleaseTeam({ teamId: team.teamId, taskId, missingMembers: missing[team.teamId] ?? 0, passed });
      flash(passed ? t('station.passed', { team: team.teamName }) : t('station.failedMsg', { team: team.teamName }));
      setMissing((m) => ({ ...m, [team.teamId]: 0 }));
      await loadTeams();
    } catch {
      flash(t('station.releaseError'));
    } finally {
      setBusyId(null);
    }
  }

  async function callHelp() {
    if (!helpArmed) { setHelpArmed(true); return; }
    setHelpArmed(false);
    try {
      await ensureAuth();
      await stationCallHelp({ taskId, station: stationId ?? undefined });
      flash(t('station.helpSent'));
    } catch {
      flash(t('station.releaseError'));
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('station.title', { n: stationId ?? '—' })}</h1>
          <p className="text-zinc-500 text-sm">{t('station.subtitle')}</p>
        </div>
        <button
          onClick={() => void callHelp()}
          onBlur={() => helpArmed && setHelpArmed(false)}
          className={`shrink-0 px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
            helpArmed
              ? 'bg-neon-orange/20 border-neon-orange text-neon-orange'
              : 'border-neon-orange/40 text-neon-orange hover:bg-neon-orange/10'
          }`}
        >
          {helpArmed ? t('station.callHelpConfirm') : `🛠️ ${t('station.callHelp')}`}
        </button>
      </div>

      <AlertsBanner />

      {notice && (
        <div className="rounded-xl bg-neon-green/5 border border-neon-green/30 px-4 py-3 text-neon-green text-sm">{notice}</div>
      )}

      {/* Station (task) binding */}
      <div className="rounded-xl bg-app-card border border-glass-border p-4">
        <label className="text-xs uppercase tracking-wider text-zinc-500">{t('station.pickStation')}</label>
        <select
          value={taskId}
          onChange={(e) => pickTask(e.target.value)}
          className="mt-2 w-full px-4 py-2.5 rounded-xl bg-app-surface border border-glass-border text-white text-sm"
        >
          <option value="">{t('station.selectPlaceholder')}</option>
          {tasks.map((tk) => <option key={tk.id} value={tk.id}>{tk.title} ({tk.id})</option>)}
        </select>
      </div>

      {/* Teams currently at this station */}
      {!taskId ? (
        <p className="text-zinc-600 text-sm">{t('station.noStationPicked')}</p>
      ) : (
        <section>
          <h2 className="text-white font-semibold mb-3">{t('station.teamsHere', { n: teams.length })}</h2>
          {teams.length === 0 ? (
            <p className="text-zinc-600 text-sm">{t('station.noTeams')}</p>
          ) : (
            <div className="space-y-3">
              {teams.map((team) => {
                const miss = missing[team.teamId] ?? 0;
                const mins = minutesSince(team.startedAt);
                const busy = busyId === team.teamId;
                return (
                  <div key={team.teamId} className="rounded-2xl bg-app-card border border-glass-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white font-semibold">
                          {team.teamName}
                          {team.teamCode && <span className="ms-2 text-xs font-mono px-1.5 py-0.5 rounded bg-app-raised text-zinc-400">{team.teamCode}</span>}
                        </p>
                        <p className="text-xs text-zinc-500 mt-1">
                          👥 {team.memberCount} · {team.memberNames.join(', ')}
                        </p>
                        <div className="flex flex-wrap gap-x-4 mt-1">
                          {team.captainPhone && (
                            <a href={`tel:${team.captainPhone}`} className="text-xs text-neon-blue hover:underline font-mono">📞 {team.captainPhone}</a>
                          )}
                          {mins != null && <span className="text-xs text-zinc-500">⏱ {t('station.onTaskFor', { min: mins })}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Missing-members deduction */}
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-glass-border">
                      <span className="text-xs text-zinc-400">{t('station.missingMembers')}</span>
                      <button onClick={() => setMissing((m) => ({ ...m, [team.teamId]: Math.max(0, miss - 1) }))}
                        disabled={miss <= 0}
                        className="w-7 h-7 rounded-lg border border-glass-border text-zinc-300 hover:bg-white/5 disabled:opacity-40">−</button>
                      <span className={`w-6 text-center font-mono ${miss > 0 ? 'text-neon-red' : 'text-white'}`}>{miss}</span>
                      <button onClick={() => setMissing((m) => ({ ...m, [team.teamId]: Math.min(team.memberCount, miss + 1) }))}
                        className="w-7 h-7 rounded-lg border border-glass-border text-zinc-300 hover:bg-white/5">+</button>
                      {miss > 0 && <span className="text-xs font-mono text-neon-red ms-1">−{miss * 100}</span>}
                    </div>

                    {/* Verdict */}
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => void release(team, true)} disabled={busy}
                        className="flex-1 py-2.5 rounded-xl bg-neon-green text-black font-bold text-sm hover:opacity-90 disabled:opacity-50">
                        {busy ? t('station.releasing') : t('station.pass')}
                      </button>
                      <button onClick={() => void release(team, false)} disabled={busy}
                        className="px-4 py-2.5 rounded-xl border border-neon-red/40 text-neon-red text-sm font-semibold hover:bg-neon-red/10 disabled:opacity-50">
                        {t('station.fail')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

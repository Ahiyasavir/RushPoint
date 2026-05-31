import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';
import AlertsBanner from '../components/AlertsBanner';

// ─── Types ────────────────────────────────────────────────────────────────────
interface TeamRow {
  id: string;
  name: string;
  code: string;
  memberNames: string[];
  captainPhone: string;
  score: number;
  stageIndex: number | null;
  stageType: 'green' | 'gate' | 'orange' | 'gold' | null;
  judging: boolean;
  crafting: boolean;
  finished: boolean;
}
interface Arrival {
  checkInId: string;
  teamId: string;
  teamName: string;
  teamCode: string;
  memberNames?: string[];
  taskTitle: string;
  arrivedAt: string | null;
}

const listTeams           = httpsCallable<void, { teams: TeamRow[] }>(functions, 'listTeams');
const listPendingArrivals = httpsCallable<void, { arrivals: Arrival[] }>(functions, 'listPendingArrivals');
const checkInArrival      = httpsCallable(functions, 'checkInArrival');
const adjustTeamScore     = httpsCallable(functions, 'adjustTeamScore');

const COHESION_FINE = 100;

function stageText(team: TeamRow, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (team.finished) return t('teams.stageFinished');
  if (team.judging)  return t('teams.stageJudging');
  if (team.crafting) return t('teams.stageCrafting');
  if (team.stageType == null) return '—';
  return t('teams.stageOf', { n: (team.stageIndex ?? 0) + 1, name: t(`slot.${team.stageType}`) });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Volunteer console — roaming staff. Live alerts, the judging-queue arrival
// confirmation (freezes a team's clock), and an all-teams view with full info
// (roster + captain phone) and a one-tap cohesion fine.
// ═══════════════════════════════════════════════════════════════════════════════
export default function VolunteerPage() {
  const { t } = useI18n();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [fineArmed, setFineArmed] = useState<string | null>(null);
  const [finingId, setFiningId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Global search across team name, access code, and member names.
  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((tm) =>
      tm.name.toLowerCase().includes(q) ||
      tm.code.toLowerCase().includes(q) ||
      tm.memberNames.some((m) => m.toLowerCase().includes(q)),
    );
  }, [teams, query]);

  const flash = (msg: string, isErr = false) => {
    (isErr ? setError : setNotice)(msg);
    window.setTimeout(() => (isErr ? setError(null) : setNotice(null)), 4000);
  };

  const load = useCallback(async () => {
    try {
      await ensureAuth();
      const [teamRes, arrRes] = await Promise.all([listTeams(), listPendingArrivals()]);
      setTeams(teamRes.data.teams ?? []);
      // Queue = teams that requested judging but haven't been confirmed yet.
      setArrivals((arrRes.data.arrivals ?? []).filter((a) => !a.arrivedAt));
    } catch {
      flash(t('teams.loadError'), true);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  async function confirmArrival(a: Arrival) {
    setConfirmingId(a.checkInId);
    try {
      await ensureAuth();
      await checkInArrival({ teamId: a.teamId, checkInId: a.checkInId });
      flash(t('vol.arrivedDone', { team: a.teamName }));
      await load();
    } catch {
      flash(t('vol.confirmError'), true);
    } finally {
      setConfirmingId(null);
    }
  }

  async function fine(team: TeamRow) {
    if (fineArmed !== team.id) { setFineArmed(team.id); return; }
    setFineArmed(null);
    setFiningId(team.id);
    try {
      await ensureAuth();
      await adjustTeamScore({ teamId: team.id, kind: 'fine', delta: -COHESION_FINE, reason: 'cohesion (team not together)' });
      flash(t('vol.fineDone', { team: team.name, pts: COHESION_FINE }));
      await load();
    } catch {
      flash(t('vol.fineError'), true);
    } finally {
      setFiningId(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-8 space-y-8">
      <div>
        <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('vol.title')}</h1>
        <p className="text-zinc-500 text-sm">{t('vol.subtitle')}</p>
      </div>

      {/* Live emergency / help alerts */}
      <AlertsBanner />

      {notice && (
        <div className="rounded-xl bg-neon-green/5 border border-neon-green/30 px-4 py-3 text-neon-green text-sm">{notice}</div>
      )}
      {error && (
        <div className="rounded-xl bg-red-950/50 border border-red-500/30 px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {/* ── Judging queue: confirm arrival → freezes the team's clock (#9) ── */}
      <section>
        <h2 className="text-white font-semibold text-lg">{t('vol.queueTitle')}</h2>
        <p className="text-zinc-500 text-sm mb-4">{t('vol.queueHint')}</p>
        {arrivals.length === 0 ? (
          <p className="text-zinc-600 text-sm">{t('vol.queueEmpty')}</p>
        ) : (
          <div className="space-y-2">
            {arrivals.map((a) => (
              <div key={a.checkInId} className="flex items-center justify-between gap-3 rounded-xl bg-app-card border border-glass-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-white text-sm font-semibold">
                    {a.teamName}
                    {a.teamCode && <span className="ms-2 text-xs font-mono px-1.5 py-0.5 rounded bg-app-raised text-zinc-400">{a.teamCode}</span>}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">{a.taskTitle}</p>
                  {a.memberNames && a.memberNames.length > 0 && (
                    <p className="text-xs text-zinc-500 mt-0.5">👥 {a.memberNames.length} · {a.memberNames.join(', ')}</p>
                  )}
                </div>
                <button
                  onClick={() => void confirmArrival(a)}
                  disabled={confirmingId === a.checkInId}
                  className="shrink-0 px-4 py-2 rounded-xl bg-neon-blue/10 border border-neon-blue/30 hover:bg-neon-blue/20 disabled:opacity-50 text-neon-blue text-sm font-semibold transition-all"
                >
                  {confirmingId === a.checkInId ? t('vol.confirming') : t('vol.confirmArrival')}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── All teams: full info + cohesion fine (#11) ───────────────────── */}
      <section>
        <h2 className="text-white font-semibold text-lg">{t('vol.teamsTitle')}</h2>
        <p className="text-zinc-500 text-sm mb-4">{t('vol.teamsHint')}</p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('vol.searchPlaceholder')}
          className="mb-4 w-full px-4 py-2.5 rounded-xl bg-app-card border border-glass-border text-white text-sm placeholder:text-zinc-600 focus:border-neon-green/40 focus:outline-none"
        />
        <div className="rounded-2xl border border-glass-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-app-surface text-zinc-500 text-xs uppercase tracking-widest">
              <tr>
                <th className="text-start px-4 py-3">{t('teams.colTeam')}</th>
                <th className="text-start px-4 py-3">{t('vol.colPhone')}</th>
                <th className="text-start px-4 py-3">{t('teams.colStage')}</th>
                <th className="text-end px-4 py-3">{t('teams.colScore')}</th>
                <th className="text-end px-4 py-3">{t('teams.colAction')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && teams.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-600">{t('common.loading')}</td></tr>
              ) : filteredTeams.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-600">{query ? t('vol.searchEmpty') : t('teams.empty')}</td></tr>
              ) : (
                filteredTeams.map((team) => (
                  <tr key={team.id} className="bg-app-card hover:bg-app-raised transition-colors border-b border-glass-border">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{team.name}</div>
                      {team.memberNames.length > 0 && (
                        <div className="text-xs text-zinc-500 mt-0.5">👥 {team.memberNames.length} · {team.memberNames.join(', ')}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {team.captainPhone
                        ? <a href={`tel:${team.captainPhone}`} className="text-neon-blue hover:underline font-mono text-xs">📞 {team.captainPhone}</a>
                        : <span className="text-zinc-600 text-xs">{t('vol.noPhone')}</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">{stageText(team, t)}</td>
                    <td className="px-4 py-3 text-end font-mono text-neon-green font-semibold tabular-nums">{team.score.toLocaleString()}</td>
                    <td className="px-4 py-3 text-end">
                      <button
                        onClick={() => void fine(team)}
                        onBlur={() => fineArmed === team.id && setFineArmed(null)}
                        disabled={finingId === team.id}
                        className={`px-3 py-1 text-xs border rounded-lg transition-all disabled:opacity-40 ${
                          fineArmed === team.id
                            ? 'bg-neon-red/20 border-neon-red text-neon-red'
                            : 'border-neon-red/40 text-neon-red hover:bg-neon-red/10'
                        }`}
                      >
                        {finingId === team.id
                          ? t('vol.fining')
                          : fineArmed === team.id
                            ? t('vol.fineConfirm', { pts: COHESION_FINE })
                            : t('vol.fine', { pts: COHESION_FINE })}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

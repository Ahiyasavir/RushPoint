import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';

const STATUS_COLORS: Record<string, string> = {
  registered: 'bg-zinc-700 text-zinc-300',
  active: 'bg-blue-900 text-blue-300',
  park: 'bg-orange-900 text-orange-300',
  finished: 'bg-green-900 text-green-300',
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
}

const listTeamsFn = httpsCallable<void, { teams: TeamRow[] }>(functions, 'listTeams');

export default function TeamsPage() {
  const { t } = useI18n();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

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

  useEffect(() => {
    void fetchTeams();
    const interval = setInterval(() => void fetchTeams(), 30_000);
    return () => clearInterval(interval);
  }, [fetchTeams]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">{t('teams.title')}</h1>
          <p className="text-zinc-500 text-sm">
            {loading ? t('common.loading') : t('teams.count', { n: teams.length })}
            {lastRefreshed && !loading && (
              <span className="ms-2 text-zinc-600">
                · {t('teams.updated', { time: lastRefreshed.toLocaleTimeString() })}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); void fetchTeams(); }}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
        >
          {loading ? t('teams.refreshing') : t('common.refresh')}
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-start px-4 py-3">{t('teams.colTeam')}</th>
              <th className="text-start px-4 py-3">{t('teams.colCode')}</th>
              <th className="text-start px-4 py-3">{t('teams.colStatus')}</th>
              <th className="text-end px-4 py-3">{t('teams.colSlots')}</th>
              <th className="text-end px-4 py-3">{t('teams.colScore')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {loading && teams.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">
                  {t('teams.loadingRow')}
                </td>
              </tr>
            ) : teams.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">
                  {t('teams.empty')}
                </td>
              </tr>
            ) : (
              teams.map((team) => (
                <tr key={team.id} className="bg-zinc-950 hover:bg-zinc-900 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{team.name}</div>
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
                  <td className="px-4 py-3 text-end font-mono text-zinc-400">
                    {team.completedSlots}/8
                  </td>
                  <td className="px-4 py-3 text-end font-mono text-zinc-200 font-medium">
                    {team.score.toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

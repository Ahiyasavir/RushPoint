// @ts-nocheck
import React from 'react';
import type { Team } from '@rushpoint/shared';

const STATUS_COLORS: Record<Team['status'], string> = {
  registered: 'bg-zinc-700 text-zinc-300',
  active: 'bg-blue-900 text-blue-300',
  park: 'bg-orange-900 text-orange-300',
  finished: 'bg-green-900 text-green-300',
};

// TODO Phase 2: subscribe to Firestore /teams collection in real-time
const MOCK_TEAMS: Partial<Team>[] = [
  { id: '1', name: 'Team Alpha', code: 'ALPH1', status: 'active', score: 340, slots: [] },
  { id: '2', name: 'Team Beta', code: 'BETA2', status: 'park', score: 510, slots: [] },
  { id: '3', name: 'Team Gamma', code: 'GAMM3', status: 'registered', score: 0, slots: [] },
];

export default function TeamsPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-2">Teams</h1>
      <p className="text-zinc-500 text-sm mb-6">{MOCK_TEAMS.length} teams registered</p>

      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Team</th>
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {MOCK_TEAMS.map((team) => (
              <tr key={team.id} className="bg-zinc-950 hover:bg-zinc-900 transition-colors">
                <td className="px-4 py-3 font-medium text-white">{team.name}</td>
                <td className="px-4 py-3 font-mono text-zinc-400">{team.code}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[team.status!]}`}>
                    {team.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-200">{team.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

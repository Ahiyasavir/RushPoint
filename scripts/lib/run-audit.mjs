// Shared end-of-run integrity audit (change: browser-fidelity-simulation).
//
// Extracted verbatim from scripts/simulate-run.mjs so both the callable load sim
// (`npm run simulate`) and the browser-level sim (`npm run simulate:browser`) run
// the SAME oracle — the two can never drift on what "consistent" means.
//
// Checks, against an injectable `audit(label, cond, detail)` sink:
//   • per-team score conservation (Σ task earnedScore == team.score)
//   • leaderboard oracle on refreshLeaderboard AND finalizeRun
//       (one entry per team, contiguous ranks from 1, finite non-increasing scores)
//   • live/final ordering parity (buildRankings can't drift)
//   • every run.taskCounts counter back to 0 (no leaked station slots), none negative
//
// The caller supplies already-collected team `states` (each the getMyTeamState
// payload) plus an ops party that can call refreshLeaderboard/finalizeRun and read
// the run doc. Returns the { live, fin } leaderboards for any further assertions.
export async function auditRun({ creator, ownerUid, gameId, runId, states, audit }) {
  const teamCount = states.length;

  // Score conservation per team.
  const broken = states.filter((st) => {
    const tasks = (st?.team?.stages ?? []).flatMap((s) => s.tasks ?? []);
    return tasks.reduce((a, t) => a + (t.earnedScore ?? 0), 0) !== st?.team?.score;
  });
  audit('score conservation holds for every team', broken.length === 0,
    broken.map((st) => st?.team?.displayName).join(',') || `${teamCount} teams checked`);

  const teamIds = states.map((s) => s?.team?.id);

  const oracle = (label, rankings) => {
    const ids = (rankings ?? []).map((r) => r.teamId);
    audit(`${label}: one entry per team`, ids.length === teamCount && new Set(ids).size === teamCount && teamIds.every((id) => ids.includes(id)), `${ids.length} entries`);
    audit(`${label}: contiguous ranks from 1`, (rankings ?? []).every((r, i) => r.rank === i + 1));
    audit(`${label}: finite scores`, (rankings ?? []).every((r) => Number.isFinite(r.score)));
    audit(`${label}: non-increasing scores`, (rankings ?? []).every((r, i) => i === 0 || rankings[i - 1].score >= r.score));
  };

  const live = await creator.call('refreshLeaderboard', { gameId, runId, publish: false });
  oracle('live board', live?.rankings);
  const fin = await creator.call('finalizeRun', { gameId, runId });
  oracle('final board', fin?.rankings);
  audit('live/final ordering parity (no drift)',
    JSON.stringify((live?.rankings ?? []).map((r) => r.teamId)) === JSON.stringify((fin?.rankings ?? []).map((r) => r.teamId)));

  // Station slots: every assignment was released → all counters back to 0.
  const runDoc = await creator.getDocAt(`users/${ownerUid}/games/${gameId}/runs/${runId}`);
  const counts = runDoc.data?.taskCounts ?? {};
  const leaked = Object.entries(counts).filter(([, v]) => v !== 0);
  audit('no leaked station slots (all taskCounts back to 0)', leaked.length === 0, JSON.stringify(counts));
  const negative = Object.entries(counts).filter(([, v]) => v < 0);
  audit('no negative station counters', negative.length === 0, JSON.stringify(negative));

  return { live, fin };
}

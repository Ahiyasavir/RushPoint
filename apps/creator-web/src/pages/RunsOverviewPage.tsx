import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LiveRunSummary } from '@rushpoint/shared';
import { listLiveRuns } from '../services/calls';
import { Button, Card, Spinner } from '../components/ui';
import { useT } from '../components/LanguageContext';

// Multi-run GM overview (change: multi-run-gm-panel): every LIVE run across all of
// the owner's games in one place, with a participant count + unacknowledged-alert
// badge. Each card deep-links into the existing per-run console — no duplicated
// controls. Polls every 10s so a fresh SOS surfaces without a manual refresh.
export default function RunsOverviewPage() {
  const nav = useNavigate();
  const t = useT();
  const r = t.liveRuns;
  const [runs, setRuns] = useState<LiveRunSummary[] | null>(null);
  const [errored, setErrored] = useState(false);

  // Empty deps: a single poll loop that survives language switches without churning
  // the interval. The error LABEL is read at render time so it's always in-language.
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await listLiveRuns({});
        if (alive) { setRuns(res.runs); setErrored(false); }
      } catch {
        if (alive) setErrored(true);
      }
    }
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (runs === null && !errored) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-zinc-100 mb-1">{r.title}</h1>
      <p className="text-sm text-zinc-500 mb-5">{r.subtitle}</p>

      {errored && <p className="text-neon-red text-sm mb-4">{r.loadError}</p>}

      {runs && runs.length === 0 ? (
        <Card className="p-8 text-center text-zinc-500">{r.empty}</Card>
      ) : (
        <div className="space-y-3">
          {(runs ?? []).map((run) => (
            <Card key={run.runId} className="p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-zinc-100 truncate" dir="auto">
                  {run.gameTitle || r.untitled}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-3 flex-wrap">
                  <span>{r.code}: <span className="font-mono text-zinc-300">{run.accessCode}</span></span>
                  <span>👥 {r.participants({ n: run.participantCount })}</span>
                  {run.unackedAlerts > 0 && (
                    <span className="inline-flex items-center rounded-full bg-neon-red/15 border border-neon-red/40 text-neon-red px-2 py-0.5 font-bold">
                      🆘 {r.alerts({ n: run.unackedAlerts })}
                    </span>
                  )}
                </div>
              </div>
              <Button onClick={() => nav(`/run/${run.gameId}/${run.runId}`)} className="shrink-0">
                {r.open}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

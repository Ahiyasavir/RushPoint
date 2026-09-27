import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Skeleton } from '../components/ui';
import { LoadingState } from '../components/LoadingState';
import { toast } from '../components/toast';
import { useT } from '../components/LanguageContext';
import { useLiveRuns } from '../hooks/useLiveRuns';

// Multi-run GM overview (change: multi-run-gm-panel): every LIVE run across all of
// the owner's games in one place, with a participant count + unacknowledged-alert
// badge. Each card deep-links into the existing per-run console — no duplicated
// controls. Data comes from the app-wide shared 10s poll (hooks/useLiveRuns) that
// also backs the floating ActiveRunBar — one timer, one callable per tick, even
// though both are mounted here — so a fresh SOS surfaces without a manual refresh.
export default function RunsOverviewPage() {
  const nav = useNavigate();
  const t = useT();
  const r = t.liveRuns;
  const { runs, errored, refresh: load } = useLiveRuns();

  async function copyCode(code: string) {
    try { await navigator.clipboard.writeText(code); toast.success(r.copied); }
    catch { /* clipboard unavailable — no-op */ }
  }

  if (runs === null && !errored) {
    return (
      <div className="max-w-3xl mx-auto">
        <Skeleton className="h-8 w-40 mb-2" />
        <Skeleton className="h-4 w-72 mb-5" />
        <LoadingState messages={r.loading} className="!py-6" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="font-brand text-2xl font-extrabold tracking-tight text-[--ink-1] mb-1">{r.title}</h1>
      <p className="text-sm text-[--ink-3] mb-5">{r.subtitle}</p>

      {errored && (
        <div className="flex items-center gap-3 mb-4">
          <p className="text-ink-alert text-sm">{r.loadError}</p>
          <Button variant="ghost" onClick={() => void load()}>{r.retry}</Button>
        </div>
      )}

      {runs && runs.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon="🏁"
            title={r.emptyTitle}
            body={r.empty}
            action={<Button onClick={() => nav('/')}>{r.emptyCta}</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {(runs ?? []).map((run) => (
            <Card key={run.runId} className="p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[--ink-1] truncate" dir="auto">
                  {run.gameTitle || r.untitled}
                </div>
                <div className="text-xs text-[--ink-3] mt-0.5 flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center gap-1">{r.code}:
                    <button
                      type="button"
                      onClick={() => void copyCode(run.accessCode)}
                      aria-label={r.copyCode}
                      title={r.copyCode}
                      className="inline-flex items-center gap-1 font-mono text-[--ink-2] hover:text-ink-fire rounded px-1 -mx-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
                    >
                      {run.accessCode}<span aria-hidden="true" className="text-[12px] opacity-70">📋</span>
                    </button>
                  </span>
                  <span>👥 {r.participants({ n: run.participantCount })}</span>
                  {run.unackedAlerts > 0 && (
                    <span className="inline-flex items-center rounded-full bg-rp-alert/15 border border-rp-alert/40 text-ink-alert px-2 py-0.5 font-bold">
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

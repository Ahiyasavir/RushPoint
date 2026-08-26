import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Skeleton } from '../components/ui';
import { LoadingState } from '../components/LoadingState';
import { useT } from '../components/LanguageContext';
import { listMyRuns, type MyRunRow } from '../services/calls';

// Run history (change: post-run-player-report).
//
// WHY THIS PAGE EXISTS. Every post-run surface this product had resolved a run by
// ACCESS CODE, and the only screen holding one was the live console — reachable
// from `listLiveRuns`, which filters `status == 'live'`. So the moment a run
// ended it fell off every navigation path in the app: the data was all still
// there, and there was no door to it. Meanwhile the dashboard's 🏁 tile counted
// those runs and did nothing when you clicked it.
//
// This is that door. `listMyRuns` returns runs regardless of status, addressed by
// {gameId, runId} rather than by a code the creator stopped holding weeks ago.
//
// ONE surface serves both entry points: `?game=<id>` narrows it to one game (from
// a game card or the Builder), no query param shows everything (from the tile).
// Shipping a per-game page AND an all-games page would be two things to keep in
// step for no gain.
export default function RunHistoryPage() {
  const nav = useNavigate();
  const t = useT();
  const r = t.runHistory;
  const [params] = useSearchParams();
  const gameId = params.get('game') ?? undefined;

  const [runs, setRuns] = useState<MyRunRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async () => {
    setErrored(false);
    try {
      const res = await listMyRuns(gameId ? { gameId } : {});
      setRuns(res.runs ?? []);
      setTruncated(!!res.truncated);
    } catch {
      // Fail visibly with a retry rather than to an empty state: "you have no
      // runs" and "we could not reach the server" are opposite messages, and a
      // creator shown the wrong one goes looking for data they think they lost.
      setErrored(true);
      setRuns([]);
    }
  }, [gameId]);

  useEffect(() => { void load(); }, [load]);

  // A live run belongs in the console (it needs live ops); a finished one belongs
  // in the report. Deciding it here keeps the row's primary action honest instead
  // of dumping every run into one destination that is wrong half the time.
  const isLive = (run: MyRunRow) => run.status === 'live';

  const gameTitle = useMemo(
    () => runs?.find((run) => run.gameId === gameId)?.gameTitle ?? '',
    [runs, gameId],
  );

  if (runs === null && !errored) {
    return (
      <div className="max-w-3xl mx-auto">
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-80 mb-5" />
        <LoadingState messages={r.loading} className="!py-6" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="font-brand text-2xl font-extrabold tracking-tight text-[--ink-1] mb-1" dir="auto">
        {gameId && gameTitle ? r.titleForGame(gameTitle) : r.title}
      </h1>
      <p className="text-sm text-[--ink-3] mb-4">{r.subtitle}</p>

      {gameId && (
        <button
          type="button"
          onClick={() => nav('/history')}
          className="text-xs text-[--ink-3] hover:text-rp-fire mb-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
        >
          ← {r.backToAll}
        </button>
      )}

      {errored && (
        <div className="flex items-center gap-3 mb-4">
          <p className="text-rp-alert text-sm">{r.loadError}</p>
          <Button variant="ghost" onClick={() => void load()}>{r.retry}</Button>
        </div>
      )}

      {runs && runs.length === 0 && !errored ? (
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
            <Card key={`${run.gameId}/${run.runId}`} className="p-4 flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[--ink-1] truncate" dir="auto">
                    {run.gameTitle || r.untitled}
                  </span>
                  {isLive(run) && <Badge color="green">{r.statusLive}</Badge>}
                  {run.status === 'finished' && <Badge color="zinc">{r.statusFinished}</Badge>}
                  {run.status === 'draft' && <Badge color="zinc">{r.statusDraft}</Badge>}
                  {run.isTestDrive && <Badge color="purple">{r.testDrive}</Badge>}
                </div>
                <div className="text-xs text-[--ink-3] mt-1 flex items-center gap-3 flex-wrap">
                  <span>{formatWhen(run)}</span>
                  <span>👥 {r.participants({ n: run.participantCount })}</span>
                  {run.accessCode && <span className="font-mono text-[--ink-2]">{run.accessCode}</span>}
                  {run.topTeamName && (
                    <span className="truncate max-w-[16rem]" dir="auto">🏅 {r.winner(run.topTeamName)}</span>
                  )}
                </div>
              </div>
              <Button
                onClick={() => nav(isLive(run)
                  ? `/run/${run.gameId}/${run.runId}`
                  : `/report/${run.gameId}/${run.runId}`)}
                className="shrink-0"
              >
                {isLive(run) ? r.openConsole : r.openReport}
              </Button>
            </Card>
          ))}
          {truncated && (
            <p className="text-xs text-[--ink-3] text-center pt-1">
              {r.truncated({ n: (runs ?? []).length })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The date a creator would recognise this run by.
 *
 * Falls through launched → created → finished rather than insisting on one field:
 * a draft never launched and an abandoned run never finished, and a row showing no
 * date at all is exactly the row someone is scrolling to find. Locale-formatted
 * through the browser, so no date copy lives in the dictionaries.
 */
function formatWhen(run: MyRunRow): string {
  const iso = run.launchedAt ?? run.createdAt ?? run.finishedAt;
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthGate';
import { useT } from './LanguageContext';
import { Button } from './ui';
import { dialog } from './dialog';
import { toast } from './toast';
import { finalizeRun } from '../services/calls';
import { useLiveRuns } from '../hooks/useLiveRuns';
import { barMode, runConsolePath, selectFeaturedRun, shouldShowBar } from '../hooks/liveRunsPolling';
import { useIsMobile } from '../hooks/useMediaQuery';

// Persistent floating control bar for a creator's live run (docs/wave-a/active-run-bar.md).
// Mounted app-wide as a sibling of DialogHost/ToastHost so it survives route changes:
// wherever the creator wanders, the run they launched is one tap away — plus a
// guarded "End run" (the SAME verb the console uses — one action, one name). It
// hides on ANY run console and on /live (those surfaces already own the
// controls, and the bar features one run, so on another run's console its
// "End run" would end the wrong event) and collapses to a pill in the Builder,
// whose h-screen 3-pane workspace runs to the viewport edge.
export default function ActiveRunBar() {
  const { user } = useAuth();
  const t = useT();
  const r = t.liveRuns;
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { runs, refresh } = useLiveRuns();
  const [ending, setEnding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();

  const featured = selectFeaturedRun(runs);
  const mode = barMode(pathname);

  // Leaving the Builder resets the collapsed pill back to its default state.
  useEffect(() => { if (mode === 'full') setExpanded(false); }, [mode]);

  if (!featured || !shouldShowBar({ authed: !!user, featured, pathname })) return null;
  const run = featured;
  const extra = (runs?.length ?? 1) - 1;
  const title = run.gameTitle || r.untitled;

  async function onEnd() {
    if (ending) return;
    const ok = await dialog.confirm(r.endConfirm({ title }), r.endConfirmLabel, true);
    if (!ok) return;
    setEnding(true);
    try {
      // finalizeRun is slow (and being made non-blocking elsewhere) — the button
      // stays busy until it settles, then the shared poll list is refreshed so the
      // bar disappears immediately instead of after the next 10s tick.
      await finalizeRun({ gameId: run.gameId, runId: run.runId });
      toast.success(r.ended);
      await refresh();
    } catch {
      toast.error(r.endFailed);
    } finally {
      setEnding(false);
    }
  }

  // ── Collapsed pill (Builder) ──
  // Not rendered at phone width (change: builder-mobile-simplification). It is a
  // `fixed z-30` element, but the Builder lives inside `<main class="relative
  // z-10">`, so its own sheets — which declare z-40 — can never paint above this
  // pill however high they set it: the whole subtree competes at z-10. On a phone
  // the Builder's bottom edge is now the tab bar, the add-mission tiles and the
  // mission sheet, and the pill landed on all three. Hiding it here costs a
  // creator nothing they cannot see elsewhere: on every OTHER route the phone
  // still gets the full bar (`mode === 'full'`), so they are told about a live run
  // the moment they leave the editor, and the run console is a tap away from the
  // dashboard. Desktop is unchanged — there the pill sits in an empty corner.
  if (mode === 'compact' && isMobile) return null;
  if (mode === 'compact' && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={r.expandBar}
        title={r.expandBar}
        className="fixed z-30 bottom-20 sm:bottom-4 start-4 inline-flex items-center gap-2 rounded-full border border-rp-alert/40 bg-[--surface-1]/95 dark:bg-[--surface-0]/95 backdrop-blur-xl ps-3 pe-4 py-2 text-xs font-semibold text-[--ink-1] shadow-lg transition-colors hover:border-rp-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
      >
        <span aria-hidden="true" className="w-2 h-2 rounded-full bg-rp-alert animate-pulse shrink-0" />
        <span className="max-w-[150px] truncate" dir="auto">{title}</span>
      </button>
    );
  }

  // ── Full bar ──
  return (
    <div
      role="region"
      aria-label={r.barLabel}
      className="fixed z-30 bottom-20 sm:bottom-4 start-4 end-4 sm:end-auto flex items-center gap-3 rounded-2xl border border-rp-alert/40 bg-[--surface-1]/95 dark:bg-[--surface-0]/95 backdrop-blur-xl px-4 py-2.5 shadow-2xl max-w-[calc(100vw-2rem)] sm:max-w-md"
    >
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-rp-alert animate-pulse shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] uppercase tracking-wide text-ink-alert font-bold">{r.barBadge}</div>
        <div className="text-sm font-semibold text-[--ink-1] truncate" dir="auto">{title}</div>
        {extra > 0 && (
          <button
            type="button"
            onClick={() => nav('/live')}
            className="text-[13px] text-[--ink-3] hover:text-ink-fire transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
          >
            {r.moreRuns({ n: extra })}
          </button>
        )}
      </div>

      <Button onClick={() => nav(runConsolePath(run))} className="shrink-0">
        {r.reenter}
      </Button>
      <Button variant="danger" loading={ending} onClick={() => void onEnd()} className="shrink-0">
        {ending ? r.ending : r.endRun}
      </Button>

      {mode === 'compact' && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label={r.collapseBar}
          title={r.collapseBar}
          className="shrink-0 w-8 h-8 rounded-lg text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}

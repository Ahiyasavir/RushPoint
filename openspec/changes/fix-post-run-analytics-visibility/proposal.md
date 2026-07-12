# Proposal: fix-post-run-analytics-visibility

## Why

Playtest feedback: "the game-analytics area doesn't work after I finished the game." Investigation of
the run log shows `getRunAnalytics` was **never invoked** during the run, while `getRunHeatmap` and
`getRunFeedbackSummary` behaved similarly opaque. The three post-run panels in
`apps/creator-web/src/pages/RunConsolePage.tsx` share two flaws:

1. **Silent failure.** `AnalyticsPanel.load()` and `HeatmapPanel.load()` are `try { … } finally {}`
   with **no `catch`** — a failed callable leaves the panel blank with no message. `FeedbackPanel`
   auto-loads but `.catch(() => undefined)` — same silent blank. So if a load fails (or the creator's
   session hiccups), the panel looks broken/empty with zero feedback.
2. **Analytics never loads itself.** `AnalyticsPanel` renders a "Load analytics" button and only
   fetches on click; a creator who expects to just see numbers after the run sees an empty card.

## What Changes

- `AnalyticsPanel` **auto-loads on mount** (like `FeedbackPanel`) so the data appears without a manual
  click; the manual "load" becomes a retry after an error.
- All three panels **surface load errors** with a visible message + retry, instead of failing
  silently. (`HeatmapPanel` keeps its manual first load — the GPS track can be heavy — but shows an
  error on failure.)
- Add one i18n key `runConsole.analyticsError` (EN/HE) for the panel error text.

## Non-goals

- No change to the `getRunAnalytics`/`getRunHeatmap`/`getRunFeedbackSummary` callables or their data
  (`computeRunAnalytics` is already finite-safe; the non-finite backstop is a separate change).
- Analytics stays gated on a finalized run (`run.status === 'finished'`) — a post-run concept.
- No change to CSV export or the heatmap rendering.

## Capabilities

### New Capabilities
- `post-run-insights-visibility`: the post-run analytics/heatmap/feedback panels load their data
  automatically (analytics/feedback) and show a clear, retryable error on failure rather than a silent
  blank.

## Impact

- **Surfaces touched:** creator-web (`RunConsolePage.tsx` three panels; `i18n.ts` one key). No server
  or shared change.
- **Tests:** UI verified via the preview tools (finish a run → analytics auto-loads; a forced load
  failure shows an error + retry). `npm run i18n:check` for the new key.

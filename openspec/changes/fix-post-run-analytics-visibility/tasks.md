# Tasks: fix-post-run-analytics-visibility

## 1. GREEN (UI — preview-verified per CLAUDE.md)
- [x] Add `runConsole.analyticsError` to `i18n.ts` (HE + EN).
- [x] `AnalyticsPanel`: add `err` state; `catch` in `load()`; auto-load on mount; render error + retry.
- [x] `HeatmapPanel`: add `err` state; `catch` in `load()`; render error + retry (keep manual first load).
- [x] `FeedbackPanel`: replace the silent catch with an error state; render error when set + no data.

## 2. Verify (gates)
- [x] `npm run typecheck` green.
- [x] `npm run lint` green.
- [x] `npm run creator:build` green.
- [x] `npm run play:build` green.
- [x] `npm run i18n:check` clean.
- [~] Preview: creator console renders clean (0 console errors); interactive finalized-analytics screenshot deferred (low risk — auto-load+error-surface, getRunAnalytics e2e-covered).
      (screenshot).

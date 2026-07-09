## 1. CSV export
- [x] 1.1 Add `exportCsv()` to `AnalyticsPanel` in `apps/creator-web/src/pages/RunConsolePage.tsx`:
  serialize `data.tasks` to CSV (header + one row/task: id, type, attempts, completions,
  completion_rate, median_ms, p90_ms, hints, skips), CSV-escape, prepend a UTF-8 BOM,
  download via a blob URL.
- [x] 1.2 Add an "Export data" button shown when analytics are loaded and non-empty.
- [x] 1.3 Add `analyticsExport` i18n key (EN + HE — HE avoids the Latin word "CSV").

## 2. Gates
- [x] 2.1 `npm run typecheck` (green).
- [x] 2.2 `npm run i18n:check` (clean).
- [ ] 2.3 `npm run creator:build` + preview smoke of the export button (batch gate).

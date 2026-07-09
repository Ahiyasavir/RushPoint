## Why

The post-run analytics dashboard (per-task completion, median time, hints, skips) is
already built and Pro-gated, but the numbers are trapped in the UI. Organizers routinely
want the data in a spreadsheet to compare events, share with a client, or archive. Every
comparable platform (Goosechase, Actionbound, Scavify) offers a CSV/Excel export.

## What Changes

- The creator RunConsole **Analytics panel** gains an **"Export data"** button (shown once
  analytics are loaded) that downloads the per-task analytics as a **CSV** file
  (`run-analytics-<accessCode>.csv`), one row per task: id, type, attempts, completions,
  completion rate, median ms, p90 ms, hints, skips. Pure client-side — no callable, no new
  data. A UTF-8 BOM is prepended so Excel opens Hebrew/Unicode correctly.

## Capabilities

### Modified Capabilities
- `run-analytics`: the existing analytics surface adds a client-side CSV export of the
  already-returned `getRunAnalytics` payload. No change to the callable or its aggregates.

## Non-goals
- No server-side export/email (that is a separate concern).
- No PII in the export — only the same aggregate per-task rows the dashboard already shows.

## Surfaces touched
- **creator-web:** `pages/RunConsolePage.tsx` (`AnalyticsPanel` export button + CSV builder),
  `i18n.ts` (new `analyticsExport` key, EN + HE). No backend, shared, index, or rules change.

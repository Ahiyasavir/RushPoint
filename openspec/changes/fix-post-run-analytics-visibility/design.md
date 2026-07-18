# Design: fix-post-run-analytics-visibility

## Files touched

- `apps/creator-web/src/pages/RunConsolePage.tsx`:
  - **`AnalyticsPanel`**: add `const [err, setErr] = useState('')`; `load()` becomes
    `try { setErr(''); setData(await getRunAnalytics({ code: accessCode })); } catch { setErr(t.runConsole.analyticsError); } finally { setBusy(false); }`.
    Add `useEffect(() => { void load(); }, [accessCode])` to auto-load on mount. Render the error (with
    a retry button) when `err && !data`.
  - **`HeatmapPanel`**: same `err` state + `catch` in `load()`; keep the manual first load, but render
    the error + retry on failure.
  - **`FeedbackPanel`**: replace `.catch(() => undefined)` with `.catch(() => { if (alive) setErr(t.runConsole.analyticsError); })`;
    render the error when set and no data.
- `apps/creator-web/src/i18n.ts`: add `runConsole.analyticsError` (HE: "טעינת הנתונים נכשלה. נסו שוב.",
  EN: "Couldn't load the data. Try again.").

## Behavior

- Analytics/feedback fetch on mount; the creator sees numbers (or a clear error) without clicking.
- A transient/failed load shows a retryable error instead of a permanently-blank card — the panel can
  never again look "broken" with no explanation.
- Heatmap stays opt-in (heavy GPS track) but now reports failures.

## Test strategy

- **UI (preview tools):** launch → join → play → `finalizeRun`; open the finished console; confirm the
  Analytics panel auto-loads a table (or "No data yet." when empty) and the Feedback panel shows
  responses; simulate a failed load (e.g. offline) and confirm the error + retry render instead of a
  blank card. Screenshot as proof.
- **i18n:** `npm run i18n:check` clean (new key real HE/EN, routed through `t.runConsole.*`).

Per project convention (CLAUDE.md), UI is verified via the preview tools, not a component test runner.

## Gates

`npm run typecheck` · `npm run lint` · `npm run creator:build` · `npm run play:build` ·
`npm run i18n:check` · (`npm test` unaffected).

# Tasks — run-console-run-not-found

## RED

- [x] 1. Add the i18n wiring guard: extend an existing creator-web i18n check (or a small
      `scripts/test-*.ts` source scan) to assert `i18n.ts` defines `runNotFound` and `backToRuns` in
      BOTH the HE and EN `runConsole` maps. Confirm it fails before the strings exist (RED), record
      output. (If preferred, this is covered by `npm run i18n:check` PART A parity once the strings are
      added; note the RED expectation either way.)

## GREEN

- [x] 2. Add the HE + EN `runNotFound` and `backToRuns` strings under `runConsole` in
      `apps/creator-web/src/i18n.ts` (re-read immediately before editing, the file is contended;
      additive only). HE stays Hebrew, EN stays English; no em-dash, no en-dash, no spaced hyphen.
- [x] 3. In `apps/creator-web/src/pages/RunConsolePage.tsx`, add `runNotFound` and `runLoadErr` state
      next to `run` (`:108`), and import `useNavigate` from `react-router-dom` (the file already
      imports `useParams` from it); add `const nav = useNavigate();` in the component body.
- [x] 4. Update ONLY the run-doc listener at `:136`: keep the `snap.exists()` → `setRun(...)` path
      (also clearing both flags), add an `else` that sets `runNotFound` (fires only on a real
      snapshot, never before the first snapshot), and add an `onError` that logs and sets `runLoadErr`.
      Do NOT touch the alerts effect (`:146+`) or the teams poll — those belong to
      `run-console-live-stream-resilience`.
- [x] 5. Replace the `:514` guard: when `!run` and (`runNotFound || runLoadErr`), render the ⚠️
      `Card` + `Button` (`t.runConsole.runNotFound`, button `t.runConsole.backToRuns` →
      `nav('/live')`), mirroring `WalletPage.tsx:85-96`; otherwise keep the existing
      `<Spinner label={t.runConsole.loadingRun} />`.

## REFACTOR / VERIFY

- [x] 6. `npx tsx scripts/check-i18n.ts --strict` clean, zero new PART B findings.
- [x] 7. Preview check (creator-web): a bogus `runId` renders the not-found card with a working
      "back to runs" button (lands on `/live`); a valid run loads the live console unchanged; the
      stream-resilience stale line + pinned alerts-interrupted notice still render on a live run
      (confirming no regression to that change).
- [x] 8. Hand the gate set to the parent (`npm run typecheck`, `npm run lint`, `npm test`,
      `npm run creator:build`, `npm run play:build`, `npm run i18n:check:strict`). No callable added or
      changed and no `Task` field touched, so no e2e is owed. This lane must not run the
      shared-`dist`-rewriting gates concurrently with another live lane.

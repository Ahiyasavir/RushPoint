# Tasks — Ceremony / TV projector error state

> UI lane (play-web has no component test runner). Verify via the preview tools; the
> dictionary additions and flag wiring are covered by the pure gates below.

## 1. i18n copy

- [x] 1.1 Add `tv.loadError` and `ceremony.loadError` to BOTH the HE and EN dictionaries in
  `apps/play-web/src/i18n.ts` (`tv` block ~562/1127, `ceremony` block ~567/1132). HE really
  Hebrew, EN really English, no em-dash, projector-legible short line.

## 2. TvLeaderboard error flag

- [x] 2.1 Add a `loadError` boolean state to `apps/play-web/src/screens/TvLeaderboard.tsx`.
  In the poll `catch` (`~36-38`) set it true (keep the existing `setData(null)`); clear it
  right after a successful `setData(next)` (`~35`). Do NOT touch `REFRESH_MS` or the
  `setInterval` — the loop must keep polling.
- [x] 2.2 In the holding render (`~67-72`), show `t.tv.loadError` when `loadError` is true,
  else the existing `t.tv.notAvailable`. Leave the initial `data === undefined` spinner and
  the published happy path unchanged.

## 3. CeremonyScreen error flag

- [x] 3.1 Add a `loadError` boolean state to `apps/play-web/src/screens/CeremonyScreen.tsx`.
  In the poll `catch` (`~54-58`) set it true (keep the existing `setData(null)` and the
  `setTimeout` reschedule); clear it right after a successful `setData(next)` (`~52`). Do NOT
  touch `POLL_MS` or the reschedule — the loop must keep polling.
- [x] 3.2 In the holding render (`~106-111`), show `t.ceremony.loadError` when `loadError` is
  true, else the existing `t.ceremony.ceremonyWaiting`. Leave the published ceremony sequence
  unchanged.

## 4. Gates

- [ ] 4.1 `npm run i18n:check:strict` clean (HE/EN correctness, zero new PART B).
- [ ] 4.2 `npm run typecheck` · `npm run play:build` green.
- [ ] 4.3 Preview check: open TV and Ceremony with a wrong code → distinct error line shows
  and the poll keeps retrying; then a valid, later-published run still comes alive.

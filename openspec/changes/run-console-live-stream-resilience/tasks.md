# Tasks — run-console-live-stream-resilience

## RED

- [x] 1. Write `scripts/test-run-console-freshness.ts` against the not-yet-existing
      `apps/creator-web/src/lib/streamFreshness.ts`: `isTeamsStale` is `false` within tolerance,
      `true` once aged past `TEAMS_STALE_AFTER_MS`, `true` whenever `hadError` is set, `false` for a
      null `lastSyncAt` with no error, and `false` (no throw) for non-finite `now`/`lastSyncAt`;
      `secondsSinceSync` returns `null` for null, floors the whole-second age, clamps a negative delta
      to `0`, and never throws on garbage. Run it, confirm it fails on the missing module, record
      output.
- [x] 2. Add the wiring guard to the same suite (source scan): `i18n.ts` defines `teamsReconnecting`,
      `lastUpdatedAgo` and `alertsStreamInterrupted` in BOTH language maps. RED.

## GREEN

- [x] 3. Create `apps/creator-web/src/lib/streamFreshness.ts`: `TEAMS_POLL_INTERVAL_MS`,
      `TEAMS_STALE_AFTER_MS`, `isTeamsStale`, `secondsSinceSync`. Pure, total, no React. Re-run the
      suite to green on the pure half.
- [x] 4. Add the HE + EN `teamsReconnecting`, `lastUpdatedAgo` and `alertsStreamInterrupted` strings
      to `apps/creator-web/src/i18n.ts` under `runConsole` (additive only; re-read immediately before
      editing, the file is contended). No em dash, no en dash, no spaced hyphen; HE stays Hebrew, EN
      stays English.
- [x] 5. Finding 1 — teams poll: in `RunConsolePage.tsx` add `teamsStale` + `lastTeamsSyncAt` state,
      wrap `loadTeams` (`:159-163`) in try/catch (set both on success, set `teamsStale` and DO NOT
      call `setTeams` on failure so the last-known board stays), and render an unobtrusive
      `role="status"` line on the teams panel header when `isTeamsStale(lastTeamsSyncAt, Date.now(),
      teamsStale)` (`teamsReconnecting`, plus `lastUpdatedAgo({ seconds })` when `secondsSinceSync`
      is non-null). Do not change the 5s cadence or the `teams` data shape.
- [x] 6. Finding 2 — alerts stream: add `alertsStreamError` state, clear it at the top of the alerts
      effect and inside the good snapshot, set it (with a `console.warn`) in place of the
      `() => undefined` handler at `:144`, and render a one-line `role="status"`
      `alertsStreamInterrupted` notice in the PINNED zone (visible even at zero active alerts). No new
      `PanelId`, no rail-section change.
- [x] 7. Finding 3 — audio: add a one-time `pointerdown` + `keydown` window listener effect that calls
      `unlockAudio()` once then detaches; leave the existing `unlockAudio()` calls in `startAll`/
      `invite`. No `sound.ts` edit, no i18n. (Re-read `apps/creator-web/src/lib/sound.ts` first to
      confirm `unlockAudio` is still exported and idempotent.)
- [x] 8. Re-run `npx tsx scripts/test-run-console-freshness.ts` and confirm ALL PASS.

## REFACTOR / VERIFY

- [x] 9. `npx tsx scripts/check-i18n.ts --strict` clean, zero new PART B findings.
- [x] 10. Preview check (creator-web): the teams panel shows the reconnecting / updated-N-s-ago line on
      a poll failure with last-known rows still visible; a dead alerts stream shows the pinned
      interrupted notice at zero alerts; opening an already-live run, clicking once anywhere, then
      raising an SOS plays the audible cue.
- [x] 11. Hand the full gate set to the parent (`npm run typecheck`, `npm run lint`, `npm test`,
      `npm run creator:build`, `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`). This lane must not run them: they rewrite `packages/shared/dist`
      in place and other agents are live on this tree.
- [x] 12. Confirm no e2e owed: no callable added or changed, no `Task` field, `ALLOWED_TASK_KEYS`
      untouched.

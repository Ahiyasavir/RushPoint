## 0. Decide (Ahiya)

- [x] 0.1 Open questions answered (proposal.md "Decided").

## 1. Pure decisions — RED

- [x] 1.1 `scripts/test-prepared-run.ts`: `runStatusLabel` (draft/live/finished/garbage),
  `preparedRunChecklist` (every row, station row hidden without stations, rehearsal by
  instant, garbage ⇒ not done, never throws), `DRAFT_ALLOWED` shape. Confirm RED.
- [x] 1.3 `scripts/test-print-fingerprint.ts`: the fingerprint of the host sheet model
  moves when a mission is added/removed/renamed, an answer key or a staff code changes,
  or the date changes; does NOT move for an edit the sheet never shows; the stored
  summary carries no answer text; `diffPrintSummary` names each change. Confirm RED.
- [x] 1.2 `scripts/test-run-retention.ts` (extend): `plannedStartAt` in the future vetoes
  an abandoned prune; garbage is ignored, never a veto by itself. Confirm RED.

## 2. Pure decisions — GREEN

- [x] 2.1 `packages/shared/src/preparedRun.ts` + barrel; `Run` gains `plannedStartAt`,
  `meetingPoint`, `eventNote`, `earlyRegistration`,
  `prints` (`{ hostSheet?, stationQr?, joinSign? }` of `{ printedAt, fingerprint,
  summary }`), `cancelledAt` (all optional).
- [x] 2.3 `printFingerprint` + `diffPrintSummary` (creator-web `lib/`, beside
  `hostSheet.ts`).
- [x] 2.2 `runRetention.ts` anchor includes `plannedStartAt`.

## 3. Server — RED (e2e)

- [x] 3.1 `scripts/e2e-verify.mjs` scenario `prepared-run` as in design "Test strategy".
- [x] 3.2 Draft refusal matrix (table-driven) over every start/score callable.
- [x] 3.3 `test-callable-hardening.ts` C7: `assertRunOpen` or `DRAFT_ALLOWED`, stale fails.

## 4. Server — GREEN

- [x] 4.1 Extract the billing transaction out of `launchRunCore` into one function.
- [x] 4.2 `launchRunCore({ prepare })`; refuse `prepare` + `testDrive`.
- [x] 4.3 `openRun` (re-validate, bill once, idempotent).
- [x] 4.4 `assertRunOpen` and the guards of D4.
- [x] 4.5 `joinRun`: no self-start on a draft; refuse when `earlyRegistration === false`
  with `details.reason: 'registration-not-open'` + `plannedStartAt`.
- [x] 4.6 `startTeams`: rebuild stages for teams with no progress (D5).
- [x] 4.7 `updateRunEventDetails`, `markRunPrinted`, `cancelPreparedRun`,
  `listPreparedRuns`; re-export; `services/calls.ts` wrappers; audit logs.
- [x] 4.8 `getJoinInfo` carries `plannedStartAt` + `meetingPoint` + `registrationOpen` on a
  draft; `getMyTeamState` carries `event: { plannedStartAt, meetingPoint }` on a draft
  (`sanitizeTeamForParticipant` is not involved: these are run fields). The note never leaves.

### Built 2026-10-08 (night), verified
- `scripts/test-prepared-run.ts` 77 checks, `scripts/test-print-fingerprint.ts` 36 checks,
  `runRetention.test.ts` +6 (seen RED: 2 failing), `test-callable-hardening.ts` C7 (4 checks).
  The two pure suites were seen RED (module absent). The e2e scenario and C7 were written before
  the server code but only run after it, so their RED was not observed.
- e2e scenario `prepared run (…)`: 50 checks green on the offset lane.
- `npm test` green (407 script files + vitest).
- C7 found nothing hidden, but its first draft flagged `grantGuardianConsent` because the parsed
  body runs on into a helper's COMMENT ("self-guided runs seed launched:true"); comments are now
  stripped before the scan.
- Deviation from design D4: the refused list is the doors that START or SCORE play
  (startTeams, finalizeRun, pushFlashMission, activateHotZone, skipStage, skipTaskForTeam,
  adjustTeamScore). The submission doors need no guard: every grading path already refuses an
  unlaunched team, and C7 pins that only startTeams/joinRun/startInstantPlay launch one.
- The launch's billing transaction is now ONE function (`consumeLaunchBilling`) used by the
  launch and by `openRun`; free mode now also goes through a transaction (writes only) instead
  of a batch. `assertGameLaunchable` and `countPlay` are shared the same way.
- creator-web `services/calls.ts` wrappers added.

## 5. creator-web

- [ ] 5.1 Builder: "הכנה לאירוע" beside launch (date/time + meeting point dialog);
  "there is an event in preparation" state when a draft exists.
- [ ] 5.2 Console draft phase: header label from `runStatusLabel`; checklist card pinned;
  event-details card; live-only panels hidden (`isPanelVisible` learns `draft`);
  "open the run" + "open and start everyone" with `rc.confirmCta` verbs; cancel in ⋯.
- [ ] 5.3 Prints page: event block on the host sheet and join sign; listens to the game
  live (`onSnapshot`) instead of one `getGame`; `markRunPrinted` with the fingerprint
  when printing with `?run=`; a "changed since you printed" banner on the page itself.
- [ ] 5.4 Dashboard "upcoming events" strip; history badge copy for `draft`.
- [ ] 5.5 i18n HE + EN (plural voice), `npm run i18n:check:strict` clean.

## 6. play-web

- [ ] 6.1 Join screen and waiting screen: "starts on … at …, meeting point …";
  `registration-not-open` and `cancelled` messages mapped before generic errors.
- [ ] 6.2 i18n HE + EN.

## 7. Verify

- [ ] 7.1 `npm run verify` and `npm run e2e` green (redirect to a file, read the exit code).
- [ ] 7.2 Play it on the dev stack: prepare Monday-style, register a team, edit the game,
  open, start, confirm the team gets the new mission; print the host sheet with the date.
- [ ] 7.3 `scripts/hunt-field-bugs.mjs`: add a draft-run pass to h8 (dead buttons) and h13
  (labels contradicting the state).

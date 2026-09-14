## 1. The pure decisions — RED

- [x] 1.1 `scripts/test-late-joiner.ts`: `lateJoinerVerdict` is off by default, a
  literal `true` is required, consent outranks the setting in BOTH argument orders,
  a run that has not started has no late joiners, an empty game cannot start anyone,
  and every malformed input fails toward NOT starting. Confirmed RED (module absent).
- [x] 1.2 `pendingLateJoiners`: does NOT consult the setting; lists a team whose join
  time is unusable with an unknown wait; clamps a backwards clock; sorts longest wait
  first; skips malformed rows without taking the list down. Still RED.
- [x] 1.3 The grace window: a join in the same moment as the start is not late, and
  both functions apply the same window. Still RED.

## 2. The pure decisions — GREEN

- [x] 2.1 `packages/shared/src/lateJoiner.ts` + barrel export. 59 assertions green.

## 3. The run learns when play began

- [x] 3.1 `Run.teamsStartedAt` on the type, with the "stamped once" rule in the
  comment. `startTeams` stamps it best-effort after the batch commits.
- [x] 3.2 A second press does not move it — the guard is `if (!...teamsStartedAt)`.

## 4. `joinRun` starts a late joiner when asked

- [x] 4.1 `lateJoinerVerdict` ORs into the EXISTING `selfStart` flag rather than
  adding a parallel launch path, so the consent stop and the best-effort assignment
  are the same sentence rather than two that can drift.
- [x] 4.2 The response carries `lateJoined` + `lateJoinBlockedBy`, additive.
- [x] 4.3 `Game.autoStartLateJoiners` accepted by `updateGame` as a STRICT boolean.

## 5. The run-wide media approval

- [x] 5.1 `Game.autoApproveAllMedia` → copied onto `Run.autoApproveAllMedia` by
  `launchRun`, only when actually on.
- [x] 5.2 `submitStationPhoto` reads the RUN through `cachedGetDoc`, and ONLY when the
  task did not already decide.
- [x] 5.3 The response says WHICH rule approved it (`autoApproveSource`).

## 6. The console's safety net

- [x] 6.1 `listRunTeams` projects `joinedAt`; `RunTeam` and `RunTeamRow` typed.
- [x] 6.2 `RunSignalInput.strandedLateJoinerCount` + the `lateJoinerStranded` signal
  at `warn`, suppressing `notStarted`. RED first in `runConsole.test.ts`, then GREEN.
- [x] 6.3 `RunConsolePage` feeds it from `pendingLateJoiners`, NOT gated on the setting.
- [x] 6.4 Hebrew + English copy for the signal, singular and plural.

## 7. The Builder controls

- [x] 7.1 Two checkboxes in the game settings, both defaulting to off.
- [x] 7.2 **Both fields added to `BUILDER_EDITABLE_FIELDS`** — without this the control
  round-trips through local state and looks alive while never saving AND never
  registering as a change. `scripts/test-game-presentation.ts` fixture updated.
- [x] 7.3 Hebrew + English label and hint for each.

## 8. Gates

- [x] 8.1 `npm run verify` — 297/297 unit files, i18n PART A + PART B clean, all
  builds green. The ONE red gate is `check-marketing-output`, which fails on the
  untracked `apps/marketing/public/_kit-b83f9d2e/` template kit present at session
  start and is entirely outside this change.
- [x] 8.2 `npm run e2e` — **ALL PASS**, 121/121 callables covered, exit 0. Required
  adding `joinedAt` to `ALLOWED_RUN_TEAM_ROW_KEYS` with its classification written
  down; the allowlist guard caught the new field exactly as designed.
- [x] 8.3 `npm run i18n:check:strict` clean, zero new PART B findings.

## 9. Ship

- [ ] 9.1 Console half by `deploy:hosting` first — pure read side, quiet rather than
  wrong while `teamsStartedAt` is still absent. Then the API by VPS rebuild.
- [ ] 9.2 Post-deploy: start a run, join a team afterwards, confirm the console raises
  the stranded warning; with the setting on, confirm the team receives a mission.

## 10. Follow-ups filed, not built

- [ ] 10.1 Flipping auto-approve MID-RUN (design Open Question 1). The field case is an
  organizer drowning at minute 20, and launch-time capture does not serve them. Needs
  a callable + its own e2e scenario.
- [ ] 10.2 A one-tap "start them" on the stranded-team chip (design Open Question 2).

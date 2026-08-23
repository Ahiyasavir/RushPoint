## 1. RED — layout plan

- [x] 1.1 Create `apps/creator-web/src/lib/__tests__/runConsole.test.ts` with failing tests for
      `buildRunConsolePlan` from `../runConsoleLayout` (module does not exist yet): every `PanelId`
      lands in exactly one group across all three run statuses; the `primary` group contains exactly
      joinShare, stationQr, startTeams, alerts, broadcast, liveMap; `hotZone`/`trackables`/`zones`/
      `flashMission`/`photoReview`/`feed`/`chat`/`liveStandings`/`finalStandings` are never in
      `primary`. Run `npm test` and confirm it fails on the missing module, not on a typo.
- [x] 1.2 Add failing tests for status gating: `status: 'live'` omits `runSummary`, `analytics`,
      `heatmap`, `feedback`; `status: 'finished'` omits `hotZone`, `flashMission`, `trackables`,
      `zones`, `chat`. Confirm RED.
- [x] 1.3 Add failing tests for empty-group suppression (a group whose panels are all empty at the
      current state is absent from the plan) and for group summaries: `moderation` reports
      `pendingPhotoCount` + `unreadChatThreads`, `gameMechanics` reports an active hot zone. Confirm
      RED.

## 2. GREEN — layout plan

- [x] 2.1 Create `apps/creator-web/src/lib/runConsoleLayout.ts` with the `PanelId` / `GroupId` /
      `RunConsoleState` types and the minimum `buildRunConsolePlan` implementation that turns
      sections 1.1-1.3 green. No React, no imports from components.
- [x] 2.2 Run `npm test` and confirm the layout tests pass and nothing else regressed.

## 3. RED/GREEN — group open-state persistence

- [x] 3.1 Add failing tests for `readGroupState(raw, defaults)` / `writeGroupState(state)`:
      round-trip preserves open groups; an unknown group id in stored data is ignored; malformed
      JSON returns the defaults without throwing. Confirm RED.
- [x] 3.2 Implement both functions in `runConsoleLayout.ts` (pure, string in / string out) and
      confirm GREEN.

## 4. RED/GREEN — destructive-action classification

- [x] 4.1 Add failing tests for `classifyRunAction` from `../runConsoleActions`: the classifier is
      total over the `RunActionId` union, `finalizeRun` and `adjustTeamScore` are `destructive`,
      `skipStage` / `deactivateAnnouncement` / `hideFeedPhoto` are `cautionary`. Confirm RED.
- [x] 4.2 Add failing tests for `parseScoreDelta`: `'5'` → `+5`, `'-3'` → `-3`, and `''` / `'abc'` /
      `'0'` / `'  '` are all rejected (no adjustment submitted). Confirm RED.
- [x] 4.3 Create `apps/creator-web/src/lib/runConsoleActions.ts` with a `Record<RunActionId,
      ActionSeverity>` keyed by a closed union (so an unclassified future control fails typecheck)
      plus `parseScoreDelta`. Confirm GREEN.

## 5. RED/GREEN — share artifacts

- [x] 5.1 Add failing tests for `buildShareArtifacts` from `../runShareArtifacts`: exactly one entry
      per `ShareArtifactId`; a live run marks `recap` unavailable and `joinLink` available; a
      finished run marks `recap` available; `staffLink` appears only when a staff PIN exists.
      Confirm RED.
- [x] 5.2 Add failing tests pinning each produced URL as a literal, matching the strings the current
      `JoinShare` (`RunConsolePage.tsx:419-468`) and `PostRunLinks` (`:690-713`) code builds, so the
      consolidation cannot silently change a link a host already shared. Confirm RED.
- [x] 5.3 Create `apps/creator-web/src/lib/runShareArtifacts.ts`, moving the URL formulas verbatim
      from those two components. Confirm GREEN.

## 6. RED/GREEN — human-readable labels

- [x] 6.1 Add failing tests for `resolveTeamLabel` / `resolveTaskLabel` from `../runConsoleLabels`:
      a known id resolves to the display name / task title; an unknown id returns the marked
      shortened-id fallback; an empty collection does not throw. Confirm RED.
- [x] 6.2 Create `apps/creator-web/src/lib/runConsoleLabels.ts` and confirm GREEN.

## 7. i18n — copy for the new surface

- [x] 7.1 Add every new string to BOTH `he` and `en` in `apps/creator-web/src/i18n.ts` under
      `runConsole`: the six group titles and their summary formats, the seven share-artifact names +
      descriptions + copy `aria-label`s, the "unavailable until the run ends" reason, the score
      adjustment label + `aria-label(team)` + confirmation with team and signed delta, the finalize
      confirmation naming that the run ends for every team, the marked unknown-team / unknown-task
      fallbacks, and the four new tooltip titles/bodies (flash mission + lifetime, announcement
      persistence, hot zone, run billing types).
- [x] 7.2 Run `npm run i18n:check` and confirm PART A is clean (key parity + Hebrew is Hebrew,
      English is English). Run `npm test` and confirm `scripts/test-no-dashes.ts` stays green (no
      `—`, `–` or ` - ` used as a separator in the new copy).

## 8. Wire the UI — primary zone and groups

- [x] 8.1 In `RunConsolePage.tsx`, build the `RunConsoleState` from the data the page already holds
      (run status, teams, alerts, pending photos, feed items, unread chat threads, hot zone,
      leaderboard, survey results) and call `buildRunConsolePlan`. Render the `primary` group as the
      always-open top of the page holding only joinShare, stationQr, startTeams, alerts, broadcast
      and liveMap.
- [x] 8.2 Render every non-primary group with the existing `Advanced` primitive from
      `components/ui.tsx` (no edits to `ui.tsx`), passing the plan's summary into `meta` and wiring
      `open`/`onToggle` to the persisted group state from task 3. Collapse all groups except
      `teamsAndScores` by default.
- [x] 8.3 Move each existing panel under its assigned group without changing the panel's own
      internals, and delete the now-redundant inline `{!finished && …}` / `{finished && …}`
      conditions the plan replaces. Verify by inspection that no panel was dropped: every one of the
      24 panels is still rendered somewhere.

## 9. Wire the UI — destructive actions

- [x] 9.1 Replace the bare `±` glyph (`RunConsolePage.tsx:306-313`) with a labelled button carrying
      `t.runConsole.adjustScore` and an `aria-label` naming the team; route the prompt result through
      `parseScoreDelta` and confirm with the team name and signed delta before calling
      `adjustTeamScore`. A rejected parse submits nothing.
- [x] 9.2 Move `Finalize run` (`:249`) out of the routine control bar into its own separated
      end-of-run row, keep the `danger` variant, and make its confirmation state that the run ends
      for every team.
- [x] 9.3 Drive the `variant` of each console action from `classifyRunAction` so the classification
      and the rendering cannot disagree.

## 10. Wire the UI — share surface, labels, tooltips

- [x] 10.1 Replace `JoinShare`'s link list and `PostRunLinks` with one "Share & screens" surface
      driven by `buildShareArtifacts`: each entry shows a name, a description and a named copy
      action. Remove the two `🔗`-only buttons (`:706`, `:710`).
- [x] 10.2 Use `resolveTeamLabel` in the alert row (`:232`) and `resolveTaskLabel` in the photo
      review pending card (`:951-952`) and reviewed row (`:1001`).
- [x] 10.3 Extend `RichTooltip`'s `TooltipConcept` union (`components/RichTooltip.tsx:15`) with
      `flashMission`, `announcementPersistence`, `hotZone` and `runBilling`, sourcing their text
      from `t.runConsole.tip*` while Builder concepts keep reading `t.builder.tip*`. Attach them to
      the flash-mission label, the announcement label, the hot zone panel header and the billing
      chip (`:205-212`). State the flash mission's active lifetime in the UI from a single exported
      constant shared with the `pushFlashMission` call (`:599`).

## 11. REFACTOR

- [x] 11.1 Remove any duplicated visibility or count logic left inline in `RunConsolePage.tsx` that
      the plan now owns, so `buildRunConsolePlan` is the only place a panel's visibility is decided.
- [x] 11.2 Re-read the panel catalogue against the file and confirm every control listed in the
      proposal is still reachable; add a test asserting the catalogue's panel count matches the
      documented set so a future panel cannot be added without being grouped.

## 12. Verify — full gate set

- [ ] 12.1 Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build` and confirm all green.
- [ ] 12.2 Run `npm run i18n:check` (PART A must be clean, hard gate) and
      `npm run i18n:check:strict` and confirm this change adds **zero** new PART B
      hardcoded-string findings.
- [ ] 12.3 Run `npm run test:ui` and confirm the console still renders without a crash and the
      primary-zone controls are present.
- [ ] 12.4 Manual preview pass on a seeded live run: the primary zone holds exactly the seven
      first-five-minutes controls; every group expands to a control that was reachable before;
      a collapsed `moderation` group reports pending photos on its header; the score-adjust button
      reads as a labelled control and its confirmation names the team and delta; all seven share
      entries appear once, each with a name. `npm run e2e` is deliberately **not** run for this
      change: no callable, payload, rule or shared type is touched, and the emulator is owned by
      another process.

# Overnight work log, 2026-09-29 (00:30 → 08:00)

Mandate (user, Hebrew): keep working all night with timers, endless testing, find and fix bugs,
simplify interfaces. Hard rules from docs/HANDOFF-2026-09-28.md still apply: no commit, push,
deploy or production write without asking. Everything stays uncommitted on
`field-report-2026-09-27`.

## Work list (in order)

- [x] 1. Make the two flaky test files deterministic (`functions/uploadSessionRoute.test.ts`,
      `functions/src/storageUtil.test.ts`), so `npm run verify` is green in one pass.
- [x] 2. Full `npm run verify` in one pass + e2e (offset lane), record exit codes.
- [x] 3. Bug hunt by playing: player screen (no-scroll sheet, arrival gate, flash), console
      (inbox, team page, route picker), staff app, at phone width. Fix what is found, test first.
- [x] 4. Load sim: flash first-team race + many-teams, and 3 concurrent "after this mission" routes. Only
      the arrival gate is NOT in the sim (it needs synthetic GPS; left for `simulate:browser`).
- [x] 5. Firestore cost of the new callables (op counter), projected to 10 and 100 teams.
- [x] 6. Interface simplification pass (whatever playing shows is confusing).
- [x] 7. Morning summary (Hebrew) for the user.

## Log (in order; started 00:32)
- Item 1 DONE. `uploadSessionRoute.test.ts`: the abort and concurrent-PATCH tests waited on
  fixed sleeps (100/150 ms); now they wait on observable server state (HEAD offset, lock released)
  through an `until()` helper with a generous deadline. `storageUtil.test.ts`: the `beforeAll` is a
  cold import of firebase-functions/admin; given an explicit 60 s bound with the reason. 8 parallel
  runs of both files: 8/8 green.
- Item 2: `npm run verify` in ONE pass: EXIT 0 (first single-pass green since the flake).
- BUG (found by reading): removing a team that was out on a FIRST-TEAM flash mission left its
  claim 'claimed', so the mission stayed "taken" for every other team until expiry, and no organizer
  action could free it. `setTeamRemoved` now releases the claim and ends the suspension in the same
  transaction. e2e assertions added to the flash scenario.
- GAP: a flash mission sent for approval never reached the console inbox ("עכשיו"), the default
  screen. New inbox kind `flashReview` (urgent after the same 20 s as a mission review), the row opens
  the flash panel; the server now stamps `claims.<team>.submittedAt`. Vitest RED→GREEN.
- Staff app parity (first slice): `StaffFlashSection` in the staff app lists flash missions
  waiting for approval (approve / reject, capability `review`, red after 20 s) and running ones (end
  now, capability `broadcast`); renders nothing when there is nothing to act on. Pure selector
  `apps/play-web/src/lib/staffFlash.ts`, RED→GREEN by `scripts/test-staff-flash.ts`. Spec + tasks
  added to `openspec/changes/flash-missions-v2` (section 4), `--strict` valid. Browser check owed.
- Load sim: `scripts/simulate-run.mjs` now races a first-team flash mission across the whole
  fleet at once and a many-teams one (all claim + all submit concurrently, all on ONE flash doc),
  then checks exactly one winner, "taken" for the rest, every award counted once, and every team
  back on its own mission. `scripts/lib/run-audit.mjs` score conservation now counts awards booked
  against `bonusPenalty` (it would have flagged every flash/adjusted team). Not run yet.
- BUG (found by reading): both of the phone's `reportArrival` calls (the background probe while
  walking, and the "we are here" button) omitted `accuracyMeters`, and the server reads an absent
  accuracy as a PRECISE fix, so the coarse-fix guard (arrival-needs-a-usable-fix) never ran on
  arrival. Since located-mission-arrival gates EVERY located mission, a ±300 m fix could open any
  mission a street early. Both calls now send it; the button shows "stand still" (not "not there")
  on a retriable answer. Guard `scripts/test-arrival-sends-accuracy.ts` (RED on 3 findings → GREEN,
  prints its denominator) + an e2e assertion that a ±400 m fix at the point stays sealed.
  Also the GEOFENCE auto check-in's completeTask (same omission; the wrapper type did not even allow it). Coarse answer there now says "stand still" and the watcher retries.
- BUG (found by reading): a staff HOLD (pause) stopped the team's race clock but not its current
  mission's own countdown (`timeLimitMinutes` counts from `startedAt`), and the time-limit sweep did
  not skip held teams, so a team paused longer than its limit came back to a mission closed as "time
  is up", 0 points, for the organizer's pause. Resume now moves the assigned mission's `startedAt`
  forward by the hold (same `resumedStartedAt` arithmetic as a flash-mission return, from the
  server's own `heldAt`), and the sweep skips a held team. e2e assertion added to "staff field ops".
- BUG (found by reading): "let them in" (`markTeamArrived`) unsealed a located mission, but for a
  CHECK-IN mission (type field/geofence, where arriving IS the mission) `completeTask` still demanded
  the GPS proof the let-in exists to replace, so the indoor team stayed stuck on "too far". A check-in
  on a mission an OPERATOR let the team into now skips the proximity proof (a GPS-latched arrival still
  proves itself). e2e: new field mission `ag-c` in the arrival scenario, let in, checked in from 1 km.
- NOTE on TDD: the four e2e assertions added tonight were written before their fixes but not yet
  RUN red (one e2e pass is ~40 min on this laptop); the next full run is their first verdict.
- e2e run 1 (offset lane, built before the later fixes): EXIT 0, ALL PASS, including the new
  "removing a team releases its flash claim" assertions.
- QUOTA (found by reading, design D6 in flash-missions-v2): every phone listens to the active flash
  documents and each claim/sending/review rewrote the flash document's claims map, so every write was
  a read on every phone. A "many" flash at 100 teams × ~2 phones ≈ 200 listeners × ~200 writes ≈
  40,000 reads for ONE flash mission (Spark: 50,000/day; Blaze declined). Claims now live on the TEAM
  (`team.flashClaims`); the flash doc keeps only `takenBy` in first mode; "many" claims/sendings write
  only the team (no fan-out, no single-doc contention); end-early finds teams by
  `flashSuspension.flashId`. Console + staff app read claims off the team docs they already stream
  (`flashClaimsByFlash`), the phone off `getMyTeamState`. Pure tests RED→GREEN
  (`test-flash-missions.ts`, `test-staff-flash.ts`); e2e updated + asserts a "many" flash doc is never
  written. v2 was never deployed, so nothing stored needs migrating.
- verify EXIT 0 after D6; e2e run 2 EXIT 0, 1,995 checks, callable coverage 139/139, and every
  assertion added tonight passed (coarse fix stays sealed, hold moves the mission clock, let-in
  check-in, removal releases a claim, first-mode `takenBy`, a "many" flash doc never written).
- Load sim with the flash race: 8 teams (the `verify:emulator` size) CONSISTENT, 0 INTERNAL; exactly
  one winner of 8 in the first-team race, "taken" for the rest, every award counted once, every team
  back on its own mission. 12 teams: INTERNALs, every one an emulator 60 s timeout (1:1:1 count,
  0 product `internal` errors).
- QUOTA: op counter showed `submitFlashMission` at ~20 reads per call, from a FORCED leaderboard
  refresh on every auto-approved sending (reads every team; ~10,000 reads for one "many" flash at
  100 teams). Now the normal 20 s throttle carries it; organizer actions still force.
- Branch vs main A/B (a temporary `main` worktree, deleted afterwards, 12 teams, `--no-flash` added to the
  sim for a fair comparison): emulator timeouts branch 4/8/16/0 vs main 1/0/4/0 with identical call
  counts. Possibly a modest slowdown under saturation, but inside the noise, and the diff adds no read
  to any hot path. UNRESOLVED; production rehearsal is the tiebreaker (CLAUDE.md).
- Line endings: 9 files the previous session had flipped LF→CRLF (whole-file diffs, e.g.
  `assignNextTask.ts` 494+/490- for an 11-line change) restored to LF; diffs now show real size.
- PLAYED IT (dev stack, console + a 375px phone): first-team flash "button + approval". Found a
  REAL BUG no gate saw: after the claims moved onto the team (D6), the participant team projection
  (`sanitizeTeamForParticipant`, `packages/shared/src/testMode.ts`, an allowlist) dropped
  `flashClaims`, so the phone that had just sent read "another team already took it". Now projected
  as STATUS ONLY, and under a sealed score an approve/reject verdict reads as "sent". RED→GREEN in
  `scripts/test-test-mode.ts`. Replayed: phone "שלחתם. מחכים לאישור", console inbox row "⚡ ינשופי
  לילה · משימת בזק מחכה לאישור" urgent, approve → phone "זכיתם! +50", score 50.
- UX BUG (played): the inbox's "פתיחה" for a flash review opened the Game section and stopped at
  its top, the flash panel ~1,800px lower. `goToPanel` now scrolls to the named panel
  (`data-panel` on every PanelShell), with `scroll-mt-24 lg:scroll-mt-40` so the sticky header +
  section bar (144px at 1280) don't cover its title. Measured: panel lands at 160px, title visible.
- UX BUG (played): opening the console of a run with five teams, the "needs you now" strip said
  "עדיין אף אחד לא הצטרף" (nobody joined yet) until the first team poll landed, and the teams panel
  showed its "no teams" empty state. An unknown count is not zero: `buildRunSignals` now takes
  `teamCount: null` while unloaded (vitest RED→GREEN), and the teams panel shows a loading line.
- BUG (played a gated run, game f4Jhg… with 17 pinned missions): a mission the Builder shows as
  "anywhere" (`triggerMode: 'locationless'`) whose document still said `locationless: false` and
  kept an old pin reached the phone as LOCATED: "3.1 km from here", "navigate there" and a map pin,
  for a mission that needs no presence (the arrival gate rightly ignores it, which is how the
  mismatch showed). The participant payload now carries `locationless: true` for that trigger mode
  and `missionPins` skips it. RED→GREEN in `sanitizeTask.test.ts` + `test-mission-arrival.ts`.
  Replayed: the navigate button and distance are gone.
- ARRIVAL GATE, played end to end with a scripted GPS on the 375px phone: operator route (real
  `forceAssignTask`) → sealed card "🚩 … לכו לנקודה שמסומנת במפה · 1.1 ק״מ" + the "staff sent you"
  notice; at the point with ±300 m the mission stayed sealed; it then opened by itself and the
  latch reads `arrivalUnverified: true` (the grace window, by design: it excuses a coarse fix, never
  distance, and the console flags it). Full mission content after arrival.
- verify EXIT 0 and e2e run 3 EXIT 0 (1,995) after the browser-found fixes.
- STAFF APP, the "now" at a glance: the quick-bar chips now carry a count of what waits behind them
  (SOS: always red; photos to review: red once one has waited past the 20 s alarm). Pure
  `staffQuickBadges` (`packages/shared/src/quickActions.ts`), RED→GREEN in
  `scripts/test-quick-actions.ts`; screen readers hear "N waiting". Played: a test SOS showed
  "🆘 קריאות עזרה [1]" in red. (The a11y scan caught white-on-light in a ternary class string on the
  first try; split into two whole static strings.)
- QUOTA re-measured after the fixes (op counter, 8 teams, sim CONSISTENT): `claimFlashMission`
  4.9 reads/call, `submitFlashMission` 7.1 (was 20.2 at 12 teams and grew with the team count).
  Projection for ONE "many" flash mission at 100 teams × ~2 phones, all claiming and sending:
  | | before tonight | after |
  |---|---|---|
  | phone listeners on the flash doc | ~200 phones × ~200 claim/send writes ≈ 40,000 | only push + end ≈ 400 |
  | forced leaderboard refresh per sending | ~100 × 100 teams ≈ 10,000 | throttled (≤ 1 per 20 s) ≈ 100–300 |
  | callables themselves | ~1,200 | ~1,200 |
  | console + staff team-doc listeners (1 read per team write each) | ~200 per listener | same |
  | **total** | **≈ 50,000+ (the whole Spark day)** | **≈ 2,000–3,000** |
  The writes are unchanged in count but no longer pile onto one document.
- BUG (played the console at 375px): the console's clock (`reviewNow`) ticked ONLY while a mission
  photo waited, so a flash mission waiting for approval never turned urgent at 20 s (tonight's own
  inbox row only looked right on a fresh page load) and every age in the "now" list (SOS, stuck)
  froze. Pure `consoleClockMs` (1 s while a mission or flash submission waits, 15 s while the list
  only shows ages, off when empty), vitest RED→GREEN. Played: a flash sent after the page loaded
  ticked 0:44 → 0:56, red. The console at 375px has no page overflow.
- UX BUG (played at 375px): "פתיחה" on an SOS row in the "now" list opened the TEAM page, which says
  nothing about the SOS and cannot acknowledge it. Pure `inboxRowAction` (vitest RED→GREEN): SOS →
  the alerts panel (location + "אישור קבלה"), flash → flash panel, staff message → staff channel
  (it had no action at all), waiting team → start, rest → team page. And a pinned panel scrolled
  via its lane wrapper, landing its title under the sticky header; now the card (with its scroll
  margin) is scrolled: measured top 96px, title visible.
- UX BUG (played): the team page's "why the score changed" read "משימת בזק · flash mission", the
  server's fixed English reason under the Hebrew label. The ledger reason is now the flash mission's
  own title as the organizer wrote it (e2e assertion added).
- UX BUG (played the staff app): signing out asked "לצאת מקונסולת הצוות?" over a button reading
  "אישור". Six play-web confirmations had no action label (leave the game, hide/restore a feed photo,
  mute a team, staff skip, staff sign out). Guard `scripts/test-play-confirm-labels.ts` (RED on 6,
  prints its denominator: 9 confirmations) → every one now names its action; leaving the game is
  marked danger. The play-web half of creator-web's `test-confirm-cta`.
- Played the player's pause and removal screens (real `setTeamHold` / `setTeamRemoved`): pause shows
  "⏸ הצוות עצר אתכם לרגע. השעון מושהה" with the reason; resume settled 20.9 s; removal shows
  "🚫 המארגנים הוציאו את הקבוצה מהמשחק" with the reason, SOS still reachable; restored.
- verify EXIT 0, e2e run 4 EXIT 0 (1,995) after the second round of browser fixes.
- Load sim now also routes 3 teams to the same station "after this mission" at once (dry run → accept
  exactly the server's blockers → queue), and audits that every one of them completed it: 8 teams
  CONSISTENT, 6 `forceAssignTask` calls (3 dry + 3 queued), all 3 arrived. `--no-route` skips it.
- BUG (played route-team-to-mission on the phone): a team the operator sent to a mission in ANOTHER
  stage (a "visit") saw NO mission: "מאתרים את היעד הבא… נסו שוב", forever. The server assigned it
  and shipped its content, but `TaskRunner` looked for the assigned record only in the active stage.
  Pure `currentAssignedRec` (`apps/play-web/src/lib/currentMission.ts`, RED→GREEN in
  `scripts/test-current-mission.ts`) in TaskRunner, and the map now treats the visit as the current
  target too. Replayed: the visit mission "הביטלס" shows.
- BUG (played at 375x667 and 390x844): at the default "half" height the mission's own action
  ("צלמו תמונה", "שלח תמונה") sat BELOW the sheet's visible area (content 584px, room 305px). A new
  mission now opens at the height that shows it (`fitSnap`: half if it fits, else full), measured in
  a layout effect. Playing that found a SAFETY bug under it: snap heights came from the WINDOW
  (assuming a 56px header) while the sheet's container starts at y=118, so "full" rose over the
  header and COVERED THE SOS BUTTON (true of a manual drag to full before tonight too). Heights now
  come from the container (`boxSnapHeights`, ResizeObserver); measured: sheet 130–643 inside
  118–643, action visible, SOS uncovered; 390x844 the same. Tests in `scripts/test-sheet-snap.ts`.
- UX BUG (played a flash mission at 375x667): above the mission, inside the sheet, sat THREE
  "📢 הצוות שלח אתכם אל…" notices (every operator route leaves one; old ones stayed after the team
  moved on, and two routes to one mission left two identical ones), 250px that pushed the flash
  card's "✅ סיימנו" half out of the sheet. Pure `routeNoticeStillCurrent` (a route notice shows only
  while its mission is current; fail open when unknown) + `newestRouteNoticeId` (only the newest),
  in `packages/shared/src/announcements.ts`, tests in `scripts/test-targeted-announcements.ts`.
  Played: one notice, "סיימנו" at 519–571 inside a sheet ending at 643; tapping it returned the team
  to its mission with "זכיתם! +20 נקודות", score 20.
- Follow-up to fitSnap (played): a SEALED "walk to the point" mission also opened full (its card is
  long) and hid the map, which is the instruction there (flag, arrow, distance), while arrival is
  detected by itself. `fitSnap(..., { mapFirst })` keeps it at half; PlayScreen passes mapFirst for
  an `arrivalPending` mission, and the sheet re-fits when it unseals. Played: sealed → half, 262px
  of map visible.
- GATES after every fix above: `npm run verify` EXIT 0; e2e run 5 EXIT 0 (1,995 checks, callable
  coverage 139/139); `simulate-run --teams=8` (flash race + concurrent routes) CONSISTENT.
- Played "let them in" from the console's team page on a sealed mission (375px): the latch is
  written as an operator let-in, the phone opens the mission and the sheet re-fits to show its
  action. Small fix: the console now refreshes the team list right after it (as restore already
  did), so the button does not linger and invite a second tap.
- BUG (played the end of a run): after "סיום ריצה" the phone of a team that had NOT finished every
  stage kept showing its mission, minutes later: the final screen opened only on
  `team.status === 'finished'`, and `finalizeRun` never touches team documents. Its GPS kept pinging
  `updateLocation` (quota) and the wake lock stayed on. Pure `finalScreenReason(team, run)` (RED→GREEN,
  `scripts/test-final-reason.ts`) opens the final screen on `run.status === 'finished'` too, with
  honest copy ("המשחק הסתיים · המארגנים סיימו את המשחק. הנה איפה עצרתם", not "you finished every
  stage"), and stops pings + wake lock. Played: the phone shows it. It arrives on the next poll
  (≤ 60 s) or any team-doc change; making it instant would mean finalizeRun writing every team.
- UX BUG (played the team chat at 375x667): opening the "עוד" drawer by its own button left the chat
  input at y=632–676, cut by the bottom edge, inside a mission area that scrolls on its own with no
  sign of more below. The drawer now scrolls itself into view whenever it opens (the "open chat"
  path already did). Played: input at 579–623; a message sent from the phone reached the console's
  "now" list as "💬 ינשופי לילה · הודעה מהקבוצה 0:12", ordered after the SOS and the urgent item.
- Played team ↔ HQ chat both ways: the console's team page shows the message and its reply reaches
  the phone.
- GATES (06:05) after every change above: `npm run verify` EXIT 0; e2e EXIT 0, ALL PASS (1,993
  checks this run; the count moves by a couple between runs with timing-dependent checks), callable
  coverage 139/139; `simulate-run --teams=8` CONSISTENT. Temporary files removed (the local call
  helper and the comparison worktree).
- Self-review follow-up: the sheet is now keyed on the flash mission too, so taking one (which swaps
  the sheet's content for the flash card while the current mission stays the same) re-fits the sheet
  to show "סיימנו".
- FINAL GATES (06:21, after the last edit): `npm run verify` EXIT 0; e2e EXIT 0, ALL PASS (1,997),
  callable coverage 139/139. Viewports reset. Nothing committed, pushed or deployed.

# Field report 2026-09-27 → root causes → research → planned changes

A point-in-time record. During the live run of "המירוץ לציון" on 2026-09-27 (run
`xtg1HP7T3A40YfPNxu4u`, code 63MZWC, 5 teams) Ahiya operated the game from the Run Console, with
this session doing by hand, on the server, the things the console could not do. Everything he
raised was logged as it came up. This pass traces each item to its cause in the code, answers the
design questions with what comparable products do, and turns the result into changes.

Evidence comes from reading the code and from **read-only production queries on the VPS**. Where a
cause is still a hypothesis it says so.

## What had to be done by hand on the server during the run

These are the clearest signal of what the console is missing. Each was done through the real
callable (not a raw write) except where noted.

| Need | How it was done | Missing in the console |
|---|---|---|
| Set the organizer's phone number for players | Direct write of `run.contacts` (the callable is owner-only; Ahiya is not the owner) | Nothing: `setRunContacts` has a panel. The gap was access, not UI |
| Start ONE team, not all of them (×4) | `startTeams` with `teamIds: [id]` | A per-team start button. **The server already supports it** |
| Start every new team except one, automatically | A polling loop calling `startTeams` | An "auto-start late joiners" switch exists (`autoStartLateJoiners`) but has no per-team exclusion |
| Approve a video that had been rejected | `reviewStationSubmission` with `approved: true` | Nothing (the console can do it); Ahiya did not know it could |
| Remove a test team from the race and the table | **Not done.** No mechanism exists; the only way is deleting the team document | Remove / disqualify, pause |

## The report, item by item

| # | Reported | Root cause / finding | Evidence | Change |
|---|---|---|---|---|
| 1 | The console's section tabs are only half visible when scrolling | The site header is `sticky top-0 z-30` ([App.tsx:148](../apps/creator-web/src/App.tsx)) and the tab bar is ALSO `sticky top-0`, at `z-20` ([ConsoleTabs.tsx:70](../apps/creator-web/src/components/ConsoleTabs.tsx)). Both stick to the same line and the header paints over the tabs | Code; matches the screenshot exactly | quick fix (offset the tab bar by the header height) |
| 2 | The whole console is cumbersome and unclear, "exhausting" | 26 panels in 5 sections plus a pinned zone, 42 buttons, one 3,950-line page ([RunConsolePage.tsx](../apps/creator-web/src/pages/RunConsolePage.tsx), [runConsoleLayout.ts](../apps/creator-web/src/lib/runConsoleLayout.ts)). The organizer has to know which of five sections a task lives in | Code | `run-console-simplify` (research below) |
| 3 | The player app scrolls; it must not scroll at all | The active screen stacks ~15 blocks vertically; the task is last. `fix-play-screen-hierarchy` (0/13) reorders them but still scrolls | Code + that change's own analysis | extend `fix-play-screen-hierarchy` → map + bottom sheet |
| 4 | The ✕ in the player header is unclear | It is "leave the game on this phone" (`t.play.leaveAria`, confirm "you can rejoin with the same code"). A lone ✕ conventionally means "close this", not "sign out of a session" | [PlayScreen.tsx:1534](../apps/play-web/src/screens/PlayScreen.tsx) | part of the play-screen change |
| 5 | Route a team to a chosen mission, any stage; if mid-mission choose "skip now" or "after they finish" | `forceAssignTask` exists but only in the staff app, only in the ACTIVE stage, refuses skipped/completed, and its `override` is **all-or-nothing**: one flag bypasses release time, expiry AND prerequisites together ([assignNextTask.ts:452](../functions/src/routing/assignNextTask.ts)) | Code | `route-team-to-mission` (builds on `send-team-back`) |
| 5b | Bypass only the conditions that actually block this jump; leave X alone if only Y is missing | See 5: the current override cannot express this | Code | same |
| 6 | A per-team start button, fast to press many times | `startTeams` already accepts `teamIds` ([runs/index.ts:985](../functions/src/runs/index.ts)); only the UI is missing | Used 4× in production today | `team-lifecycle-controls` |
| 7 | Pause a team so it cannot continue | **Already exists, but only in the staff app.** `setTeamHold` (change `staff-console-field-ops`) sets `RunTeam.held`; every progress path refuses through `assertTeamNotHeld`, and held time is excluded from the race clock (`heldMs`). The organizer console never wired it. (An earlier draft of this report said no mechanism existed, which was wrong: it searched `team.status`, and the hold lives on `held`.) | Code: `functions/src/runs/index.ts` `setTeamHold`; only `apps/play-web/src/screens/StaffConsole.tsx` calls it | same (UI only) |
| 8 | Remove a team: it does not play and is not in the table | No mechanism at all, no callable, no field | Code | same |
| 9 | Clicking a team's name on the live map opens its page | The team page exists (`team-dossier-and-search`); the map labels are not wired to it | Code | same |
| 10 | Flash mission: no control after sending (end early, give the points to someone) | `pushFlashMission` is a broadcast only. No tracking of who did it, no award, and **no way to end it early**: `deactivateAnnouncement` exists, a flash-mission sibling does not ([index.ts:1265](../functions/src/index.ts)) | Code + the live doc `flashMissions/sApZLNWx1fuxXTFzR49G` | `flash-missions-v2` |
| 10b | Flash mission as a real mission: "לקחתי", do it, then go back to the previous mission. Option: first team only or as many as want | New capability | Decision 2026-09-28 | same |
| 10c | A flash mission should be an event: sound, animation, something that makes teams run | The banner is a quiet purple row in `LiveOps.tsx` | Code | same |
| 10d | Tell players at the start to turn the volume up | Not present. iOS mutes Web Audio when the ringer switch is on silent, so the copy must also say "not on silent" | Research below | same |
| 11 | Players don't understand they must walk to the point on the map | The active pin is a plain dot in the game's brand colour with a title only in a tap popup ([NavMap.tsx:290](../apps/play-web/src/components/NavMap.tsx)). The map frames its content **once** (`fitted`) and never moves when a new mission arrives | Code | `located-mission-arrival` |
| 11b | New located mission ⇒ animate to it, a clearer icon, zoom out to show both the mission and us, an arrow toward it | As above | Code | same |
| 12 | Every located mission opens only when the team gets there | Only `hideLocation` tasks are sealed until `reportArrival` latches `arrivedAt` ([sanitizeTask.ts:51](../functions/src/runs/sanitizeTask.ts)). The mechanism exists; it is simply scoped to hidden missions | Code | same |
| 13 | Show ALL missions on the player map, locked ones too | `getMyTeamState` ships task content only for assigned/completed tasks (wave D), so locked missions' coordinates never reach the phone | Code | same |
| 14 | Strong alert when a photo/video has waited over 20 s | A single `playAlert()` fires when a submission ARRIVES ([RunConsolePage.tsx:458](../apps/creator-web/src/pages/RunConsolePage.tsx)). Nothing escalates afterwards | Code | extend `live-ops-feedback-loop` |
| 15 | Video review loads everything, can't watch, and download opens a window | Server side is correct: prod answers `?download=1` with `content-disposition: attachment` (verified by curl). Only "download all" uses `mediaDownloadUrl`; the photo tile links the raw URL with `target=_blank` ([RunConsolePage.tsx:2914](../apps/creator-web/src/pages/RunConsolePage.tsx)). Videos use `ClipTile`, which already fetches nothing until play when a poster exists. **"Loads everything" is not explained by the code and needs a browser repro** | curl + code | quick fix + repro |
| 16 | Cannot rotate the phone while filming | The app is locked to portrait: `"orientation": "portrait"` in [manifest.webmanifest](../apps/play-web/public/manifest.webmanifest) AND in [twa-manifest.json](../twa-manifest.json) (the Play Store app). Installed, it cannot rotate at all | Config | `capture-rotation` (TWA rebuild needed for the store app) |
| 17 | "Why could I reject עדי's video if the mission is auto-approve?" | Not a bug. `autoApprove` applies only when the clip length is inside the mission's range (15–35 s here). עדי's clip was 10 s, so it went to the normal review queue; סבירז's was 15 s and was approved automatically | `submitStationPhoto` + production docs | none (explain it in the console: "approved automatically") |

## Decisions (Ahiya, 2026-09-28)

- The player map shows **every** mission's location, **locked ones included**.
- **Every** located mission opens only on arrival. It is not a per-game setting.
- Flash-mission claiming is a **per-flash-mission option**: first team only, or any team that wants.

- **Hidden missions are the exception** (agreed 2026-09-28): a `hideLocation` mission's whole
  point is that its spot is secret, so on the "all missions" layer it keeps showing only its search
  circle. Every other mission shows its exact pin.

## Research: what comparable products do

### Direct competitors

- **Goosechase** ([monitoring](https://support.goosechase.com/en/articles/4437529-monitoring-a-game),
  [mission states](https://blog.goosechase.com/how-to-manage-goosechase-mission-states/),
  [removing a team](https://support.goosechase.com/en/articles/6694618-how-do-i-delete-a-team-individual-participant-or-individual-team-member-from-my-experience)).
  The organizer has a few plain areas: Activity Feed, Submissions, Leaderboard, Stats. Photos,
  videos and correct answers are approved **automatically**; the organizer's moderation is
  *after the fact*: award bonus points, or delete a submission (points removed, the team may try
  again). Every team action sits in **one ⋯ menu on the team row** (message, adjust score, remove).
  Missions have three states (available / hidden / expired) that can be changed mid-game; that is
  their whole "flash mission" mechanism. Removing a team is **permanent** and deletes its
  submissions. We should do better: a soft remove that can be undone.
- **Loquiz** ([results page](https://loquiz.com/support/results-page/)). The live page is five
  tabs, each a single noun: **Standings, Answers, Photowall, Map, Chat**. Bonus points are given
  from the photo itself (click a photo → add points to that team). The map shows all task
  locations plus each team's position and route.
- **Actionbound** ([Find Spot](https://en.actionbound.com/help/article/find-spot)). A location
  task unlocks when the device enters a **20 m radius**. The author chooses how players navigate:
  a **direction arrow** (GPS + compass) or a **map**. Actionbound's own documentation warns that
  location tasks fail in dense urban areas and indoors, and that without a skip option this
  frustrates players. That is directly relevant to "every located mission opens on arrival".

### Neighbouring domains

- **Kitchen display systems**
  ([Shift4](https://shift4.zendesk.com/hc/en-us/articles/4940115080083-Set-up-the-Kitchen-Display-System-Ticket-Timer-Settings),
  [Toast](https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html)). A kitchen is a
  queue of items that must not wait. Each ticket shows its age and **changes colour at
  configurable thresholds** (green → yellow → red, e.g. 5 and 8 minutes). The cook clears a ticket
  with one tap ("bump"). This is the model for the review queue and the 20-second alarm.
- **Delivery dispatch (Onfleet)**
  ([task assignment](https://support.onfleet.com/hc/en-us/articles/360023910111-Task-Assignment)).
  Map and list side by side; unassigned work on top; reassigning is a drag from the driver to the
  task on the map. This is the model for "route a team to a mission".
- **Management by exception**
  ([Smashing](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/),
  [Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards)).
  An operations screen should show what deviates from normal, with timers and one clear next
  action, not everything at once.
- **The map bottom sheet (Google Maps, Uber)**
  ([NN/g](https://www.nngroup.com/articles/bottom-sheet/),
  [Material](https://m2.material.io/components/sheets-bottom)). A full-screen, fully interactive
  map with a sheet on top that has a peek height (summary), a middle height (details) and full
  height. The page itself never scrolls; only a fully expanded sheet scrolls inside itself. This is
  the standard answer to "a map app with no page scrolling".
- **Sound in a mobile browser**
  ([MDN autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay),
  [unlocking Web Audio](https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos)).
  Audio plays only after an AudioContext has been unlocked inside a real tap. iOS Safari **also
  silences Web Audio when the ringer switch is on silent**, and `navigator.vibrate` does not
  exist on iOS. So: unlock audio on the join tap (which every player makes), ask players to turn
  the volume up **and** turn silent mode off, and treat vibration as Android-only.

## Proposed approach per change

### `run-console-simplify` (the dashboard)

Today the organizer navigates by *where a panel lives*. Comparable tools navigate by *what you are
doing*: Loquiz uses five nouns, Goosechase puts every team action in one menu, and a kitchen
display shows only what is waiting. The proposal, in line with Ahiya's preference for the bold
restructure:

1. **"עכשיו" (Now)**, the default screen. One list of everything waiting for the organizer,
   oldest first, each with a live age and a one-tap action: submissions to review (colour by age,
   alarm at 20 s), SOS, stuck teams, teams waiting to be started. When it is empty it says so,
   and that means nothing needs you.
2. **"קבוצות" (Teams)**: the live map and the team list side by side, Onfleet-style. Clicking a
   team, **in the list or on the map**, opens that team's page. Every team action lives there, in
   one place: start, pause, send to a mission, send back, points, message, remove.
3. **"משחק" (Game)**: flash missions (with their live state and "who took it"), broadcast,
   pause/close a mission.
4. Everything done once (join link, QR sheet, staff invite, screens) moves to a **"הגדרות
   ושיתוף"** entry, and everything after the run (summary, analytics, heatmap, feedback, survey)
   moves to the run report page, which already exists (`/report`).

That is three live screens instead of five sections plus a pinned zone. The panels themselves are
mostly reused; what changes is the frame. The layout is already data
(`runConsoleLayout.ts`), so the restructure is largely a new grouping and a new shell, with the
3,950-line page split along the way. Before specifying, one working session with Ahiya over
wireframes of the three screens is worth more than any further reading.

### `team-lifecycle-controls`

- **Start one team**: UI only. A button on the team row and on the team page calling `startTeams`
  with that team's id.
- **Pause / resume**: reuse `setTeamHold` as is: the gate (`assertTeamNotHeld`), the clock
  exclusion (`heldMs`), the audit record and the player-facing "paused" state all exist. The
  organizer console just needs the button. The same is true of `forceAssignTask` (staff app only).
- **Remove**: soft and reversible, unlike Goosechase. `team.removedAt/By`: refused by the hold
  gate's sibling, excluded by `buildRankings` from live and final standings, hidden from the team list
  behind a "removed (1)" filter, with **restore**. No data is deleted.
- **Map → team page**: the team label on the live map opens the existing team page.

### `route-team-to-mission` (extends `send-team-back` / `forceAssignTask`)

- Replace the boolean `override` with a **computed list of blockers** for the chosen mission:
  not released yet, expired, missing prerequisites *by id*, station full, a different stage. The
  picker shows exactly those, and the organizer confirms that list. The server re-computes it and
  bypasses **only what it computed**. In Ahiya's X/Y example, only "Y not done" appears and only
  that is waived. Nothing is written to the template, so no other team and no other mission
  changes.
- **Cross-stage**: the hard part. Routing out of the active stage breaks the stage-completion
  invariants `forceAssignTask` refuses to touch. The spec must choose one of two options.
  (a) The team *visits* a mission in another stage while its current stage stays active; the
  completion is recorded against the mission's own stage, and when that stage later becomes
  active the mission is already done. (b) Routing moves the team's active stage. (a) is safer for
  scoring and parity. `send-team-back` already handles the reverse direction (earlier stages).
- **Mid-mission choice**: "now" displaces the current mission back to `unassigned` (what
  `forceAssignTask` does today); "after they finish" stores `team.nextTaskOverride`, which the
  routing claim consumes before its own scoring. Both are audited, and the team gets a notice.
- Available in the organizer console, not only the staff app.

### `flash-missions-v2`

- **Control**: `deactivateFlashMission` (sibling of `deactivateAnnouncement`), live state shown
  in the console (time left, who took it), and "award to team" on the flash mission itself. The
  award goes through the existing `adjustTeamScore` with a reason linking the flash mission.
- **A real, claimable mission**: a flash mission can carry a real task body (reusing the Task
  shape and its submission doors) plus `claimMode: 'first' | 'many'`. A `claimFlashMission`
  callable does the claim in a transaction (first-wins needs the same atomic pattern as station
  capacity). Claiming **suspends** the team's current mission instead of discarding it:
  the record stays with its `startedAt`, and on completing the flash mission the team goes back
  to it. A suspended mission's `timeLimitMinutes` countdown and pause-clock span must not run
  while it is suspended, and that has to be designed in, not discovered later.
- **The moment**: a full-screen takeover on arrival (short sound + animation + vibration on
  Android), then the banner with a live countdown and the "לקחתי" button. Audio is unlocked on
  the join tap; the join screen asks players to turn the volume up and silent mode off.

### `located-mission-arrival`

- **Arrival-gated for every located mission**: widen the existing seal
  (`sanitizeTaskForParticipant` + `reportArrival` + `arrivedAt`) from `hideLocation` tasks to
  every task with a location. Before arrival the card shows the mission's name, points, distance
  and "walk to the point on the map". Arrival reveals the instructions and inputs. Actionbound's
  own warning applies: GPS fails indoors and in dense streets. The existing grace window
  (`arrival-needs-a-usable-fix`) and a staff "let them in" action must cover that, or a team is
  stuck in front of the right door.
- **The map moment**: when the active mission changes, fly to the mission, then fit the camera to
  frame both the mission and the team (the fit logic exists; it is just latched to run once),
  draw a line with an arrowhead from the team to the mission, and use a clear destination pin
  (a flag with a pulse) instead of a coloured dot. Map line, not compass: a compass needs
  `DeviceOrientationEvent` permission on iOS and is noisy; the line needs nothing.
- **All missions on the map**: `getMyTeamState` ships a location-only layer for every mission
  (id, coordinates, state: open / locked / done), with locked pins greyed with a lock. Hidden
  missions keep their search circle only (see Decisions).

### Play screen: no scrolling, and the ✕

- Map full screen + a bottom sheet (peek: mission name + distance + main action; middle: the
  mission; full: extras such as feed, chat, trackables). The page never scrolls. This supersedes
  the reordering in `fix-play-screen-hierarchy`.
- The ✕ becomes a labelled item in a menu: "יציאה מהמשחק בטלפון הזה", with the existing confirm.

### Quick fixes (no spec needed)

- Console tabs offset below the site header.
- The photo tile's link uses `mediaDownloadUrl` (the server already honours it).
- Console label on auto-approved submissions: "אושר אוטומטית (באורך הנדרש)", so item 17 does not
  repeat.
- Capture rotation: `"orientation": "any"` in the web manifest (the layout must survive landscape,
  or the unlock is limited to the capture screen), and the same in `twa-manifest.json` with the
  pending TWA rebuild.

## Suggested order

1. Quick fixes (tabs, download, auto-approve label).
2. `team-lifecycle-controls` and `route-team-to-mission`: the things missing mid-run today.
3. The 20-second review alarm (extends `live-ops-feedback-loop`).
4. `located-mission-arrival` and the play screen (map + bottom sheet): they share the map.
5. `flash-missions-v2`.
6. `run-console-simplify`, after a wireframe session with Ahiya.
7. `capture-rotation`, together with the TWA rebuild.

## Status (kept current while the work runs; branch `field-report-2026-09-27`, uncommitted)

- [x] Research + this report.
- [x] Quick fixes (tabs sticky offset; gallery "הורדה" via `mediaDownloadUrl` + a call-site sweep in
  `scripts/test-media-download-url.ts`; `approvedAutomatically` + "אושר אוטומטית" label). Verified
  in the browser (tabs at 57 px under a 57 px header after scrolling; links carry `?download=1`;
  one auto label for one auto approval). Also fixed a pre-existing machine-locale-dependent sort
  (`teamSearch` now collates in the UI language). `npm run verify` EXIT=0.
  Known flaky under load (not ours): two upload streaming tests, flagged as a separate task.
- [x] OpenSpec: all 8 changes written and `openspec validate --strict` clean.
- [x] team-lifecycle-controls: implemented + e2e all PASS (authz, coverage). Browser-verified:
  per-team start button starts only that team; row menu shows pause/route/remove.
- [x] route-team-to-mission: shared `routeBlockers` + picker + server path (`accept`, `when`, visits,
  queue, stage-activation cascade, completion honours waivers — which also fixes a latent bug where
  the old override handed out a locked mission that then refused submission). Browser-verified:
  picker lists every mission with state, the confirm names exactly the blocker, routing notice
  reaches the phone. e2e scenario fixed after its first run (team already on X). Staff app
  migrated too: the server's `dryRun` names the blockers (the staff app cannot read the game), the
  old "override lock" button is gone. Staff-panel browser check pending.
- [x] review-wait-alarm: console AND staff app. Both browser-verified (staff at 375x812 against a
  planted 30 s old submission: pinned banner, row turns red at 60 s, mute, clears when judged).
- [x] located-mission-arrival: gate stamped at launch, sealed stub, reportArrival gate,
  missionPins, `markTeamArrived`, phone card + navigation + flag/arrow/chip/pins, console "let them
  in". e2e arrival scenario all PASS; two older scenarios updated to arrive first.
- [x] play-screen-no-scroll: GameScreen + MissionSheet + ⋯ menu. Browser-verified at 375x812,
  360x640, 390x844: page never scrolls, sheet snaps, map keeps the flag above the sheet.
- [x] flash-missions-v2: implemented, e2e 15/15, browser-verified (one phone + console: push, moment,
  claim, done, approve → +50, give up, end now). Playing it found one copy bug (the phone kept saying
  "you already took this mission" after sending and after winning), fixed test first.
- [~] capture-rotation: manifests + JS intent + camera wiring; real-device check and a TWA rebuild
  owed (a desktop preview cannot rotate).
- [~] run-console-simplify: done as a regroup (Now / Teams / Game, setup + reports compact, the
  inbox, default Now), browser-verified. The component split and the grouped team-page actions
  are not done.
- e2e run 4 (everything up to the console regroup): **ALL PASS**, EXIT=0, incl. flash missions
  15/15, arrival gate 14/14, team lifecycle, route team, and the callable coverage guard.
- After run 4: staff-app route panel (server `dryRun`), staff "let them in" (`getRunOutline`
  reports `arrivalGate`), team page grouped actions (D4). Gate run 6 covers these.
- Gate run 5 (`npm run verify`): 3 unit failures, all fixed (a dash in Hebrew copy, a clickable
  `<div>` on the flash moment, the capability table test not naming the three new callables).
- Gate run 8 (after every browser check, 2026-09-28): builds EXIT 0, artifacts EXIT 0; graph red
  ONLY on load-timing tests in files this work never touched (`uploadSessionRoute.test.ts`, then
  `storageUtil.test.ts` "hook timed out in 10000ms"), with `dev:all` + a browser running beside it.
  Both files pass alone (24/24). e2e run 6 ALL PASS. Remaining work needs the user: commit + deploy
  decision, the real-device rotation check and TWA rebuild. Optional: console D5 file split.

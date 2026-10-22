## Why

Ahiya, 2026-10-08: "I'd really like to be able to create a game in advance, properly, so I
already prepare everything in the console, like the host sheet and the rest."

Everything an organizer prepares before the day hangs off a RUN, and a run only exists once
it is launched:

- the join code, the join sign and its QR (`accessCodes/{CODE}`),
- the staff codes (a staff code is the join code with two characters planted in it,
  `packages/shared/src/staffCode.ts`) and the staff capability grants,
- the host sheet's tear-off staff codes and join code (`HostSheetPage` reads `?run=`),
- the console itself (pinned panels, teams list, broadcast).

So preparing a week ahead today means pressing the real launch a week ahead, and that
launch was designed for "we are starting now":

1. **It is billed at once.** `launchRunCore` consumes a credit or a free run in the same
   transaction. A cancelled or postponed event has already paid.
2. **It says "live" for a week.** The console says "ריצה חיה", the floating run bar shows
   it for 24 h and then it silently turns into a stale "open" run in history
   (`isPlayingNow`, 24 h window), which reads as "someone forgot to end it".
3. **Early registrations play the old game.** `joinRun` builds a team's stages from the
   game AS IT IS AT JOIN (`buildInitialStages`), and `startTeams` only maps those stored
   stages. A team that registers on Monday plays Monday's version on Thursday, after the
   organizer added, removed or reordered missions.
4. **Nothing says what is still missing.** There is no "ready for the day" view: whether
   staff are invited, prints are out, the stations have QR cards, the run was rehearsed.
5. **The event has no date.** The host sheet, join sign and the player's join screen
   cannot say "Thursday 10:00, Sacher Park", because no run carries a planned time.

`RunStatus` already has `'draft'`, and no server code ever writes it: the slot for this
was reserved and never built.

## What Changes

- **A prepared run** (`status: 'draft'`, shown as "בהכנה" / "Preparing"): created from
  the Builder with "הכנה לאירוע" beside the launch button. It gets its join code, staff
  codes, prints and console immediately. **Not billed** until it goes live.
- **Event details on the run:** optional `plannedStartAt` (date and time), `meetingPoint`
  (free text) and `eventNote`. Editable from the console. Printed on the host sheet and
  the join sign, shown on the player's join/waiting screen.
- **"Open the run" (פתיחת הריצה):** the one action that moves `draft → live`, stamps
  `launchedAt`, and charges, through the SAME billing path `launchRunCore` uses today.
  "Start all teams" on a prepared run offers to do both in one confirm.
- **Early registration (organizer's choice, default ON):** players can register with the
  code during preparation and see "the race starts Thursday at 10:00" instead of the
  generic waiting screen. Nobody can be started while the run is a draft.
- **Teams that never played get today's game:** at start, a team still `registered`
  has its stages rebuilt from the current game (no progress is lost, because there is
  none). This also fixes the same latent bug for ordinary live runs.
- **A "ready for the day" checklist** pinned in the console while the run is a draft,
  derived (no stored ticks): event date set, staff invited, host sheet printed,
  station QR printed (only when the game has stations), a rehearsal done since the last
  edit, sound unlocked on this device. Each row links to where it is done.
- **Upcoming events on the dashboard:** a prepared run appears as "אירוע קרוב" with its
  date, not as a live run. It never feeds the floating run bar.
- **Cancel preparation:** retires the draft, revokes its join and staff codes, charges
  nothing. A game with only a cancelled draft can be deleted.

## Not in this change

- Automatic go-live at `plannedStartAt` (a timer that charges a credit while nobody is
  watching is the wrong default; a reminder may come later).
- Multi-day scheduling of missions (that is `scheduled-release`).
- Several prepared runs of one game at once: allowed by the data model, but the Builder
  links to the nearest one; the dashboard lists all.

## Decided (Ahiya, 2026-10-08)

1. **Early registration:** ON by default, switchable per run from the checklist card.
2. **Billing:** payments are off today (`PAYMENTS_ENABLED === false`), so opening a run
   costs nothing. Opening still goes through the one billing function, so the day
   payments are switched on a draft is charged when it is opened and never before.
3. **Editing:** never blocked, before or during the run (editing a live run already
   works). The run takes the game as it is when each team starts.
4. **Rehearsal:** stays a separate free run, as today.
5. **The host sheet follows the game** (Ahiya: "when you edit, the host sheet updates").
   It is generated from the game every time it is opened, so it is always current on
   screen; what goes stale is the PAPER. The prints page listens to the game live (it
   reads it once today), and the checklist compares what was printed with what would be
   printed now: an edit that changes the sheet turns "printed" into "the game changed
   since you printed, print again", and names what changed (missions added/removed,
   answers, staff codes, date).

## Capabilities

### New Capabilities
- `prepared-run`: a run that exists with codes, prints and console before it goes live,
  carries event details, is billed on opening, and starts its teams on the current game.

### Modified Capabilities
- `run-console`: a draft phase (checklist pinned, live-only panels hidden, header label).
- `host-sheet`: prints the event date, meeting point and note when present.
- `join`: the join/waiting screen shows the planned start of a prepared run.
- `run-retention`: a draft whose planned date is in the future is never "abandoned".

## Impact

- `packages/shared`: `Run` fields, a pure `preparedRun.ts` (status label, checklist,
  "can this act happen in draft" table, retention anchor), barrel export.
- `functions/src/runs/index.ts`: `launchRunCore({ prepare })`, new `openRun`,
  `updateRunEventDetails`, `cancelPreparedRun`; draft guards in `startTeams`,
  `startInstantPlay`, `joinRun` (no self-start in draft), `pushFlashMission`,
  `activateHotZone`; stage rebuild for `registered` teams in `startTeams`.
  `listLiveRuns` unchanged (it filters `live`). New `listPreparedRuns` or a field on
  the dashboard's existing listing.
- `functions/src/maintenance/runRetention.ts`: `plannedStartAt` joins the anchor.
- creator-web: Builder launch split, console draft phase, dashboard "upcoming", host
  sheet and join sign event block, i18n (HE + EN).
- play-web: join + waiting screen planned-start line, i18n.
- e2e: a prepared-run scenario; callable coverage guard will demand it for the three
  new callables; staff capability table for any staff-reachable one.

## Context

A run is born `live` (`launchRunCore`, `functions/src/runs/index.ts`). Server code tests
`run.status === 'finished'` in ~23 places and never `=== 'draft'`, so a draft run written
today would be treated as fully playable by every callable. The design therefore makes the
draft phase an explicit allow-list, not an absence of checks.

Facts the design rests on (verified 2026-10-08):

- `joinRun` builds `RunTeam.stages` from the game at join time; `startTeams` maps the
  stored stages and assigns the first task. A registered team never re-reads the template.
- `getJoinInfo` already returns `runStatus`; play-web reads it.
- `isPlayingNow` (`apps/creator-web/src/lib/runHistoryBadge.ts`) already maps
  `status: 'draft'` to badge `'draft'` and excludes it from "playing now".
- `ABANDONABLE_RUN_STATUSES` already includes `'draft'`.
- The host sheet takes the run from `?run=` and reads `staffInvites` + `staffGrants`
  exactly like the console; nothing there assumes `live`.

## Decisions

### D1. Reuse `status: 'draft'`, do not add a fourth status
The type, the history badge and retention already know it. A new name would mean touching
all of them and leaving `'draft'` as a dead member. UI copy says "בהכנה" / "Preparing".

### D2. One launch core, a `prepare` flag
`launchRunCore({ ownerUid, gameId, prepare: true })` runs the SAME validation (stages,
empty-stage guard, `taskCompletabilityError`, `answerOutcomesProblem`) and the same atomic
run + access-code write, but skips the billing branch and writes `status: 'draft'`, no
`launchedAt`, no `playCount` bump. Validating at prepare time is deliberate: a broken game
should fail a week early, not on the morning. It is validated AGAIN on open (D3), because
the game will have been edited since.

Not a test drive: `prepare` and `testDrive` together are refused (`invalid-argument`).

### D3. `openRun` is the only `draft → live` transition
Re-validates the current game, then in ONE transaction: re-reads the run (must still be
`draft`), runs the existing billing decision (`resolveLaunchBilling`, wallet, ledger
entry carrying `runId`), and writes `status: 'live'`, `launchedAt: now`,
`billingType`, `maxParticipants`. Idempotent: a second call on a `live` run returns
`{ alreadyOpen: true }` without charging. Payments are off today, so in practice opening
writes `billingType: 'free'` and touches no wallet, exactly as a free-mode launch does. The billing code is extracted from
`launchRunCore` into one function both call, so the two doors cannot drift (same
reasoning as the comment on `launchRunCore` itself).

`maxParticipants` of a draft: the free/paid cap is unknown until billing, so the draft
carries the plan's cap at prepare time for display only; `openRun` writes the real one.
If early registration exceeded the real cap, opening still succeeds and the console says
how many teams are over (refusing to open on the morning is worse than a warning); the
existing join cap applies to new joins from then on.

### D4. Draft allow-list, as data
`packages/shared/src/preparedRun.ts` exports `DRAFT_ALLOWED` — the callables/acts that
work on a draft run: `joinRun` (when `earlyRegistration`), `getJoinInfo`, `inviteStaff`,
`staffSignIn`, staff capability grants, `pushAnnouncement` (a "see you at 10" message),
`sendTeamChatMessage`, `updateRunEventDetails`, `openRun`, `cancelPreparedRun`,
`listRunTeams`, team removal. Everything that STARTS or SCORES play refuses a draft with
`failed-precondition` + `details.reason: 'run-not-open'`: `startTeams`,
`startInstantPlay`, `requestNextTask`, `completeTask` and the submission doors,
`pushFlashMission`, `activateHotZone`, `skipStage`, `skipTaskForTeam`, `adjustTeamScore`,
`finalizeRun` (a draft is cancelled, not finalized).

Enforced by one helper `assertRunOpen(run)` placed next to the existing
`=== 'finished'` checks, and a static test (shape of `callableHardening.mjs`): every
callable either calls `assertRunOpen` or is in `DRAFT_ALLOWED`, and a stale entry fails.
That is what stops the 24th future callable from treating a draft as live.

`startTeams` on a draft: the client offers "open and start" in one confirm and calls
`openRun` then `startTeams`; the server does not merge them (two clear refusals beat one
compound one).

### D5. Teams that have not played start on the CURRENT game
In `startTeams`, for each team with `status === 'registered'` and no completed or assigned
task record, `stages` is rebuilt with `buildInitialStages(game)` + `applyRunClosures`
before the existing first-stage stamping. A team with any progress keeps its stages. This
is safe for live runs too and fixes the same bug there (register, organizer edits, start).
A late joiner's self-start path needs nothing: it already builds from the current game.

### D6. Event details live on the RUN
`plannedStartAt` (ISO, server-validated, may be in the past: an organizer fixing a typo
on the day must not be refused), `meetingPoint` (≤120 chars), `eventNote` (≤500 chars),
`earlyRegistration` (strict boolean, default true). Run-scoped by the CLAUDE.md rule:
the template is replayed by later runs and copied by duplicate/export/publish. Written
only by `updateRunEventDetails` (owner, or staff with a new `editEvent` capability? No:
owner only in v1, keeps the staff table unchanged). Clearing a field sends it ABSENT
(the `undefined → null` transport trap).

`getJoinInfo` returns `plannedStartAt` + `meetingPoint` (not the note, which is for staff);
`getMyTeamState` returns them while the run is a draft so the waiting screen can say
"מתחילים ביום חמישי ב-10:00, נקודת מפגש: …". Time is shown in the DEVICE's locale but
computed as an instant; no countdown in v1 (the "never ship a deadline to a device clock"
rule: a wrong phone clock would show a wrong countdown, a stated time cannot be wrong).

### D6b. The host sheet already has typed "date" and "meeting point" blanks
`Game.hostSheetFields.date` / `.meet` are free text the organizer types on the prints page
(issue 42). They live on the GAME; the new event details live on the RUN. On the prints page
with `?run=`, a run's `plannedStartAt` / `meetingPoint` fill those two lines (formatted, read
only, "from the event: edit in the console"); without a run, or when the run has none, the
typed game fields print as today. No migration: nothing is copied between the two.

### D7. The checklist is derived, never stored
`preparedRunChecklist(facts, now)` in `preparedRun.ts`, pure, total, never throws:

| row | done when | links to |
|---|---|---|
| date | `plannedStartAt` set | event details card |
| staff | ≥1 staff invite | staff panel |
| host sheet | printed, and its fingerprint equals the current one | prints page, host sheet |
| station QR | game has QR stations ⇒ printed and current; else hidden | prints page, QR |
| join sign | printed and current (the code and date are on it) | prints page, sign |
| rehearsal | a test-drive run of this game created after `game.updatedAt` | Builder test drive |
| registrations | informational: "N teams registered" | teams panel |

"Printed" is a FINGERPRINT, not a tick (Ahiya: the host sheet follows the game). The
sheet is already a pure model (`buildHostSheet`, `lib/hostSheet.ts`); when the print dialog
is opened from the prints page with `?run=`, the client hashes that model and records
`{ printedAt, fingerprint, summary }` per document (`run.prints.hostSheet`,
`run.prints.stationQr`, `run.prints.joinSign`) through a best-effort `markRunPrinted`.
The checklist recomputes the fingerprint from the current game and run:

- same fingerprint ⇒ "הודפס" with the time;
- different ⇒ "המשחק השתנה מאז ההדפסה" plus what changed, from a pure
  `diffPrintSummary(old, new)` over the stored summary (mission count and titles, answer
  keys changed, staff codes added/removed, date/meeting point), so the organizer knows
  whether reprinting matters ("added the mission 'הבאר'" vs "nothing a player sees");
- never printed ⇒ "לא הודפס".

A fingerprint rather than `game.updatedAt` because the Builder autosaves on every edit,
including edits the sheet never shows; a date comparison would nag after every keystroke.
The summary stores titles only, never answers (the run document is readable by staff).
The browser cannot tell us the paper came out, so the row says "הודפס/נשמר", and nothing
on the list blocks opening the run.

The prints page subscribes to the game document (`onSnapshot`, owner read) instead of the
one-shot `getGame`, so a sheet open in a second tab redraws while the Builder edits.

### D8. Labels and listings
- Console header: "בהכנה · יום ה׳ 10:00" instead of "ריצה חיה" (also fixes the label half
  of issue 60 by deriving the line from status: draft / live / finished).
- Floating run bar: unchanged code; `listLiveRuns` already filters `live`.
- Dashboard: a new "אירועים קרובים" strip, sorted by `plannedStartAt` (no date last),
  from a small `listPreparedRuns` callable (owner-scoped, `where status == 'draft'`).
- Run history badge `'draft'` already exists; give it copy.
- Builder: when the game has a draft run, the launch area says "יש אירוע בהכנה ליום ה׳"
  with "לקונסולה" as the primary action, so the organizer does not launch a second run by
  habit. "הפעלה עכשיו" stays available behind it.

### D9. Retention
`runRetention.ts`: for an unfinalized run the anchor is already the MAX of its
timestamps; add `plannedStartAt` to that max. A draft prepared 100 days ahead for an event
next week is then not "abandoned". A draft whose planned date passed 90 days ago with no
activity is pruned like any abandoned run, which is the promise.

### D10. Cancel
`cancelPreparedRun`: draft only; writes `status: 'finished'`, `cancelledAt`, revokes the
access code (`status: 'revoked'`, already honoured by `getJoinInfo`/`joinRun`) and staff
invites. Registered teams' phones show "האירוע בוטל" (new copy keyed on `cancelledAt`).
No charge happened, so nothing to refund. `deleteGame`'s "unfinished run" refusal then
passes.

## Risks

- **A callable forgets the draft guard** → a draft is playable for free. Mitigated by D4's
  static test, plus e2e: every refusing callable is called on a draft in one table-driven
  scenario (like the authz matrix).
- **Free runs farmed through drafts:** a draft cannot start or score anyone, so it is
  worthless as a game; early registration is capped by the plan's cap at prepare time.
- **Join code in print for a week:** same exposure as a live run printed a week ahead
  today; nothing new. Staff code stays two planted characters (never shortened).
- **Quota:** a draft costs only what the organizer and early registrants do; no pings
  (nobody is started, so no GPS watch runs on players).

## Test strategy

- Pure (`scripts/test-prepared-run.ts`): status label for every status and malformed
  input; checklist rows for every combination, station row hidden without stations,
  rehearsal compares instants and fails toward "not done" on garbage; retention anchor
  with `plannedStartAt` future/past/garbage; `DRAFT_ALLOWED` vs the callable list.
- Static (`scripts/test-callable-hardening.ts` C7): every callable `assertRunOpen` or
  declared.
- e2e scenario `prepared-run`: prepare (no wallet change) → staff sign in with the staff
  code → team registers early → organizer edits the game (adds a mission) → every
  start/score callable refused with `run-not-open` → `openRun` charges exactly once
  (second call idempotent) → `startTeams` → the early team's stages contain the new
  mission → cancel path on a second draft revokes both codes and charges nothing.
- UI: preview tools, both apps, desktop + 390px, Hebrew and English; `i18n:check:strict`.

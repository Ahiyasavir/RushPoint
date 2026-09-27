## Context

| Fact | Where |
|---|---|
| Role is derived live: `isController = (team.controllerUid ?? team.id) === myUid` | `PlayScreen.tsx:538` |
| `readOnly` feeds `frozen`, which disables every entry and shows the fake upload bar | `TaskRunner.tsx:408` |
| Viewer banner is rendered after `TaskRunner`, inside the drawer area | `PlayScreen.tsx:764` |
| `claimController` is instant server-side (any attached device); `transferController` only by the current controller | `functions/src/runs/index.ts:4256-4300` |
| Attach needs run code + team code typed | `JoinScreen.tsx:229` `attach()` |
| Only the controller pings location | `PlayScreen.tsx:294` |
| Every device refreshes `getMyTeamState` on each team-doc snapshot and at least every 60 s | `PlayScreen.tsx:189-222` |
| `qrcode` is already a play-web dependency | `apps/play-web/package.json` |

## Decisions

### D1: one link, one scan

Deep link `https://player.rush-point.com/?code=<RUN>&join=<DEVICECODE>`. `playRoute.ts` parses
`join` (normalised with `normalizeJoinCodeInput`); `JoinScreen` then renders "join team
<name>" (team name resolved by the existing `getJoinInfo` + a new optional `deviceCode` lookup that
returns ONLY the display name) with a single name field and one button that calls
`joinTeamAsDevice`. Wrong or expired team code → the ordinary attach form, pre-filled, with the
error.

"Add a phone" sheet: a QR (lazy `qrcode`, kept out of the entry chunk: `bundle:budget` must stay
green), the link with native share / copy through `routeShare` (`lib/shareLadder.ts`, never a new
ladder), and the typed code as the last resort. Entry points: a prominent card on the waiting
screen (before the start, when groups actually set up) and a header chip "📱 2" during play.

### D2: media from any phone, answers from one

`submitStationPhoto` resolves the caller with `requireController: false` but still requires that
the caller is an attached device of the team (`attachedDeviceUids`). It stores
`taskSubmissions[taskId].submittedBy = { uid, name }` (name from `team.devices`).

Why only media: a photo/clip is evidence, not a guess, so two phones sending is at worst two
candidates for the organizer, and the latest pending one wins (a pending record is already
overwritten on re-submit). Graded answers are different: two phones typing guesses at once race
the SAME team attempt counter and lockout (`wrongAnswerPenalty`), so one member's wild guess burns
the attempts another member was about to use, and the cooldown appears on phones that did nothing.
Keeping answers on one phone is the smaller surprise. The claim is one tap (D4), so "let me type
it" costs a second.

Auto-approve with two phones sending at once: `completeTaskForTeam` is idempotent (the second
returns `completed: false`), so one completion, one feed item. Unchanged.

### D3: what a viewing phone renders

`TaskRunner` gets `role: 'sender' | 'viewer'` instead of `readOnly`. For a viewer:
- media mission → the normal capture controls, enabled (D2);
- any other mission → the controls are REPLACED by a `ViewerCard`: avatar + "<name> is sending for
  the team" + primary "send from my phone". No disabled control is rendered, and no upload bar
  (the bar now follows the upload store only, per `submission-status-truth`).
The drawer banner is deleted; the card is the single explanation, next to what it explains.

### D4: hand-over without a dialog

"Send from my phone" and "give to <name>" call `claimController`/`transferController` directly. The
phone that LOST the role shows a 10 s toast "<name> is sending now · take it back", whose action is
`claimController`. The confirm dialog it replaces protected against an accidental tap; undo protects
against the same thing without taxing every intentional tap. A small haptic + "you're sending now"
on the phone that gained it (the existing `haptics.ts`).

### D5: presence without writes

`functions/src/devicePresenceStore.ts`: an in-process `Map<runId:teamId, Map<uid, lastSeenMs>>`,
touched by `getMyTeamState` for the caller's uid (bounded per team by the device cap; evicted with
the run like `lastFixStore`). `getMyTeamState` returns `devicePresence: { uid, lastSeenSec }[]`.
Zero Firestore reads or writes. This is the SIXTH module relying on the API running as ONE
process; add it to the CLAUDE.md single-process list. On a restart presence is empty, and the verdict
treats "unknown" as NOT quiet (fail open: never tell a team its phone died because the server
restarted).

Pure verdict `senderQuiet({ presence, controllerUid, nowSec })` in shared: quiet only when the
controller has a KNOWN last-seen older than 180 s and at least one other device was seen in the
last 90 s.

### D6: the header strip

`TeamPhonesStrip` in the play header: up to 4 initials + "+N", the sender with a small badge;
tapping opens `TeamDevicesPanel` as a sheet (not the drawer). Only rendered when the team has more
than one device or the game is team mode (the existing `hasTeammateDevices`).

## Risks

- Two phones sending two different photos: the organizer reviews the latest. The console shows
  `submittedBy`, so it is legible.
- The deep link carries the team's device code in a URL. It is already shown on screen to the whole
  team and grants only "attach to this team" within this run; the attach callable is rate-limited.
  Acceptable, same trust level as today.

## Test strategy

- Pure: `scripts/test-device-deep-link.ts` (parse `join`, normalise, garbage); 
  `scripts/test-sender-quiet.ts` (the verdict table incl. unknown ⇒ not quiet, restart case);
  a source guard that `TaskRunner` renders no `disabled` capture control for `role === 'viewer'` on a
  media mission and that the drawer viewer banner is gone.
- e2e (`scripts/e2e-verify.mjs`): a non-controller attached device submits a photo → accepted,
  `submittedBy.uid` is that device; the same device calling `submitTaskAnswer` → `not-controller`
  (unchanged, pinned); a stranger (not attached) calling `submitStationPhoto` for the team → denied;
  `getMyTeamState` from two devices returns both in `devicePresence`.
- UI via preview (two browser profiles or one tab with the emulator switching `controllerUid`):
  viewer on a quiz sees the ViewerCard at the top of the mission; tapping it takes over; the other
  tab shows the undo toast; the "add a phone" QR opens the attach screen with the team name.
  `npm run bundle:budget` green (QR stays lazy). `npm run i18n:check:strict` clean.

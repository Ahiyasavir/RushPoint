## Why

Field report 2026-09-25: *"I want to work on the multi-phone team interface. It should be simple,
linking phones in a team should be super intuitive and fun, they should be able to switch between
them who manages the team and sends the content, and the interface should be very comfortable."*

What a team meets today (code read and reproduced 2026-09-25 at 375×812):

1. **Adding a phone is two codes typed by hand.** `JoinScreen.attach()` needs the run code AND the
   6-character `deviceJoinCode`; the code lives in `TeamDevicesPanel`, which is collapsed inside the
   "עוד" drawer below the mission (`PlayScreen.tsx:798`). There is no link or QR that carries the team
   code (`lib/playRoute.ts` parses `code`, not a team code).
2. **A second phone is a grey screen that looks broken.** Reproduced: on a non-controller phone the
   photo mission shows a disabled "צלמו תמונה", a progress bar "מתחיל להעלות…" and a button stuck on
   "עובד…", although nothing is uploading. The one explanation ("👀 מצב צפייה · דנה עונה בשם
   הקבוצה") is rendered 200 px BELOW the controls, after the mission card
   (`PlayScreen.tsx:764`), and taking control is two levels down in the drawer behind a confirm dialog.
3. **Whoever is filming cannot send.** All fifteen submission callables are `requireController`
   (`submitStationPhoto`, `submitTaskAnswer`, `completeTask`, `verifyStationCode`, …). The person
   holding the camera is often not the person holding the controlling phone; today they must hand
   over control first, and after the hand-over their upload failed anyway until
   `attached-phone-uploads`.
4. **A controlling phone that dies strands the team.** Nothing tells the others that it went quiet.
   Only the controller sends location, so there is no liveness signal on the participant side.

## What Changes

- **Add a phone in one scan.** Every team screen offers "add a phone": a big QR and a share link
  that carry the run code AND the team's device code; opening it lands on "join team X" with only a
  name to type. Shown prominently while the team waits for the start, and as a chip in the header
  during play.
- **The team in the header.** A compact row of the team's phones (names or initials), the one that
  sends marked with a badge. Tapping a teammate hands over sending in one tap, with a short "undo"
  on both phones instead of a confirm dialog.
- **A viewing phone says so where it matters.** On a mission it cannot send, the controls are
  replaced (not greyed) by one card: who is sending, and "send from my phone", which takes over
  instantly, with the same undo offered to the phone that lost it.
- **Media missions can be sent from any phone of the team.** Photo, audio and video submissions are
  accepted from every attached phone and attributed to the phone that sent them; graded answers
  (quiz, numeric, code, sequence, check-in) remain one-phone-at-a-time.
- **A quiet sending phone is noticed.** If the sending phone has not been seen for three minutes,
  the other phones are told and offered to take over.

## Non-goals

- Every phone answering graded questions (see design D2 for why not now).
- Per-member scoring or roles beyond "the phone that sends".
- Changing the device join code format.

## Surfaces

- shared: presence verdict (pure), deep-link parse.
- functions: `submitStationPhoto` accepts any attached device (callable behaviour change); `getMyTeamState` returns device presence; an in-process `devicePresenceStore.ts` (single-process precondition, like `lastFixStore.ts`).
- play-web: `JoinScreen.tsx`, `PlayScreen.tsx`, `TaskRunner.tsx`, `TeamDevicesPanel.tsx`, `lib/playRoute.ts`, `i18n.ts`.
- Depends on `attached-phone-uploads` (must ship first) and `submission-status-truth` (the status line a viewer sees).

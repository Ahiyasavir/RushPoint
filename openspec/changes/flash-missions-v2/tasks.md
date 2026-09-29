# Tasks: flash-missions-v2

Source: `docs/field-report-2026-09-27.md` items 10-10d + decision of 2026-09-28 (claim mode option).

## 1. RED
- [x] 1.1 `scripts/test-flash-missions.ts` (claim verdict, state, suspension arithmetic, legacy docs).
      Confirm RED.
- [x] 1.2 e2e scenario "flash missions" + authz rows. Confirm RED.

## 2. GREEN
- [x] 2.1 Shared types + pure helpers. 1.1 → green.
- [x] 2.2 Callables: `pushFlashMission` fields; `deactivateFlashMission`, `claimFlashMission`,
      `submitFlashMission`, `releaseFlashMission`, `reviewFlashMission`; time-limit extension in
      `assertWithinTimeLimit` + sweep; hardening, rate limits, capabilities (`broadcast` for push/end,
      `review` for review/award), re-exports. 1.2 → green.
- [x] 2.3 creator-web composer + live panel; wrappers; i18n.
- [x] 2.4 play-web moment, banner, claim, flash card, return; join-screen sound prompt; audio
      unlock; i18n.

## 3. Verify
- [x] 3.1 Preview two phones + console: first-team claim race, return with time preserved, end early.
- [x] 3.2 `npm run verify`, `npm run e2e`, exit codes to a file.

## Progress (2026-09-28)

Implemented server + console + phone. Gates: verify phases EXIT 0, e2e run 6 ALL PASS.
Browser-verified on the dev stack (one phone in the preview at 375x812, a second team driven by a
script): console push in "first team only" + button + approval; the phone got the full-screen
moment (375x804) and the "לקחתי" banner; phone claimed, the scripted team was refused with
FLASH_TAKEN; the phone showed the flash card, "סיימנו" sent it back to its mission with the clock
kept (18:16 before, 18:14 after ~25 s away); console "אישור" gave 50 points and marked it "זכתה".
Second push in "many": both teams took it, console "לסיים עכשיו" ended it and both teams were back
on their mission with no suspension. Volume line shows under the join button. Sound not checked
(no audio in the preview).

## 4. Overnight additions (2026-09-29)
- [x] 4.1 RED e2e: removing a team releases its first-team claim; another team can then take it.
- [x] 4.2 GREEN: `setTeamRemoved` releases the claim + ends `flashSuspension` in its transaction.
- [x] 4.3 RED vitest: `buildInbox` lists `flashReview` rows (urgent at 20 s). GREEN: inbox kind,
      console listener shared with the flash panel, `submittedAt` stamped on the claim at submit.
- [x] 4.4 Staff app: waiting flash missions with approve/reject (capability `review`), end early
      (capability `broadcast`). Pure selector test first.
- [x] 4.5 Load sim: first-team race + many-teams claim/submit under N concurrent teams; score
      conservation oracle counts awards booked against `bonusPenalty`.
- [x] 4.6 D6: claims move to `team.flashClaims`; flash doc keeps `takenBy` (first mode). Pure test
      first (`scripts/test-flash-missions.ts`: state from `takenBy`, verdict from the team's claim),
      then server, console, staff app, phone, e2e + sim updated to read claims from the team.

Verified 2026-09-29 (overnight): verify EXIT 0; e2e run 2 EXIT 0 (1,995 checks, 139/139 callables);
8-team load sim with the flash race CONSISTENT. Played on the dev stack: a 375px phone took a
first-team flash, sent it, the console inbox showed it urgent, "פתיחה" landed on the flash panel,
approve → the phone read "זכיתם! +50". Staff app (PIN sign-in) listed a waiting flash, approved it
and ended one early. Playing found the participant-projection gap (`flashClaims` dropped by
`sanitizeTeamForParticipant`), fixed test-first.

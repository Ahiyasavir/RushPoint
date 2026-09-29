## Why

Field report 2026-09-27 items 10-10d. During the run the organizer pushed "first team to reach חוות
טור סיני gets 25 points" and then could do nothing with it:

- **No control.** `pushFlashMission` writes a banner (title, description, bonus, TTL) and nothing
  tracks who did it or awards it; crediting a winner is a separate manual score adjustment. It
  cannot be ended early: `deactivateAnnouncement` exists for announcements, no sibling for flash
  missions.
- **Not a real mission.** He wants teams to press **"לקחתי"**, do it, and then **return to the
  mission they were on**. Decision 2026-09-28: per flash mission, **first team only** or **any team
  that wants**.
- **No moment.** It arrives as a quiet purple row in `LiveOps`. He wants sound, animation, something
  that makes teams run for it, and players told at the start to turn the volume up.

Goosechase's equivalent is releasing hidden missions mid-game; nothing there makes it an event. On
the web, sound needs an unlocked audio context and iOS mutes Web Audio on silent
(`docs/field-report-2026-09-27.md`).

## What Changes

- **Composer** (console, "Game" area): title, instructions, points, duration, **who can take it**
  (first team / any team), **how it is done** (announcement only, as today / "done" button / photo /
  video), and whether a submission needs approval.
- **Live control:** each active flash mission shows time left and its takers (claimed / sent /
  approved), with **End now**, **Approve**, **Award to a team** (for announcement-only missions:
  pick the winner), all audited.
- **Players:** a full-screen arrival moment (sound, animation, vibration on Android), then a banner
  with a countdown and **"לקחתי"**. Taking it pauses the team's current mission (its time limit
  does not run meanwhile) and shows the flash mission; finishing or giving it up returns the team
  to the mission it was on. For a first-team mission, the others see "נלקחה על ידי …".
- **Points** go through the score ledger as a flash-mission award, so standings and the team's
  history show where they came from, and the game's stages are never touched.
- **Sound readiness:** the join screen asks players to turn the volume up and silent mode off,
  and the join tap unlocks the phone's audio.

## Capabilities

### New Capabilities
- `flash-missions`: claimable, controllable, scored flash missions with a player moment.

## Non-goals

- Flash missions with answer checking (quiz/numeric/codes). Photo, video and "done" cover the
  observed use; the rest can follow on the same claim model.
- Location-verified flash missions ("first to reach X" stays judged by the organizer's award).
- Push notifications to a closed app.

## Surfaces

- **Shared:** `FlashMission` type (claimMode, doneBy, requiresApproval, claims), pure
  `flashClaimVerdict`, `flashMissionState`.
- **Callables:** `pushFlashMission` (new fields), new `deactivateFlashMission`,
  `claimFlashMission`, `submitFlashMission`, `releaseFlashMission` (give up), `reviewFlashMission`
  (approve/reject/award). All audited, rate limited, in the hardening lists, e2e-covered.
- **creator-web:** composer + live panel. **play-web:** moment, banner, claim, flash card,
  return-to-mission, join-screen sound prompt, audio unlock. i18n both.

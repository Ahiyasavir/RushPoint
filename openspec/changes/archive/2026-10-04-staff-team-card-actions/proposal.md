## Why

In the staff app every team card carries up to nine buttons inline: four score steps
(-10 -5 +5 +10), "סכום אחר", hold, send to a mission, skip and send back. Six teams make about
54 buttons on one phone screen, where a marshal under pressure mostly needs to FIND a team and
see its state. Found in the overnight pass of 2026-10-03 (`docs/OVERNIGHT-2026-10-03.md`,
proposal 1), approved by Ahiya on 2026-10-04.

## What Changes

- A team card shows, always: the follow star, name, score, state badges, call links, the last
  acknowledgement, and the actions that are urgent or stateful: **hold / release** (kept one
  tap away, as the existing design requires), **clear out of bounds** when the team is out,
  and **let them in** when a located mission waits on it.
- Everything else (score steps, a custom amount, send to a mission, skip, send back) opens
  under the card from one **"פעולות"** button, which says whether it is open.
- An inline panel that is open (custom amount, hold reason, send to, send back) keeps the
  actions open, so nothing a marshal is typing into disappears.
- A card with nothing behind "פעולות" (no score and no routing capability, or a finished team
  with nothing left but send back unavailable) shows no button.

## Capabilities

### New Capabilities
- `staff-team-card-actions`: which staff actions a team card shows at once and which wait
  behind "פעולות".

## Impact

- `apps/play-web/src/lib/staffTeamActions.ts` (`hasMoreActions`), `screens/StaffConsole.tsx`
  (`TeamOpsCard`), i18n HE + EN. Test: `scripts/test-staff-team-actions.ts`.
- No server change: every action and its capability gate is unchanged.

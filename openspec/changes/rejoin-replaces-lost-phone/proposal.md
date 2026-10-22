## Why

The 15.10 deploy (self-healing-entry) gave a phone that lost its sign-in a one-tap "חזרה לקבוצה". The
tap mints a fresh anonymous identity and attaches it to the same team. But the identity that was lost
stays on the team, with everything it held. On 18.10 that produced three failures, all reproduced in
WebKit/iPhone against the emulator:

1. **A team already at its phone limit cannot take the phone back.** A team declared with one member
   holds three phones. If one of them loses its sign-in, the rejoin is refused with "בקבוצה הזו כבר יש
   את מספר הטלפונים המרבי". That is exactly what an iPhone would see at the race.
2. **Every loss uses up a slot.** A team of three with two phones: the first rejoin works, the second
   is refused. The dead identities pile up and are never removed.
3. **The team's sender stays dead.** When the team's first phone (the one that sends) loses its
   sign-in, it comes back as a viewer and the sending role stays with an identity nobody holds. Nothing
   can be submitted until someone finds "take control" in the phones panel, or until the 3-minute quiet
   banner appears. That banner fails open when presence is unknown, for example after an API restart.

## What Changes

- `joinTeamAsDevice` accepts an optional `replacesUid`: the identity this phone had before it lost its
  sign-in. When that identity is attached to the team being joined, the new identity takes its place
  in `deviceUids`, in `devices` and in the device-membership index. It also takes the sending role if
  the old one held it. No new slot is used and the run's device counter does not move.
- The rejoin on the signed-out card sends the identity saved at join time (`Session.deviceUid`) as
  `replacesUid`.
- When `replacesUid` is absent, unknown, not on this team, or the caller itself, the call behaves
  exactly as before. A normal attach does not change.

## Impact

- `functions/src/runs/teamDevices.ts` (new pure `planDeviceReplacement`), `functions/src/runs/index.ts`
  (`joinTeamAsDevice`), `apps/play-web/src/services/calls.ts`, `apps/play-web/src/screens/PlayScreen.tsx`.
- No new callable, no data migration and no rules change. The replaced identity's `runDeviceMember` doc
  is deleted in the same transaction.
- Tests: vitest for the planner, an e2e scenario, and three new scenarios in
  `scripts/browser-auth-loss.mjs`.

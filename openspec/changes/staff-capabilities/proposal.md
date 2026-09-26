## Why

Field report 2026-09-25: *"I want to be able to limit what staff can control (for example, they
cannot give points)"*. Refined by Ahiya the same day:

> *"I want an option in the GAME SETTINGS to block staff from adding points, and in the game itself
> (the run) to be able to approve it for other people. Maybe even codes with different permissions:
> I create a staff code, choose what the people on it are allowed, and I can create several
> different codes."*

Researched 2026-09-25. **A permission model already exists on paper and is enforced nowhere:**

- `inviteStaff` accepts `permissions: string[]` and stores it on the invite
  (`functions/src/runs/staffInvite.ts`); `staffSignIn` copies it into the staff custom token.
- The console always sends the same hardcoded list: `['announce', 'review_photos',
  'track_locations']` (`apps/creator-web/src/pages/RunConsolePage.tsx:723`).
- The only server gate, `assertStaffOrOwner` (`functions/src/auth.ts:20`), checks
  `staff && ownerUid && runId` and **never reads `permissions`**; neither does the Firestore rule
  `isStaffForRun` (`firestore.rules:407`).
- So every staff member can call all 14 staff-reachable callables, including `adjustTeamScore`,
  `skipTaskForTeam`, `forceAssignTask`, `setTeamHold`, `setRunTaskStatus` and
  `reviewStationSubmission`. (`skipStage`, `startTeams` and `finalizeRun` are owner-only already.)
- A staff PIN is SINGLE-USE (`staffSignIn` flips `used: true` in a transaction), so every marshal
  needs their own code, and nobody can be removed mid-run.

## What Changes

- **Game settings: staff defaults.** In the Builder's game settings the creator chooses what staff
  may do by default in this game, e.g. "staff cannot add or remove points". Stored on the game and
  used as the starting point of every staff code created for its runs.
- **Run: staff codes with permissions.** In the Run Console the organizer creates any number of
  staff codes. Each code has a name ("judges", "marshals at the park"), a set of permissions
  (starting from the game's defaults, freely changed, e.g. granting points to the judges only), and
  can be used by several people. The organizer can edit a code's permissions at any time (it
  applies to everyone who joined with it), disable a code (nobody new can join with it), and remove
  one person.
- **The server enforces permissions** on every staff operation. Safety (acknowledging an SOS,
  releasing an out-of-bounds team) and the staff↔organizer channel are always allowed and cannot be
  removed: a marshal who sees an SOS must be able to act on it.
- **The staff app shows only permitted actions** and updates live when the organizer changes them,
  without re-entering the code. A removed person is signed out.
- Staff who signed in before this change keep full access for the rest of that run (today's real
  behaviour), so nothing breaks mid-event.

## Non-goals

- Per-team scoping of staff (a marshal who only sees teams 1–5).
- Owner-only operations becoming delegable.

## Surfaces

- shared: `staffCapabilities.ts` (capabilities, presets, the callable table); `Game.staffDefaults`.
- functions: `auth.ts` (`assertStaffCan`), the 14 staff-reachable callables; `inviteStaff` becomes
  "create staff code" (multi-use, labelled, with capabilities); `staffSignIn` (multi-use codes,
  writes a per-person grant); new callables `updateStaffCode`, `removeStaffMember`,
  `refreshStaffSession`; `updateGame` validates `staffDefaults`; `callableHardening.mjs` declares a
  capability per staff-reachable callable.
- Firestore: `staffInvites` documents gain `label`, `capabilities`, `multiUse`, `disabled`, `version`;
  new server-only `runs/{runId}/staffGrants/{staffUid}`; rules: staff read their own grant and their
  code; `teamLocations` staff read requires the locations capability.
- creator-web: Builder settings "staff permissions" (+ `BUILDER_EDITABLE_FIELDS`), Run Console staff
  codes panel (create / edit / disable / people list / remove).
- play-web: staff console hides what the grant does not allow; reacts to changes.

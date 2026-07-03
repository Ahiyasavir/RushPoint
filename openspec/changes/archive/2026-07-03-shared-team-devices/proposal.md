# Shared Team Devices — proposal

## Why

In team games today one phone *is* the team (`uid == teamId`): only the phone that joined can see
the current task, hints, and progress, and only it can answer. Real teams have 3–6 people who all
want to follow along on their own phones — and if the joining phone dies mid-run, the team is
stuck. This change lets multiple phones attach to one team with live shared state, while exactly
one device at a time (the "controller") can submit — transferable at any moment during the game.

## What Changes

- **Multiple devices per team**: after a team joins, the team gets a short **device join code**;
  teammates enter the run access code + the device code on their own phones and attach to the same
  team as additional devices. All attached devices see the team's live state (current task,
  progress, score, hints already revealed, announcements) in real time.
- **Controller role (server-enforced)**: the team doc carries a `controllerUid`. Only the
  controller's submissions are accepted by the mutating participant callables
  (`completeTask`, `requestNextTask`, `requestTaskHint`, `submitTaskAnswer`, `submitSequenceStep`,
  `verifyStationCode`, `submitStationPhoto`, `checkOutTask`, `updateLocation`). Non-controller
  devices get a typed `permission-denied` and render read-only UI.
- **Transfer & takeover**: a new `transferController` callable lets the current controller hand
  control to any attached device mid-game; a new `claimController` callable lets any attached
  device take control (confirm-gated in UI) so the team is never stuck if the controller phone
  dies. `triggerSOS` stays allowed from **any** attached device (safety).
- **Team-scoped authorization replaces uid-scoped**: participant callables derive the acting team
  from "which team is this uid attached to" instead of `teamId === uid`; Firestore rules let any
  attached uid read its own team doc (client writes stay denied).
- **play-web UI**: a "join an existing team" path on the Join screen; a team-devices panel showing
  the device code, attached devices, and who controls; viewer mode (inputs disabled, live banner
  showing who controls, "take control" action); controller mode gets "transfer control". Full
  HE/EN i18n.

**Not BREAKING**: single-phone teams keep working unchanged (the founding device is the controller
by default; old team docs without the new fields behave as before).

## Non-goals

- No per-member identity/auth (members remain display names; devices are anonymous uids).
- No simultaneous multi-device input, no per-device scoring, no device-level chat/presence.
- No change to scoring, routing, leaderboards, or the staff console.
- No creator-web changes (the creator does not configure or see devices).
- No automatic controller failover (takeover is an explicit user action on another phone).

## Surfaces touched

Shared types (`@rushpoint/shared`) · callables in `functions/` (2 new: `joinTeamAsDevice`,
`transferController`, `claimController` — 3 new; several modified) · `firestore.rules` ·
play-web (Join/Play screens, TaskRunner, store, `services/calls.ts`, `i18n.ts`). New/changed
callables get typed wrappers and e2e coverage.

## Capabilities

### New Capabilities
- `shared-team-devices`: attaching multiple devices to one team via a device join code; live
  shared team state on all devices; the controller role, its server-side enforcement on mutating
  callables, voluntary transfer, and takeover so a team is never stuck.

### Modified Capabilities
- `authorization`: team-scoped callable authorization changes from "the caller's uid IS the
  teamId" to "the caller's uid is attached to the team" (payload `teamId` still never trusted);
  mutating calls additionally require the caller to be the team's current controller.

## Impact

- `functions/src/runs/index.ts` — `joinRun` (init `deviceUids`/`controllerUid`/device code), new
  `joinTeamAsDevice` / `transferController` / `claimController`, team-resolution helper used by all
  participant callables, `getMyTeamState` returns role/devices info.
- `functions/src/index.ts` — station callables (`verifyStationCode`, `submitStationPhoto`),
  `updateLocation`, `triggerSOS` switch to the shared team-resolution helper; re-export new callables.
- `packages/shared/src/types/index.ts` — `RunTeam` gains `deviceUids`, `controllerUid`,
  `deviceJoinCode`, `devices[]`.
- `firestore.rules` — team read allowed for attached uids.
- `apps/play-web` — JoinScreen, PlayScreen, TaskRunner, new TeamDevicesPanel, store, calls, i18n.
- `scripts/e2e-verify.mjs` — multi-device join, viewer rejection, transfer, claim scenarios.
- Tests: co-located vitest for the pure role/resolution logic in `functions/src/runs/`.

# Shared Team Devices — design

## Context

Today one anonymous uid IS the team: `joinRun` creates `teams/{uid}`
([runs/index.ts:253](../../../functions/src/runs/index.ts)), every participant callable derives
`teamId = context.auth.uid` (station callables additionally reject a payload `teamId !== uid`),
`firestore.rules` allow team reads only for `isOwner(teamId)` (the uid itself), owner, or staff,
and play-web's PlayScreen subscribes with `onSnapshot` to `teams/{uid}` + polls `getMyTeamState`
every 12s. The session (`apps/play-web/src/store.ts`) persists `{ownerUid, gameId, runId, code,
displayName}` in localStorage. `RunTeam` (packages/shared) has `memberNames` (display only) — no
device/controller concept.

## Goals / Non-Goals

**Goals:**
- N phones attached to one team, all seeing the same live state (task, progress, hints, score).
- Exactly one controller uid, enforced **server-side** on every mutating participant callable.
- Transfer mid-game (voluntary) + takeover from any attached device (never-stuck fallback).
- Zero behavior change for existing single-phone teams and old team docs.

**Non-Goals:** per-member auth/identity, simultaneous input, device presence/heartbeat,
creator-web surface, scoring/routing changes, automatic failover.

## Decisions

### D1 — Devices live ON the team doc (no new collection)
`RunTeam` gains: `deviceUids: string[]` (all attached uids, founding uid included),
`controllerUid: string`, `deviceJoinCode: string` (6-char, unambiguous alphabet),
`devices: {uid, name, joinedAt}[]` (display metadata).
*Why not a subcollection?* Rules can check membership for free from `resource.data`
(`request.auth.uid in resource.data.deviceUids`) with no `get()` reads; the team doc is already
the single live-sync object PlayScreen subscribes to, so role flips propagate instantly through
the existing `onSnapshot`; and device count is capped (8) so array size is bounded.
Footgun respected: devices are updated by **rewriting the full array** (never dotted paths into
array elements); `deviceUids` may use `FieldValue.arrayUnion` (whole-element, safe).

### D2 — Attach flow: run access code + team device code
`joinRun` (unchanged signature) now also stamps `deviceUids: [uid]`, `controllerUid: uid`,
`devices: [{uid, name: displayName, joinedAt}]`, `deviceJoinCode: generateDeviceJoinCode()`.
New callable **`joinTeamAsDevice({code, teamCode, memberName?})`**: resolves the access code →
run, finds the team by `where('deviceJoinCode','==', normalized(teamCode))` (single-field query,
no composite index), rejects when the run is finished, the code doesn't match, the uid is already
on another team in this run, or the team already has 8 devices; attaches the uid and returns
`{ownerUid, gameId, runId, teamId, role: 'viewer'}`. The device code is team-internal (shared
verbally/on-screen among teammates), not a security secret against the team itself — the access
code still gates entry to the run. *Alternative rejected:* picking a team from a list (leaks team
names to strangers holding only the access code, and enables join-griefing).

### D3 — Team resolution helper replaces `teamId = uid`
New `resolveTeamRefForCaller(uid, ctx)` in `functions/src/runs/teamDevices.ts`:
fast path `get(teams/{uid})` (founding device, covers ALL pre-change teams), else one
`where('deviceUids','array-contains', uid).limit(1)` query. Every participant callable
(`completeTask`, `requestNextTask`, `requestTaskHint`, `submitTaskAnswer`, `submitSequenceStep`,
`checkOutTask`, `getMyTeamState`, `getRecommendedTasks`, and in `functions/src/index.ts`:
`verifyStationCode`, `submitStationPhoto`, `updateLocation`, `triggerSOS`) switches to it. Payload
`teamId` remains untrusted: if supplied and ≠ resolved team id → `permission-denied` (keeps the
existing `authorization` spec guarantee). All writes/downstream logic keep using the **resolved
teamId** (the founding uid), so scoring, leaderboard, staff review, `teamLocations/{teamId}` and
`activeTaskId` occupancy are untouched.

### D4 — Controller enforcement is a pure, tested predicate
`functions/src/runs/teamDevices.ts` exports pure logic:
`resolveDeviceRole(team, uid)` → `'controller' | 'viewer' | null` (a team with no
`controllerUid` — any legacy doc — treats the founding uid, `team.id`, as controller);
`assertController(team, uid)` throws `permission-denied` (message key `not-controller`);
`generateDeviceJoinCode(rng)` (injected rng — deterministic tests);
`canAttachDevice(team, uid)` (cap, duplicates, finished team). Mutating callables call
`assertController` after resolution; read-only callables (`getMyTeamState`,
`getRecommendedTasks`) don't. **`triggerSOS` is exempt** — any attached device can raise SOS
(safety beats role discipline). `updateLocation` is controller-only so the team's map pin follows
the device that is actually playing.

### D5 — Transfer + claim (never-stuck)
**`transferController({...ctx, toUid})`** — caller must be current controller, `toUid` must be in
`deviceUids`; sets `controllerUid` in a transaction. **`claimController({...ctx})`** — any
attached device may take control (transaction; no-op if already controller). Rationale: devices
belong to one physical team standing together; the controller role is a coordination mechanism
within the team, not a security boundary between teammates — the security boundary stays at team
level (`deviceUids`). An unconditional claim guarantees the team is never stuck behind a dead
phone with zero heartbeat infrastructure. The play-web UI gates claim behind a confirm dialog.
*Alternative rejected:* staleness-gated claim needs a heartbeat write per device per poll —
Firestore write amplification for an intra-team trust problem that doesn't exist.

### D6 — Rules: attached uids read their team; writes stay denied
`firestore.rules` team match becomes:
`allow read: if isOwner(uid) || isOwner(teamId) || (isSignedIn() && ('deviceUids' in resource.data) && request.auth.uid in resource.data.deviceUids) || isStaffForRun(...)`; `allow write: if false`
(unchanged). Old docs (no `deviceUids`) keep working via the `isOwner(teamId)` clause. Viewer
devices also need the run doc / announcements / flashMissions reads — those are already "any
authed" per the data model, so no change.

### D7 — play-web: role is derived, never stored
`Session` gains `teamId: string` (needed because uid ≠ teamId for viewers; `getMyTeamState` and
the `onSnapshot` path use it). Role is always derived live: `isController =
team.controllerUid === myUid || (!team.controllerUid && team.id === myUid)` — never persisted, so
a transfer flips every device's UI on the next snapshot with no refetch.
- **JoinScreen**: a mode toggle "create a team / join my team's device" (team-mode games only,
  shown after `getJoinInfo`); the join-device form takes the device code (+ optional name) and
  calls `joinTeamAsDevice`.
- **PlayScreen**: passes `teamId` to the snapshot + state calls; renders a `TeamDevicesPanel`
  (device code + copy, device list, controller badge, transfer buttons for the controller,
  confirm-gated "take control" for viewers) and a compact viewer banner ("viewing — X controls").
- **TaskRunner**: new `readOnly` prop — all inputs/buttons disabled; submissions are also
  server-rejected (defense in depth). Catch the `not-controller` error → toast "control moved to
  another phone" (covers the race where control transfers mid-submit).
- **calls.ts**: wrappers for `joinTeamAsDevice`, `transferController`, `claimController`;
  `MyTeamState` type gains `controllerUid`, `devices`, `deviceJoinCode`, `myRole`.
- **i18n.ts**: all new strings in both HE and EN dictionaries.

## Test strategy (TDD lanes)

1. **Pure logic (RED first)** — co-located vitest `functions/src/runs/teamDevices.test.ts`:
   `resolveDeviceRole` (controller / viewer / legacy doc without controllerUid / stranger uid),
   `assertController` throws for viewer & stranger, passes for controller and legacy founding uid,
   `generateDeviceJoinCode` (length, alphabet excludes ambiguous chars, uses injected rng),
   `canAttachDevice` (cap 8, duplicate uid, finished team, uid already elsewhere handled at
   callable level). Written first, must fail (module doesn't exist), then implemented.
2. **Callable behavior (RED first)** — extend `scripts/e2e-verify.mjs` with a `device2` party:
   `joinTeamAsDevice` happy path (wrong teamCode rejected first), `getMyTeamState` from device2
   shows the same team + `myRole: 'viewer'`, a mutating call from device2 fails
   `permission-denied`, `transferController` → device2 submits successfully & device1 is now
   rejected, `claimController` from device1 restores it, finished-run attach rejected.
3. **UI** — preview tools on :5181 with two anonymous browser contexts (join, attach, observe live
   sync, transfer, takeover) + `npm run i18n:check` / `npm run i18n:check:strict` (zero new PART B).

## Risks / Trade-offs

- [Any teammate can claim control] → intra-team by design; confirm dialog in UI; controller
  change is instantly visible on all devices (snapshot), so surprises are self-correcting.
- [`array-contains` query per callable for viewers] → only on the slow path (controller/founding
  device hits the direct-doc fast path; viewers mostly read). Single-field index, no composite.
- [Race: transfer lands while old controller submits] → server transaction re-reads the team;
  loser gets `not-controller` and the UI toasts + flips to viewer. No state corruption.
- [Old team docs lack `deviceUids`] → rules keep the `isOwner(teamId)` clause; `resolveDeviceRole`
  treats `team.id` as controller when `controllerUid` is missing; `joinTeamAsDevice` on a legacy
  doc backfills the arrays. No migration needed.
- [Device code guessing] → 6 chars from a 31-char alphabet ≈ 887M combos, only meaningful with
  the run access code already in hand, and rate-limited like every callable
  (`enforceRateLimit(uid, 'joinTeamAsDevice')`).

## Migration Plan

Additive fields + additive callables + a widened (still read-only) rule — deploy functions and
rules in any order; old clients ignore the new fields. Rollback = revert rules + stop calling the
new callables; team docs with extra fields remain valid.

## Open Questions

None blocking. (QR deep-link for the device code is a nice follow-up; out of scope.)

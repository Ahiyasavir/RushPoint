## Decisions

### D1: capabilities and what they gate

| Capability | Callables | Notes |
|---|---|---|
| `safety` (always) | `acknowledgeAlert`, `clearTeamOutOfBounds` | cannot be removed |
| `staffChannel` (always) | `sendStaffChannelMessage` | the marshal's line to the organizer |
| `review` | `reviewStationSubmission` (incl. reversal) | |
| `score` | `adjustTeamScore` | the reported example |
| `route` | `skipTaskForTeam`, `forceAssignTask`, `returnTeamTo` (`send-team-back`) | |
| `hold` | `setTeamHold` | |
| `broadcast` | `pushAnnouncement`, `deactivateAnnouncement`, `pushFlashMission` | |
| `chat` | `sendTeamChatMessage` (staff side) | |
| `feed` | `hideFeedItem` | |
| `tasks` | `setRunTaskStatus` | |
| `locations` | read of `teamLocations` (rules) and the staff map | a read capability |
| `contactTeams` | UI only (`quick-dial-and-actions`) | |

Presets offered as shortcuts: **marshal** = chat + hold + locations; **judge** = marshal + review;
**full** = everything. A single declared table `STAFF_CAPABILITY_BY_CALLABLE` in
`packages/shared/src/staffCapabilities.ts` is read by the server gate AND by
`scripts/lib/callableHardening.mjs`, which fails if a staff-reachable callable is missing from it or
an entry names a callable that no longer exists.

### D2: the three layers

1. **Game default** `Game.staffDefaults?: { capabilities: StaffCapability[] }`, edited in the Builder's
   settings as a checklist (always-granted items shown ticked and locked). Absent = full (today's
   behaviour). A top-level game field ⇒ add to `BUILDER_EDITABLE_FIELDS`
   (`apps/creator-web/src/lib/savePayload.ts`); clearing sends ABSENT, never `null`.
   `updateGame`/`importGameFile` validate it (known capability ids only). It is copied with
   duplicate/export like any setting.
2. **Staff code** (a run-scoped `staffInvites` document, the collection that exists today):
   `{ id, pin, label, capabilities, multiUse: true, disabled: false, version, createdAt }`. Created by
   `inviteStaff` (kept as the callable name for compatibility), whose `capabilities` default to the
   game's `staffDefaults` when the console does not send any. The PIN stays a `randomInt` 6-digit
   code; the per-caller and run-wide brute-force lockouts in `staffSignIn` are unchanged and remain the
   guard. Legacy single-use invites (`multiUse` absent) keep single-use semantics.
3. **Person** `runs/{runId}/staffGrants/{staffUid}`: `{ codeId, name, removed: false, joinedAt }`,
   written by `staffSignIn` (a multi-use code is NOT consumed; a single-use legacy one still is).

Resolution: a person's capabilities = their code's `capabilities` ∪ always-granted, unless the grant
is `removed` or the code is `disabled`… with one deliberate exception: **disabling a code stops NEW
sign-ins only**; people already in keep working until removed. (Alternative "disable = kick everyone"
rejected: an organizer closing a code that leaked mid-event must not also lock out the marshals who
are standing at stations.) "Remove everyone on this code" is a separate explicit action.

### D3: enforcement

`assertStaffCan(context, ownerUid, runId, capability)`: owner/admin pass as today. Staff: run scope
(as today), then read grant → code (both through `cachedGetDoc`; their only writers are callables in
the same process, so invalidation is exact on the VPS; in the emulator the cache is off). Refuse if
removed or if the capability is neither always-granted nor in the code. Cost: up to two cached reads
per staff action.

Legacy staff (a valid staff token and no grant document, i.e. signed in before deploy): allowed as
**full** for that run, logged once.

### D4: live changes and reads

Callables are gated live (D3). Firestore rules only see token claims, so:
- `staffSignIn` mints `caps` (the capability list) and `codeId` into the claims.
- The staff console listens to its grant AND its code (rules allow staff to read
  `staffGrants/{request.auth.uid}` and `staffInvites/{codeId}` of their own run, excluding the `pin`
  field in the UI; the pin is already known to them). On a code `version` change it calls
  `refreshStaffSession`, which re-mints a custom token with the current capabilities; on `removed` it
  signs out and says why.
- `removeStaffMember` also calls `admin.auth().revokeRefreshTokens(staffUid)`, so a closed or tampered
  console loses Firestore reads when its ID token expires (≤ 1 hour).
- `teamLocations` staff read requires `'locations' in request.auth.token.caps` (legacy tokens without
  `caps`: allowed, matching D3's legacy rule).

### D5: organizer UI

Run Console → "share and screens" → **Staff codes** panel (replacing the single-PIN card): a list of
codes (label, PIN, permissions summary, number of people, disabled state), "new code" (label +
permissions checklist pre-filled from the game default, presets as one-tap shortcuts), per code: edit
permissions, disable/enable, show people (name, joined, last action from the audit trail), remove a
person, remove everyone.

### D6: staff console

`useStaffGrant()` exposes the capability set; every action is rendered only if allowed (not greyed:
"a disabled button explains nothing"). A marshal without `score` simply has no score control.

## Test strategy

- Pure (`scripts/test-staff-capabilities.ts`): presets, always-granted set, resolution (code caps ∪
  always, removed person, disabled code keeps existing people, legacy), the declared table is total.
- `scripts/test-callable-hardening.ts`: requires a capability declaration per staff-reachable callable.
- `scripts/test-game-presentation.ts`: `staffDefaults` is in `BUILDER_EDITABLE_FIELDS`.
- e2e (`scripts/e2e-verify.mjs`): game with `staffDefaults` excluding `score`; a code created with no
  explicit caps inherits it; two people sign in with the SAME code (multi-use); both denied
  `adjustTeamScore`, allowed `acknowledgeAlert`; `updateStaffCode` adds `score` → both allowed;
  second code "judges" with `review` only: `reviewStationSubmission` allowed, `skipTaskForTeam`
  denied; `removeStaffMember` → that person denied, the other still allowed; disabled code → new
  sign-in refused, existing person still allowed; legacy single-use invite still single-use; legacy
  staff token with no grant → allowed. Owner-only calls from staff remain denied.
- Rules (`scripts/test-rules.mjs`): staff read own grant and own code, not others'; `teamLocations`
  requires `locations` when `caps` is present.
- UI via preview: Builder setting, console codes panel, staff console reacting to an edit without a PIN.

# shared-team-devices Specification (delta)

## ADDED Requirements

### Requirement: Multiple devices can attach to one team
A team created via `joinRun` SHALL receive a short device join code, and additional authenticated
(anonymous) devices SHALL be able to attach to that team via a `joinTeamAsDevice` callable that
takes the run access code plus the device join code. Attached device uids are recorded on the team
document (`deviceUids`, `devices[]`, founding uid included). Attachment MUST be rejected when the
device code does not match a team in that run, when the run or team is finished, when the caller
is already attached to a different team in the same run, or when the team already has 8 devices.

#### Scenario: Second phone attaches with the device code
- **WHEN** a second anonymous uid calls `joinTeamAsDevice` with a valid access code and the team's device join code
- **THEN** the call succeeds with the team's `{ownerUid, gameId, runId, teamId}` and role `viewer`
- **AND** the team doc's `deviceUids` now contains both uids

#### Scenario: Wrong device code is rejected
- **WHEN** `joinTeamAsDevice` is called with a valid access code but a device code matching no team
- **THEN** the call fails with `not-found` and no team doc changes

#### Scenario: Attach to a finished run is rejected
- **WHEN** `joinTeamAsDevice` is called for a run whose status is `finished`
- **THEN** the call fails with `failed-precondition`

### Requirement: All attached devices see live team state
Every attached device SHALL be able to read the full team state: `getMyTeamState` resolves the
caller's team from its attached uid (not `uid == teamId`) and returns the same sanitized state to
every attached device, plus the device metadata (`controllerUid`, `devices`, `deviceJoinCode`,
and the caller's own role). Firestore rules SHALL allow any uid listed in the team doc's
`deviceUids` to read that team doc; client writes remain denied.

#### Scenario: Viewer device reads the same state
- **WHEN** a viewer device calls `getMyTeamState`
- **THEN** it receives the team's current stage/task/progress identical to the controller's view, with `myRole: 'viewer'`

#### Scenario: Viewer device subscribes to the team doc
- **WHEN** a viewer device opens an `onSnapshot` on the team document it is attached to
- **THEN** the read is permitted by security rules
- **AND** a direct client write to that document is denied

### Requirement: Only the controller device can mutate team state
The team document SHALL carry a `controllerUid` (initialized to the founding uid by `joinRun`).
Mutating participant callables (`completeTask`, `requestNextTask`, `requestTaskHint`,
`submitTaskAnswer`, `submitSequenceStep`, `verifyStationCode`, `submitStationPhoto`,
`checkOutTask`, `updateLocation`) MUST reject callers whose uid is attached but is not the current
controller with `permission-denied`, changing no team state. Read-only callables
(`getMyTeamState`, `getRecommendedTasks`) SHALL serve any attached device, and `triggerSOS` SHALL
be accepted from any attached device. Team documents without a `controllerUid` (pre-change docs)
SHALL treat the founding uid (`team.id`) as controller.

#### Scenario: Viewer submission is rejected
- **WHEN** a viewer device calls `submitTaskAnswer` (or any mutating callable)
- **THEN** the call fails with `permission-denied`
- **AND** the team's progress, score, and `activeTaskId` are unchanged

#### Scenario: Controller submission is accepted
- **WHEN** the controller device calls the same callable with valid data
- **THEN** it is processed exactly as a single-phone team's call would be

#### Scenario: Legacy team doc keeps working
- **WHEN** a team doc has no `controllerUid`/`deviceUids` fields and its founding uid calls a mutating callable
- **THEN** the call is accepted as before this change

### Requirement: Control can move between devices mid-game
A `transferController` callable SHALL let the current controller assign `controllerUid` to any
attached device, and a `claimController` callable SHALL let any attached device take control
(never-stuck fallback for a dead controller phone). Both run transactionally. `transferController`
MUST reject a caller that is not the current controller and a target uid that is not attached;
`claimController` MUST reject a caller that is not attached to the team. Role changes take effect
immediately for subsequent calls on all devices.

#### Scenario: Voluntary transfer
- **WHEN** the controller calls `transferController` with an attached `toUid`
- **THEN** the team's `controllerUid` becomes `toUid`
- **AND** a subsequent mutating call from the new controller succeeds while one from the old device fails `permission-denied`

#### Scenario: Takeover when the controller phone dies
- **WHEN** any attached viewer device calls `claimController`
- **THEN** it becomes the controller and can submit, without any action from the previous controller device

#### Scenario: Stranger cannot transfer or claim
- **WHEN** a uid not attached to the team calls `transferController` or `claimController`
- **THEN** the call fails with `permission-denied`

### Requirement: play-web exposes joining, viewing, and control transfer
The Join screen SHALL offer, for team-mode games, a "join my team on this phone" path that
collects the device join code and attaches via `joinTeamAsDevice`. During play, every device
SHALL see the device join code (to invite teammates), the list of attached devices, and which
device controls; viewer devices render the task read-only with a visible "viewing" indicator and
a confirm-gated take-control action; the controller gets a transfer action. Role changes reflect
live without a manual refresh. All new UI text lives in the HE and EN dictionaries (`t.*`), and
a submission rejected with `not-controller` surfaces a localized "control moved" message instead
of a raw error.

#### Scenario: Teammate joins from the Play screen invite
- **WHEN** a teammate enters the access code and then the device code shown on the captain's screen
- **THEN** they land on the Play screen as a viewer seeing the team's current task

#### Scenario: Viewer UI is read-only until control arrives
- **WHEN** a device is a viewer
- **THEN** task inputs and submit buttons are disabled and a "viewing" banner names the controlling device
- **AND** after control is transferred to it, the inputs become enabled without a reload

#### Scenario: Hebrew and English both fully localized
- **WHEN** `npm run i18n:check` runs after the UI change
- **THEN** it reports no PART A errors and no new PART B findings

## Context

`assignNextInActiveStage` (`functions/src/runs/index.ts:3233`) is the single function every
task-assignment path in the backend funnels through:

- `requestNextTask` (participant poll) — `functions/src/runs/index.ts:3576`
- `startTeams`'s post-launch fan-out — `functions/src/runs/index.ts:653`
- `completeTask`'s reassign-on-completion — `functions/src/runs/index.ts:3524`, `:3564`
- `submitStationPhoto` / `submitSequenceStep` follow-on assignment — `:3920`, `:4129`, `:4183`
- the poll sweep in `index.ts` (root) — `functions/src/index.ts:1050`
- the internal retry path — `functions/src/runs/index.ts:2609`, `:1438`

It loads the team document, runs three poll-time maintenance sweeps (scheduled-release unlock,
task-expiry sweep, unreachable-task heal — each of which can itself write the team document and
release a station slot), then routes among the stage's remaining tasks and, inside a retry-wrapped
transaction, atomically claims one: sets its status to `assigned`, stamps `startedAt`, and writes
`activeTaskId` on the team.

The grading path (`completeTaskForTeam`, guarded by `if (team.launched !== true) throw` around
`:805`) already refuses to score work for an unlaunched team. `assignNextInActiveStage` had no
equivalent check, so a held team's device could call `requestNextTask` directly (no launch/consent
check anywhere in that path) and receive a real assignment: a reserved station slot, an
`activeTaskId`, and a map pin to route toward. The team's *submission* would later be refused by
the grading gate, but the routing itself — arguably the more safety-relevant half, since it is what
sends a device toward a real-world location — was ungated.

## Goals / Non-Goals

- **Goal:** close the assignment-side gap with the smallest possible change: one guard clause, one
  choke point, zero new persisted state, zero behavior change for a launched team.
- **Goal:** reuse the existing `canReceiveTaskAssignment` predicate (`consentGate.ts`) rather than
  inlining a second `team.launched === true` check — one definition of "eligible for assignment".
- **Non-goal:** touching the grading gate (`completeTaskForTeam`) — it already does the right thing
  and is out of scope.
- **Non-goal:** any client change. The response shape (`{ taskId, reason }`) and the reason string
  (`'guardian_consent'`) already exist and are already rendered by the held-state UI via
  `getMyTeamState`'s `holdReason` field; `requestNextTask` returning the same string needs no new
  branch client-side.

## Decision

Insert the guard as the first statement after the team document is loaded and confirmed to exist,
**before** any of the three poll-time maintenance sweeps and before the routing/claim transaction:

```ts
const team = teamSnap.data() as RunTeam;

// Guardian-consent gate (consent-gate-routing): a team held on guardian consent
// (`launched !== true`) must never be assigned a task ...
if (!canReceiveTaskAssignment(team)) return { reason: 'guardian_consent' };

// Poll re-check: a scheduled-release stage that has since opened gets unlocked ...
```

**Why here and not deeper (e.g. just before the claim transaction):** the maintenance sweeps above
it are themselves side-effecting writes (they can flip a stage's status, sweep an expired in-flight
task, or retire unreachable tasks) that a held team's device should not be triggering AT ALL — it
should look, from the server's perspective, exactly as if `requestNextTask` were never called.
Placing the guard first guarantees a held team causes zero reads-beyond-the-team-doc and zero
writes.

**Why one choke point instead of a check in every caller:** every caller already goes through
`assignNextInActiveStage` for the actual reservation — there is no second path that increments
`run.taskCounts` or writes `activeTaskId`. A per-caller check would be redundant, harder to keep in
sync, and risks a future new caller forgetting it. The existing single-choke-point structure (see
the WO Item 3 comment already in the function about the claim transaction) is exactly the pattern
this gate follows.

**Why `canReceiveTaskAssignment` and not a fresh inline check:** it already exists, is already unit
tested (`consentGate.test.ts`), is total (never throws, treats any non-`true` `launched` value —
missing, `undefined`, a string, a truthy-but-wrong-typed value — as ineligible), and its doc comment
already describes exactly this use. Reusing it means there is one place that defines "eligible for
assignment" instead of two that could drift.

## Risks / Trade-offs

- **None for a launched team.** `canReceiveTaskAssignment(team)` returns `true` immediately for
  `team.launched === true`, so the guard is a single boolean check that falls through to the
  existing code path unchanged. No new read, no new write, no new transaction on the happy path.
- **A held team's `requestNextTask` now returns a reason instead of silently returning nothing.**
  This is the intended fix, not a regression: the participant device was already showing a held
  screen (via `getMyTeamState`'s `holdReason`); it never had a path that legitimately called
  `requestNextTask` and expected a task back while held.
- **No migration / no new field.** `RunTeam.launched` already exists and is already the field
  `startTeams` and `completeTaskForTeam` key off of.

## Testing strategy

- **Pure predicate:** already covered by `functions/src/runs/consentGate.test.ts` (unchanged by
  this proposal — reviewed, no defect found).
- **Wiring into `assignNextInActiveStage`:** this code is Firestore-transaction-heavy (reads the
  team/run/game docs, runs a retry-wrapped `runTransaction` for the claim) and not practical to
  exercise as an isolated unit test outside the emulator. Covered instead by extending the existing
  `'guardian consent gate'` e2e scenario in `scripts/e2e-verify.mjs`:
  1. A held team calls `requestNextTask` directly (bypassing `startTeams`) and gets
     `{ taskId: null, reason: 'guardian_consent' }`.
  2. `run.taskCounts` for the game's one task is asserted unchanged (still zero) before and after
     the denied call — no slot reserved.
  3. The held team's `activeTaskId` is asserted still unset after the denied call.
  4. After guardian consent is granted and `startTeams` launches the team, the same call
     (`requestNextTask`) is asserted to succeed normally (`taskId` present) — proving the guard
     does not linger or misfire once the team is legitimately launched.

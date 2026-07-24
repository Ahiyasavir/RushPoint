## Why

`completeTaskForTeam` already refuses to grade or score work for a team that has not been launched
(`if (team.launched !== true) throw` around `functions/src/runs/index.ts:805`) — this is how
guardian-consent-qr keeps a held minor's team from scoring anything before a guardian approves. But
the matching gate never existed on the **assignment** side: `assignNextInActiveStage`
(`functions/src/runs/index.ts:3233`), the function every task-assignment entry point funnels
through (`requestNextTask`, `startTeams`'s post-launch fan-out, `completeTask`'s reassign-on-
completion, the poll sweep, `submitStationPhoto`/`submitSequenceStep` follow-on assignment), never
checked `team.launched` before reserving a station slot, stamping `activeTaskId`, and routing the
participant device toward a real-world map pin.

The practical consequence: a held team's device — already signed in, already joined the run, still
sitting in `getMyTeamState`'s "waiting for guardian consent" screen — could call `requestNextTask`
directly and get assigned a real task with a real GPS destination, with zero guardian approval in
the loop. The grading gate meant the team could not have its work *scored*, but nothing stopped the
device from being routed into the field first.

## What Changes

- `assignNextInActiveStage` now checks `canReceiveTaskAssignment(team)` — a small, total, pure
  predicate (`functions/src/runs/consentGate.ts`, `team.launched === true` and nothing else counts)
  — as the very first thing it does once the team document is loaded, before any of its poll-sweep
  side effects (scheduled-release unlock, expiry sweep, unreachable-task heal) or the routing/claim
  transaction that reserves a station slot. A held team gets back `{ reason: 'guardian_consent' }`
  and the function returns immediately: no slot reserved, no `activeTaskId` set, no team-document
  write at all.
- Because every assignment entry point in the codebase calls `assignNextInActiveStage` (there is no
  parallel path that reserves a slot), gating this one function closes the gap everywhere at once —
  no caller needs its own copy of the check.
- `'guardian_consent'` is the exact string already used by `getMyTeamState`'s `holdReason` field
  (`functions/src/runs/index.ts:~4439`), so the client's existing held-state UI renders this
  response with **no client change** — `requestNextTask`'s `{ taskId: null, reason:
  'guardian_consent' }` reads the same way a stalled-station `{ reason: 'stationsFull' }` already
  does.
- A launched team (`team.launched === true`) is completely unaffected: the predicate returns `true`
  immediately and every existing line of `assignNextInActiveStage` runs exactly as it did before.

## Impact

- **Affected specs:** `consent-gate-routing` (new capability spec, this change).
- **Affected code:** `functions/src/runs/index.ts` (`assignNextInActiveStage`, one guard clause);
  `functions/src/runs/consentGate.ts` (already existed — pure predicate, unit-tested, no changes
  needed); `scripts/e2e-verify.mjs` (extends the existing "guardian consent gate" scenario).
- **Risk:** none identified for a launched team — the guard is a no-op false-return check that
  exits before the predicate can be false. The only teams that can be affected are ones with
  `launched !== true`, which by definition were never supposed to be routed in the first place.
- **Testing:** `canReceiveTaskAssignment` is already covered by
  `functions/src/runs/consentGate.test.ts` (pure predicate, all cases). The wiring into
  `assignNextInActiveStage` is Firestore-transaction-heavy and not practical to unit-test in
  isolation, so it is covered end-to-end by a new e2e assertion: a held team's direct
  `requestNextTask` call is denied with no station slot reserved and no `activeTaskId` set, then
  succeeds normally once consent is granted and the team is launched.

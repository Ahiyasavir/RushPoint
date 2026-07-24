## 1. RED/GREEN: pure predicate (already landed)

- [x] 1.1 `functions/src/runs/consentGate.ts` — `canReceiveTaskAssignment(team)`, total, pure,
  `team.launched === true` and nothing else counts. (Pre-existing work; reviewed for this change,
  no defect found — not modified.)
- [x] 1.2 `functions/src/runs/consentGate.test.ts` — unit coverage of the predicate (missing,
  `undefined`, `false`, non-boolean truthy, `null`/`undefined` team). (Pre-existing; reviewed,
  green, not modified.)

## 2. GREEN: wire the guard into the single choke point

- [x] 2.1 In `assignNextInActiveStage` (`functions/src/runs/index.ts`), import
  `canReceiveTaskAssignment` from `./consentGate` (already imported by the prior pass) and, as the
  first statement after the team document is loaded and confirmed to exist, add:
  `if (!canReceiveTaskAssignment(team)) return { reason: 'guardian_consent' };` — before the
  scheduled-release poll re-check, the task-expiry sweep, the unreachable-task heal, and the
  routing/claim transaction.
- [x] 2.2 Confirm every caller of `assignNextInActiveStage` (`requestNextTask`, `startTeams`'s
  fan-out, `completeTask`'s reassign-on-completion, `submitStationPhoto`/`submitSequenceStep`
  follow-on assignment, the poll sweep in `functions/src/index.ts`, the internal retry path) is
  covered by this one insertion point — no caller reserves a slot through any other function.
- [x] 2.3 Confirm `startTeams` is unaffected: it flips `launched: true` in a committed batch write
  BEFORE calling `assignNextInActiveStage` for the newly-launched cohort, and
  `assignNextInActiveStage` re-reads the team document fresh (not the pre-batch snapshot), so the
  guard sees `launched === true` for a team `startTeams` just launched.

## 3. E2E: assignment-side denial + recovery

- [x] 3.1 Extend the existing `'guardian consent gate'` scenario in `scripts/e2e-verify.mjs`: after
  the held team joins (and before `startTeams` is called again), have it call `requestNextTask`
  directly and assert `{ taskId: null, reason: 'guardian_consent' }`.
- [x] 3.2 Assert `run.taskCounts` for the game's task is unchanged (still `{}`/zero) across the
  denied call — no station slot was reserved.
- [x] 3.3 Assert the held team's `activeTaskId` is still unset after the denied call.
- [x] 3.4 After consent is granted and the team is launched, assert the same call
  (`requestNextTask`) now succeeds (`taskId` present) — the gate does not misfire on a launched
  team.
- [ ] 3.5 Run `npm run e2e` against a clean emulator to confirm green. **Not run by this change** —
  the implementing agent was instructed not to start/stop any emulator process; this task is owed
  to whoever next runs the full emulator-bound gate.

## 4. Gates

- [x] 4.1 `npx vitest run functions/src/runs/consentGate.test.ts` — green (predicate unchanged).
- [x] 4.2 `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
  base:check · i18n:check:strict) — green.
- [ ] 4.3 `npm run e2e` / `npm run verify:emulator` — owed (see 3.5), not run by this change.

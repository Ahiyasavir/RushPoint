## 1. RED — establish what is actually asserted

- [x] 1.1 Inventory the diff: `git diff 5a204f1 -- scripts/e2e-verify.mjs`, grouped by the scenario
      each hunk lives in and the lane that authored it (five lanes; see design's Context table).
- [x] 1.2 Reconcile EVERY asserted response field against the callable that produces it in
      `functions/src/**` / `packages/shared/src/**`. Record the producing `return` for each:
      `submitTaskAnswer`, `answerCostDisplay`, `clearTeamOutOfBounds`, `updateLocation`,
      `listRunTeams`, `pruneExpiredRunDataNow` / `pruneRunPII`, `createGame` / `updateGame` /
      `publishGame` / `searchGallery` / `searchTaskLibrary`, `importGameFile` / `parseGameFile`.
- [x] 1.3 Falsifiability pass: for every added assertion, name the regression that makes it fail.
      Anything with no such regression is a defect — list it with its line number.
- [x] 1.4 Reachability pass: hand-simulate each assertion's preconditions against the implementation
      state machine (does control actually reach the branch being asserted?).
- [x] 1.5 Isolation pass: confirm every added assertion builds the state it reads and does not
      inherit it from an earlier scenario.
- [x] 1.6 Allowlist drift: diff `Task` / `SmartStationConfig` against `ALLOWED_TASK_KEYS` /
      `ALLOWED_SMART_KEYS` via the surface `sanitizeTaskForParticipant` actually emits (`...rest` +
      synthesized keys). Confirm no entry is missing AND no entry was wrongly added.
- [x] 1.7 Coverage arithmetic: enumerate every `loggedCallable('…')` under `functions/src/**` and
      intersect with `call('<name>'` in the suite, counting authz-matrix rows (latency is recorded in
      a `finally`, so a denied call still registers). Report any callable with no scenario.

## 2. GREEN — repair, conservatively

- [x] 2.1 `game file export/import`: rewrite the forbidden-key refusal to carry `constructor`
      instead of `__proto__`, and write the transport reasoning (D1) into the file so it is not
      "fixed" back. Do not touch the other three hostile-file refusals — they were verified correct.
- [x] 2.2 `safe-zone boundary`: give the low-confidence assertion its own un-overridden participant
      (`blurry`) and pin `reason === 'low_confidence'` (D2).
- [x] 2.3 `safe-zone boundary`: tighten the grace-window assertion to `reason === 'override'` so it
      cannot be satisfied by a fix that simply landed inside the zone (D2).
- [x] 2.4 `safe-zone boundary`: tighten "released team is assigned a task again" to require a string
      `taskId`, not merely the absence of `outOfBounds` (D4).
- [x] 2.5 `callable coverage`: seed a `teamLocations` ping before the retention sweep and assert the
      fixture took, so the "pings are gone" check is falsifiable (D3).
- [x] 2.6 `callable coverage`: assert the sweep's own `results` name the back-dated run, so
      `ok: true` from unrelated runs cannot carry the check (D3).
- [x] 2.7 Confirm NO assertion was weakened and no `EXEMPT` entry was added. Anything ambiguous keeps
      its stricter form and is reported instead.
- [x] 2.8 `node --check scripts/e2e-verify.mjs` — green.

## 3. REFACTOR — leave the reasoning behind

- [x] 3.1 Every repair carries an inline comment naming WHY the previous form could not fail (or
      could not pass), so the next blind author does not revert it.
- [x] 3.2 No scenario re-ordering, no shared-fixture extraction, no cross-scenario helper: each
      repair stays inside the scenario that owns it.

## 4. Coverage restoration — `setRunTaskStatus` (change: live-task-pause)

- [x] 4.1 Re-run the coverage arithmetic after tonight's later merges: enumerate every callable
      re-exported from `functions/src/index.ts` (domain modules + root) and intersect with
      `call('<name>'` in the suite. Result: **one** uncovered callable, `setRunTaskStatus`.
      `clearTeamOutOfBounds` was re-verified as genuinely covered (safe-zone scenario, both the
      participant denial and the owner release, plus the grace-window follow-up), not assumed.
      `skipStage` is covered only through an authz-matrix row — which registers, because latency is
      recorded in a `finally`.
- [x] 4.2 Read the implementation BEFORE asserting: `setRunTaskStatus` in `functions/src/index.ts`,
      `planTaskStatusChange` / `effectiveTaskStatus` / `isTaskAssignable` in
      `packages/shared/src/liveTaskStatus.ts`, the three routing filters in
      `functions/src/routing/assignNextTask.ts` (`assignTask`, `buildRecommendations`,
      `classifyNoAssignment`), `Run.taskStatusOverrides` in `packages/shared/src/types/index.ts`, and
      `writeAuditLog` in `functions/src/obs/audit.ts` (spreads the entry, so `taskId`/`forced`
      persist).
- [x] 4.3 Routing: pause the task that routing would otherwise ALWAYS pick (it sits on the team,
      the other is ~2.2 km away, and `fixed_points_speed` scores `0.6·load − 0.4·transit` with equal
      load) and assert three consecutive `requestNextTask` calls return the far one — so "the pause
      ran" is distinguishable from "the sort order happened to differ". Resume, assert it wins again.
- [x] 4.4 Same for `status: 'closed'`, on a SECOND run of the same game, plus
      `getRecommendedTasks` omitting it while still offering the others.
- [x] 4.5 Run scope: the run-1 override is unaffected by the run-2 change, and the game TEMPLATE
      task still carries no `status`.
- [x] 4.6 Holder not stranded: assign a cap-1 station, pause it, assert the holder still completes
      it (`ok`, not `already`), is SCORED, and `run.taskCounts` returns to 0 (no slot leak).
- [x] 4.7 Unwinnable guard: `requiredTaskCount: 2` of 2 → `failed-precondition` with
      `details.code === 'stageUnwinnable'`, `availableCount: 1`, `requiredCount: 2`;
      `run.taskStatusOverrides` byte-identical before/after; `force: true` applies it and still
      reports `stageUnwinnable`.
- [x] 4.8 Audit: the forced change records `forced: true` + `previousValue`/`newValue` + the
      operator reason; an ordinary pause records `forced: false`.
- [x] 4.9 Authz: three rows added to the existing table-driven denial matrix (participant,
      stranger, other-run staff), plus a post-sweep assertion that the denied calls wrote no
      override. The ALLOWED side (owner throughout, and a staff token scoped to THIS run) is proven
      inside the new scenario, because the matrix is denial-only by construction.
- [x] 4.10 Invalid value: `status: 'disabled'` → `invalid-argument`, overrides byte-identical and
      no key created; a repeated same-status call returns `noop: true` with a truthful
      `previousStatus`.
- [x] 4.11 No vacuous assertions: every check names a regression that makes it fail. No
      value-compared-to-itself, no bare truthiness on a response object, no field the response never
      contains, no condition already guaranteed by the line above it.

## 5. Gates

- [x] 5.1 `node --check scripts/e2e-verify.mjs` — the only executable verification available.
- [ ] 5.2 `npm run e2e` — **BLOCKED, NOT RUN.** A live playtest stack owns the emulator; this lane is
      forbidden to start, stop or restart any emulator, Vite, tunnel or backup process. The parent
      agent runs this when the emulator is free. **The suite is UNRUN.**
- [ ] 5.3 `npm run verify:emulator` — **BLOCKED, NOT RUN**, same reason.
- [x] 5.4 Confirm the change touches `scripts/e2e-verify.mjs` and nothing else: no `functions/**`,
      `apps/**`, `packages/**`, rules files or other scripts. Implementation defects found are
      REPORTED (design D1 note, Open Questions), not patched.
- [x] 5.5 `npx openspec validate e2e-suite-coherence --strict` — green.

## 6. Owed assertions from the second wave of lanes (written, still UNRUN)

Six further lanes finished after section 4 and each REPORTED the e2e coverage it owed but could not
write (they were barred from this file). Every assertion below was reconciled against the
implementation FIRST â€” an assertion against a field that does not exist wastes the one emulator
window as surely as a vacuous one.

### 6.A `pause-clock-tasks`

- [x] 6.A.1 Read before asserting: `packages/shared/src/pausedClock.ts` (`taskExcludedMs`,
      `teamExcludedMs`, `adjustedElapsedSeconds`), the stamp site in `completeTaskForTeam`
      (`functions/src/runs/index.ts` â€” `startedAt = taskRec.startedAt ?? team.startedAt ?? now`,
      stamped only when `gameTask.pausesTimer`), the consumption site in `buildRankings`, and
      `computeSkillRatio`'s `excludedMs` presence test in `routing/assignNextTask.ts`.
- [x] 6.A.2 Verified `'pausesTimer'` was ALREADY in `ALLOWED_TASK_KEYS` (added by the parent) and
      NOT duplicated. Confirmed it reaches the wire through `sanitizeTaskForParticipant`'s `...rest`.
- [x] 6.A.3 New scenario `pause-clock tasks (excluded time Â· parity Â· idempotence Â· template edit)`,
      F1: a `time_only` partial stage with a paused and an unpaused alternative. The Hare finishes
      first on the wall clock, the Tortoise deliberates ~2.6 s on the paused task. Asserted:
      a positive `excludedMs` stamp on the paused record, NO stamp on the unpaused one, that the
      Tortoise's wall clock really is longer (the premise, asserted not assumed),
      `durationSeconds == wall âˆ’ excluded` (Â±1 s, both terms read off the TEAM DOCUMENTS), and that
      the Tortoise takes rank 1.
- [x] 6.A.4 Oracle extension in `assertLeaderboardInvariants` (applies to EVERY board the suite
      builds): a finished entry always carries a finite `durationSeconds`; every present
      `durationSeconds` is finite and `>= 0`; and â€” when the caller supplies the independently-read
      `startedAt` map â€” no finished team's `durationSeconds` exceeds its own wall clock. The map
      parameter is optional, so all existing call sites are unchanged.
- [x] 6.A.5 Live/final parity, F4: `refreshLeaderboard` then `finalizeRun` with no activity between,
      compared entry-for-entry on `{ teamId, rank, score, durationSeconds }` â€” not merely on
      ordering, which would pass while every duration drifted.
- [x] 6.A.6 Idempotence, F2: a repeated `completeTask` on the paused task returns `already: true`,
      the stamped `excludedMs` is unchanged, and the ranked `durationSeconds` is unchanged.
- [x] 6.A.7 Mid-run template edit, F3: `updateGame` clears `pausesTimer` on a live run; the edit is
      asserted to have LANDED, then both teams' `durationSeconds` are asserted unchanged and the
      stamp is asserted to survive. This is the live/final drift guard â€” re-deriving from the
      template would silently add the deliberation back onto a finished team.
- [x] 6.A.8 All-paused run, F5: every duration floors at exactly `0`, ranks stay contiguous, scores
      finite, response has no non-finite numbers. Also the deterministic place where the
      participant-visible `pausesTimer` flag is asserted ON THE WIRE (single task â‡’ guaranteed
      assigned; task-visibility gating omits unassigned tasks).
- [x] 6.A.9 Station contention, F6: a cap-1 paused stop is asserted to HOLD its slot
      (`taskCounts == 1`) and then to RELEASE it (`== 0`) on completion, with the excluded span
      still stamped. A "returns to 0" check alone would pass on a task that was never reserved.

### 6.B `task-duration-defaults`

- [x] 6.B.1 Verified `expectedDurationMinutes` was ALREADY in `ALLOWED_TASK_KEYS`; not duplicated.
- [x] 6.B.2 New scenario `authored expectedDurationMinutes is validated at the save door`:
      a valid `4` is stored verbatim (the control case, without which the refusals below would also
      pass if the door rejected the field outright), `-5` / `NaN` / `'10'` are each refused
      `invalid-argument`, and a refused save leaves the previously stored value intact.
- [x] 6.B.3 Documented in the file that `NaN` reaches the server as `null` (JSON has no NaN), so the
      NaN case exercises the `typeof !== 'number'` arm of `gameStructureProblems` â€” a real arm a
      hand-written client hits, not a test of the SDK.
- [x] 6.B.4 The same two refusals on the FILE door, inside the export/import scenario, via the
      existing `withTaskOverride` helper (`parseGameFile`'s range check and its `TASK_FIELD_TYPES`
      check respectively).

### 6.C `held-team-visibility`

- [x] 6.C.1 Read before asserting: `startTeams`' `partitionTeamsByConsent` return
      (`{ launched, heldForConsent }`), `getMyTeamState`'s `holdReason` (`'guardian_consent' | null`,
      derived from the same `isConsentSatisfied` predicate) and `listRunTeams`' per-row
      `heldForConsent` boolean.
- [x] 6.C.2 Extended the existing `guardian consent gate` scenario (its fixtures already fit): a
      SECOND, un-consented team joins after the first is approved, so the run carries one held and
      one started team at once â€” which is what makes "exactly the held team" a real comparison.
- [x] 6.C.3 Asserted: `startTeams` reports `{ launched: 0, heldForConsent: 1 }`; the held team's
      `holdReason === 'guardian_consent'` with `launched !== true`; the approved team on the SAME
      run reports `holdReason === null`; `listRunTeams` flags exactly the held id; the started
      team's row is `false`; and the hold explanation carries no guardian identity.
- [x] 6.C.4 Release: a second consent grant + `startTeams` â‡’ `holdReason` clears to `null` and no
      console row is flagged.
- [x] 6.C.5 Consent-OFF control on its OWN fixture (not the shared lifecycle run, which would break
      scenario isolation): `holdReason` is `null` both BEFORE and after `startTeams`, so "held for
      consent" stays distinguishable from "the host hasn't pressed start".

### 6.D `photo-review-throughput`

- [x] 6.D.1 Read before asserting: `reviewStationSubmission` (`functions/src/index.ts`) â€” the
      team-existence guard, the `merge: true` submission write, and the `completed`-gated scoring
      and feed write.
- [x] 6.D.2 New scenario `photo review throughput (out-of-order Â· re-approval Â· finished team)`:
      two teams pending on the SAME task with a real 1.1 s gap; reviewing the NEWER leaves the older
      `pending` and unscored, while the reviewed team IS scored and keeps its own photo url.
- [x] 6.D.3 Re-approving an already-approved submission: resolves `ok`, does not score twice, does
      not emit a second feed item. (The feed scenario already proves this on the AUTO-approve path;
      this proves it on the MANUAL path, which is the one a reviewer double-taps.)
- [x] 6.D.4 A submission from a team that has already FINISHED (it finished via the partial stage's
      self-report alternative, auto-skipping the pending photo) still reviews without throwing,
      resolves the row to `approved`, and does not re-score.
- [x] 6.D.5 Reported as a boundary, not asserted: a review after `finalizeRun` is REJECTED
      (`failed-precondition`, the run-level guard inside `completeTaskForTeam`), which is a
      different and already-covered contract. See design D8.

### 6.E `expose-enforced-settings` / safe zone

- [x] 6.E.1 Read before asserting: `validateSafeZone` (three-valued; rebuilds the boundary), the
      `FieldValue.delete()` clear in `updateGame`, and `importGameFile`'s layer-3b reuse of the same
      validators plus its `failed-precondition` consent refusal.
- [x] 6.E.2 Extended the `safe-zone boundary` scenario: the fixture's stored 200 m boundary is
      asserted present FIRST, then `updateGame({ safeZone: null })`, then the field must be ABSENT â€”
      key absence, because `safeZone: undefined` on the wire is exactly what the silent-no-op bug
      produced and a falsiness check would have passed while it was live.
- [x] 6.E.3 Same scenario: a non-finite centre and a `0` radius are each refused
      `invalid-argument`, and a follow-up read asserts the refusals wrote nothing.
- [x] 6.E.4 Import door, inside the export/import scenario: NaN centre and `0` radius refused
      `invalid-argument`; `requiresGuardianConsent: true` refused `failed-precondition`; and an
      ACCEPTED zone is stored as exactly `center{lat,lng}` plus `radiusMeters` â€” compared by KEY SET
      so Firestore's map-key ordering can neither break nor accidentally satisfy it.

### 6.F `run-console-attention`

- [x] 6.F.1 No `listRunTeams` row allowlist existed, so one was created:
      `ALLOWED_RUN_TEAM_ROW_KEYS` plus `assertRunTeamRowAllowlisted`, pinned to the exact set of keys
      the handler returns today. Rationale in the file: the row is projected BY HAND from a team
      document carrying answer attempt counters, device uids, consent records and raw submission
      urls, so a future spread of the whole document would ship all of it to every staff console
      with nothing failing.
- [x] 6.F.2 The three attention keys are asserted PRESENT independently of the allowlist (an
      allowlist cannot catch a field being silently DROPPED, and a console reading `undefined`
      renders "no evidence" forever â€” the exact silent failure the change removes).
- [x] 6.F.3 Applied in the core lifecycle, where the team has really been playing: `updatedAt` is
      compared against the team DOCUMENT's own `updatedAt` (an independent source, not the row
      compared to itself), and `answerLockoutUntil` / `lastLocationAt` are asserted `null` because
      that team has been charged no wrong answer and has sent no GPS ping in this run â€” verified by
      reading the lifecycle, which calls neither `submitTaskAnswer` nor `updateLocation` before this
      point.
- [x] 6.F.4 Also applied to every `listRunTeams` row in the guardian-consent scenario.

### 6.G Gates for this section

- [x] 6.G.1 `node --check scripts/e2e-verify.mjs` â€” green.
- [x] 6.G.2 No vacuous assertion added: every check compares two independently produced values or a
      response field against a specific expected value. Where a premise could have made a check
      unfalsifiable it is asserted first (the Tortoise's longer wall clock; the cap-1 slot being
      held before it is released; the valid `expectedDurationMinutes` control; the fixture's stored
      safe zone before the clear).
- [x] 6.G.3 `scripts/e2e-verify.mjs` is the ONLY file changed. No `functions/**`, `apps/**`,
      `packages/**`.
- [ ] 6.G.4 `npm run e2e` â€” **BLOCKED, NOT RUN.** The live playtest stack still owns the emulator.
      **These assertions are written-but-unexecuted; the suite is UNRUN.**
- [x] 6.G.5 `npx openspec validate e2e-suite-coherence --strict` â€” green.


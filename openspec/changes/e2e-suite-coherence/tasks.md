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

## 4. Gates

- [x] 4.1 `node --check scripts/e2e-verify.mjs` — the only executable verification available.
- [ ] 4.2 `npm run e2e` — **BLOCKED, NOT RUN.** A live playtest stack owns the emulator; this lane is
      forbidden to start, stop or restart any emulator, Vite, tunnel or backup process. The parent
      agent runs this when the emulator is free. **The suite is UNRUN.**
- [ ] 4.3 `npm run verify:emulator` — **BLOCKED, NOT RUN**, same reason.
- [x] 4.4 Confirm the change touches `scripts/e2e-verify.mjs` and nothing else: no `functions/**`,
      `apps/**`, `packages/**`, rules files or other scripts. Implementation defects found are
      REPORTED (design D1 note, Open Questions), not patched.
- [x] 4.5 `npx openspec validate e2e-suite-coherence --strict` — green.

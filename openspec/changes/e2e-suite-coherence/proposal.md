## Why

Overnight, roughly a dozen independent lanes each appended assertions to
`scripts/e2e-verify.mjs`, and **not one of them could run the suite** — a live playtest stack owned
the emulator all night, so `npm run e2e` was forbidden. The file is therefore a pile of
written-but-never-executed edits from many authors who could not see each other's work.

That is a specific failure mode, not a vague worry. Verified by reading the diff against `5a204f1`
alongside the implementations it asserts against:

1. **An assertion that could never pass.** The import-hardening lane asserted that a `__proto__` key
   nested in task media is refused with `invalid-argument`. It cannot be: both the client encoder
   (`@firebase/util` `mapValues`) and the server decoder (`firebase-functions` `decode`) rebuild
   every object with `obj[k] = …`, and for the key `"__proto__"` that assignment hits
   `Object.prototype`'s **setter** — it re-points the new object's prototype and creates no own
   property. The key is gone before the callable body sees it, so `scanCandidateGraph` never sees a
   forbidden key, the import **succeeds**, and both that `expectError` *and* the following
   "no half-game was written by any refusal" count check fail. One unrunnable assertion, two red
   checks, neither about the guard under test.
2. **Assertions that cannot fail.** The out-of-bounds lane asserted "a low-confidence fix is not
   treated as a breach" on a team that was, at that moment, inside an active staff override — and
   `override` is the FIRST branch of `evaluateSafeZoneStatus`, outranking every sensor rule. The
   check passes for a reason unrelated to accuracy and would keep passing if the confidence rule
   were deleted outright. Similarly, "abandoned-run prune removes its raw GPS pings" asserted
   `teamLocations` is empty in a scenario that never calls `updateLocation` — it read 0 before and 0
   after; and "released team is assigned a task again" only asserted the ABSENCE of an
   `outOfBounds` flag that the success path of `requestNextTask` does not return at all.
3. **The callable coverage guard is a live tripwire.** It fails the run if any deployed callable was
   never invoked, so tonight's new `clearTeamOutOfBounds` would have shipped RED without a scenario.

A test that fails loudly in the morning is fine. A test that passes vacuously is worse than no test:
it reports safety it does not provide, and it does so in the one suite this repo trusts to catch
callable regressions.

## What Changes

**Every assertion added while the suite could not run is reconciled against the implementation it
targets — statically, by reading the callable.**

- Each asserted response field is checked to exist, with the shape asserted, in the callable that
  produces it (`retryAfterMs` / `retryAfterSeconds`, `answerCost.cooldownRemainingMs` and the
  deprecated `cooldownUntil`, `clearTeamOutOfBounds`'s `{ ok, overrideUntil }`, `listRunTeams`'s
  projected `outOfBounds`, `updateLocation`'s `{ outOfBounds, reason }`, the retention sweep's
  `piiPrunedAt` and per-run `results`, normalized `tags` on `publicGames` / `publicTasks` and back
  out of `searchGallery` / `searchTaskLibrary`, and the import refusal shapes).
- Every deployed callable is confirmed to be invoked somewhere in the suite, so the coverage guard
  is known-satisfiable before the emulator is ever available.
- The participant sanitizer allowlists (`ALLOWED_TASK_KEYS` / `ALLOWED_SMART_KEYS`) are reconciled
  against the CURRENT `Task` / `SmartStationConfig` shape — a missing entry fails the run, and a
  wrongly-added entry silently permits a leak, which is worse.

**An assertion that cannot fail is treated as a defect and repaired, never deleted.**

- A check whose stated subject is masked by a stronger earlier rule gets its **own fixture** so it
  exercises the rule it names.
- A check on an empty collection gets the collection **seeded first**, plus a fixture assertion that
  the seeding worked — so "it disappeared" can only pass if something was there to disappear.
- A check that only asserts the absence of a flag is tightened to assert the positive outcome.

**Assertions are repaired toward the behavior the callable's code actually supports, never weakened
to make a green run likelier.** Where the intended behavior is unclear, the stricter form stays and
the ambiguity is reported rather than silently resolved.

### Non-goals

- **No product behavior changes.** No callables, no Firestore rules, no `packages/shared` types, no
  `functions/**`, no creator-web, no play-web, no UI, no i18n. The only file touched is
  `scripts/e2e-verify.mjs`.
- **Does not run the suite.** The emulator is owned by a live playtest stack; `npm run e2e`,
  `verify:emulator`, `test:rules`, `simulate` and `playtest` are all out of bounds for this change,
  and nothing here may start or stop an emulator, Vite, tunnel or backup process. The suite remains
  **UNRUN**.
- **Does not relax any assertion** to raise the odds of a green run, and does not add exemptions to
  the callable coverage guard's `EXEMPT` map.
- **Does not fix implementation defects it finds.** A defect in `functions/**` is reported, not
  patched, because a test lane must not edit the thing it is judging.
- **Does not restructure the suite** (no scenario re-ordering, no shared-fixture extraction). Every
  repair stays inside the scenario that owns it.

## Capabilities

### New Capabilities

- `e2e-verification-integrity`: the end-to-end suite is itself verifiable **without being executed**
  — every asserted response field corresponds to a real field of the callable that produces it,
  every assertion is falsifiable (it fails when the behavior it names regresses), every scenario
  builds the state it asserts on rather than inheriting it, the sanitizer allowlists track the real
  `Task` shape, and every deployed callable is invoked so the coverage guard can be satisfied.

## Impact

- **Surfaces touched:** `scripts/e2e-verify.mjs` only. **No** shared types, **no** callables, **no**
  Firestore rules, **no** creator-web/play-web, **no** i18n.
- **Callables:** none added or changed. `clearTeamOutOfBounds` (added tonight by the
  out-of-bounds-recovery lane) is confirmed covered by the safe-zone scenario, so the coverage guard
  has no gap to fill.
- **Risk:** the repairs make three previously-unfalsifiable checks able to fail. That is the point —
  but it means the first real run may go red on behavior nobody had actually verified. Every such
  repair is asserted against the implementation's own code, and the reasoning is written into the
  file at the assertion, so a red check in the morning is diagnosable rather than mysterious.
- **Testing:** static only — `node --check scripts/e2e-verify.mjs` for syntax, plus reading
  `functions/src/**` and `packages/shared/src/**` for every asserted field. The parent agent runs
  `npm run e2e` when the emulator is free; until then this change is explicitly UNVERIFIED AT
  RUNTIME and says so.

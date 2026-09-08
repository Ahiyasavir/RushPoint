# Smart E2E Suite — proposal

## Why

`scripts/e2e-verify.mjs` is a single-player, strictly sequential "approved path" walk. It cannot
see the bug classes most likely to hurt a live event:

- **Concurrency is never exercised.** Every task declares `maxConcurrentTeams`, yet no test ever
  races two teams for one station. The station-cap bookkeeping (`assignTask` in
  `routing/assignNextTask.ts`) uses a read-then-increment (not a transaction), so the cap can be
  exceeded under simultaneous `requestNextTask` calls — invisible to the current suite.
- **No cross-cutting invariants.** `buildRankings()` is shared by `refreshLeaderboard` and
  `finalizeRun` precisely so live/final standings can't drift — but no test compares them on the
  same run, and nobody asserts rankings are sorted, ranks contiguous, or that
  `scoreBreakdown.total` sums match `earnedScore`/`team.score`.
- **The sanitizer is tested as a blocklist.** We assert known secrets are absent; a NEW secret
  field added to `Task` would sail through to participants with the suite green.
- **One throw kills the whole suite.** An uncaught callable error aborts every scenario after it,
  hiding downstream failures and making triage slow.
- **Tautological checks** (e.g. `check('updateGame accepted 3 stages', true)`) assert nothing.
- **`scripts/simulate-tournament.mjs` targets the archived v1 model** (`artifacts/...` paths,
  `upsertStation`, crafting) — it is dead weight giving false confidence that a load test exists.

## What Changes

- **Scenario harness** in `e2e-verify.mjs`: independent blocks run inside `scenario(name, fn)` —
  a throw fails that scenario and the suite continues; per-scenario check counts + duration and a
  grouped end-of-run summary; `check` failures capture the callable error code; per-callable
  latency percentiles reported at the end.
- **Invariant oracle + parity scenario**: a 3-team run with divergent scores asserts leaderboard
  well-formedness (sorted, contiguous ranks, no lost/duplicated team, finite scores), per-task
  `scoreBreakdown` sums, `Σ task.earnedScore == team.score`, and that `refreshLeaderboard`
  ordering equals `finalizeRun` ordering on the same state.
- **Contention scenario (RED first)**: 3 teams concurrently request tasks in a stage of cap-1
  stations → `run.taskCounts[t] ≤ maxConcurrentTeams`; concurrent duplicate submissions
  (`verifyStationCode` ×2, `completeTask` ×2) score exactly once.
- **Backend fix (GREEN)**: make `assignTask`'s cap check + increment transactional so the cap
  holds under concurrency.
- **Sanitizer allowlist**: participant task payload keys (top-level and `smart.*`) must be a
  subset of an explicit allowlist — new fields fail loud instead of leaking silently.
- **Table-driven authz matrix**: participant/stranger × owner-only callables → typed denial, in
  one data-driven block that's trivial to extend when a callable is added.
- **Boundary fuzz (seeded)**: quiz answers under random casing/whitespace, numeric tolerance at
  the exact boundary, geofence check-ins just inside vs just outside the radius.
- **v2 load simulator** `scripts/simulate-run.mjs` (N teams, concurrent, seeded, invariant audit
  at the end) wired as `npm run simulate`; the v1 tournament script moves to `simulate:v1` with a
  deprecation header.
- **Callable coverage guard** — the e2e introspects the callables the emulator actually serves
  (from the built `functions/lib`) and fails if any `callableTrigger` was never invoked by the
  suite (positively or via the authz matrix), minus an explicit `EXEMPT` list. A newly added
  callable ships RED until it has a test. Suite currently at 66/66.
- **Property/invariant unit tests** (`functions/src/__property__/invariants.property.test.ts`) —
  fast, no-emulator, seeded-random invariants for the most bug-prone pure logic (buildRankings
  well-formedness/ordering/determinism, scoring bounds + monotonicity, answer/geo boundaries,
  rate-limit cap, haversine metric). Gives agents millisecond RED/GREEN with a reproducible seed.
- **`npm run verify`** (fast gauntlet) + **`npm run verify:emulator`** (builds → e2e → rules →
  8-team simulate under a self-booted suite) — one command each for agents. CI's emulator job also
  gains an 8-team concurrent-load smoke.

### Defects the new suite found (and this change fixes)

1. **Emulator authorization bypass** — `assertStaffOrOwner`, `assertAdmin` (×2) and `inviteStaff`
   skipped their check when `FUNCTIONS_EMULATOR=true`, so staff/owner/admin authz was UNTESTABLE;
   the matrix proved a participant could adjust scores, mint staff PINs, approve submissions,
   push announcements, prune runs, and read audit logs in dev. Bypass removed; the e2e now mints
   a real `admin` custom-token claim and real staff tokens.
2. **Staff PIN escaped its run** — the staff token carries a `runId` claim but
   `assertStaffOrOwner` never checked it: a PIN from run B granted live-ops power over EVERY run
   of the owner. Now run-scoped at all six call sites.
3. **Run-doc lock timeouts under burst load** — with 12 concurrent teams the `taskCounts`
   transactions queued on the single run-doc lock and Firestore aborted
   ("10 ABORTED: Transaction lock timeout"), surfacing to players as opaque INTERNAL errors.
   Added `withLockRetry` (jittered backoff) around assign/release.
4. **Station-cap race** (read-then-increment in `assignTask`) — made transactional; `releaseTask`
   hardened against decrement races too.
5. **`incrementTaskCopyCount` threw INTERNAL** — it used `require('firebase-admin')` inside an
   esbuild-bundled function, unresolvable at runtime, so every gallery copy-count 500'd. The
   **coverage guard** surfaced it the moment the callable was first exercised. Switched to the ESM
   `FieldValue` import + `set({merge})` so a missing denorm doc self-heals.
6. **`taskScoreSmart` returned a negative score for a negative difficulty** — it guarded non-finite
   inputs but not a negative difficulty, which would silently subtract from a team's total. The
   **property test** found it; difficulty is now clamped to `>= 0`.

**Not BREAKING**: the e2e keeps its CLI contract (`npm run e2e`, exit 0 iff all pass) and all
existing assertions; product behavior changes only where a real defect is fixed (station cap
under concurrency).

## Non-goals

- No UI/component testing changes (preview-tool lane is unchanged).
- No CI wiring changes beyond keeping existing gates green.
- No rewrite of `test-rules.mjs` (already covers rules isolation well).
- The load simulator is an operator tool, not a required gate.

## Capabilities

### New Capabilities
- `e2e-verification`: scenario isolation, invariant oracle, concurrency/contention coverage,
  sanitizer allowlist, authz matrix, boundary fuzz, and a v2 load simulator.

### Modified Capabilities
- `smart-routing`: the station-cap increment becomes transactional (cap holds under concurrent
  assignment) — same routing semantics otherwise.
- `authorization`: emulator bypasses removed (guards run identically everywhere) and staff
  tokens are scoped to the run named in their claims.

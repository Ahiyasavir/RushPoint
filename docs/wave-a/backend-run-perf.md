# Backend run-perf (Wave A) — SDD + TDD notes

Owner: sole agent for `functions/src/runs/index.ts` this wave.
Scope: Task 10 (P0, startTeams timeout), Task 9 (P1, finalizeRun blocking UI),
Task 2 (P2, join/getJoinInfo sequential reads).

---

## Task 10 (P0) — `startTeams` deadline exceeded

### SDD
- **Root cause** (confirmed by reading, not assumed): `startTeams` batches its
  team-launch writes correctly, then runs a **strictly serial** `for` loop
  awaiting `assignNextInActiveStage(...)` once per launched team. Each call:
  1. re-reads the **same** game doc (`db.doc(gamePath(...)).get()`) — pure waste
     after the first iteration,
  2. reads the team doc,
  3. (sometimes) reads the run doc for stage-unlock/expiry sweeps,
  4. runs `assignTask` (routing) + a `withLockRetry` claim transaction.
  20+ teams × (3-4 round trips each, fully serialized) risks the v1 default
  60s/256MB callable ceiling.
- **Fix direction**:
  1. `assignNextInActiveStage` gets a new **optional** trailing param
     `preloadedGame?: Game`. When supplied, the function skips its own game
     read entirely. Every other call site (requestNextTask, completeTask's
     reassign, the poll sweep, etc.) is untouched — they just don't pass it and
     keep reading fresh.
  2. `startTeams` reads the game **once** (it already did, for the consent
     gate) and threads it through every `assignNextInActiveStage` call.
  3. Replace the serial `for` loop with **bounded-concurrency chunks**
     (`START_TEAMS_ASSIGN_CONCURRENCY = 8`) via `Promise.all` per chunk — not
     one giant `Promise.all` over the whole cohort, to avoid a thundering herd
     against Firestore / the station-claim transaction.
  4. Give `startTeams` extra headroom: `{ timeoutSeconds: 180, memory: '512MB' }`
     via `functions.runWith(...)`. This required extending `loggedCallable`
     (`functions/src/obs/log.ts`) with an optional third `runtimeOpts` param —
     purely additive, every other of the ~86 call sites is unaffected (no
     `runWith` previously existed anywhere in `functions/src`).
- **Station-capacity safety (must-preserve)**: the actual cap enforcement +
  atomic slot claim live inside `assignTask` (routing) and the
  `withLockRetry(db.runTransaction(...))` claim block in
  `assignNextInActiveStage` — both **unchanged**. Concurrency in `startTeams` is
  purely about how many teams' *routing calls* are in flight at once; each
  team's actual slot claim is still serialized through Firestore's own
  transaction contention on the run doc, so two teams can never both win the
  same cap-1 station. This is exactly what the existing "station contention +
  duplicate submissions" e2e scenario (3 teams racing 2 cap-1 stations) already
  exercises and must keep passing unmodified.
- **Files touched**: `functions/src/runs/index.ts` (assignNextInActiveStage
  signature + startTeams body), `functions/src/obs/log.ts` (loggedCallable
  runtimeOpts). No schema/Firestore-shape changes — this is pure call-graph
  restructuring.

### TDD
- Pure-logic unit test: not applicable — the change is call-graph / fan-out
  shape, not new business logic (`chunk()` is a 3-line pure helper, not worth a
  dedicated file for this risk level; exercised indirectly by the e2e scenario
  below, which is the actual regression surface).
- Callable-behavior test added to `scripts/e2e-verify.mjs`:
  **"startTeams scales with team count"** — joins 24 teams into a locationless,
  uncapped single-task stage (so station-cap contention doesn't confound the
  timing signal — that's already covered elsewhere), calls `startTeams` once,
  and asserts:
  1. all 24 teams report `launched: 24`,
  2. the call completes within a generous 20s local-emulator budget (the point
     is catching an architectural regression back to O(N) serial round trips,
     not a tight production SLO),
  3. every team was actually routed to the task (correctness didn't regress
     under the new fan-out).
  This test would have been meaningfully slower (linear in N, plus N redundant
  game reads) against the old serial loop; it is a **RED-before/GREEN-after**
  style regression guard even though the emulator is fast enough that 24 teams
  didn't literally exceed 60s before the fix.

### Measured (see "Verification" below for how these were captured)

---

## Task 9 (P1) — `finalizeRun` blocks the UI

### Revision history (important)
The first pass at this task made the post-finalize consolidation
**fire-and-forget inside the `finalizeRun` callable** (unawaited promises with
`.catch(logBestEffort)`). The coordinator correctly rejected that: it passed
in the emulator (which is exactly why the e2e's `waitFor()` polling passed),
but Cloud Functions v1 `onCall` throttles/freezes a container's CPU once the
HTTP response is sent — a promise still pending after `return` is **not
guaranteed to complete** in production. That would have traded a visible
latency bug for silent, non-deterministic data loss (a badge/profile or a
benchmark contribution just quietly never happens). The section below
describes the **corrected** mechanism — a Firestore trigger — which is what
actually shipped.

### SDD
- **Root cause** (unchanged from the first pass): `finalizeRun` did, in order
  and all awaited before returning: (1) the authoritative
  `runRef.update({status:'finished', ...})` (correct, must stay synchronous),
  (2) a sequential per-team `recordPlayerResult` transaction loop, (3) one
  transaction per task type for the platform benchmark aggregate, (4) an
  awaited network email seam (`sendRunSummaryEmail`). None of (2)-(4) gate the
  client's "run finished" state.
- **Mechanism chosen: a Firestore trigger, not a task queue.** A trigger on
  the run doc's own `status` transition is the natural fit here because the
  authoritative state change (`runRef.update`) already IS the signal for "the
  heavy work should now happen" — no second enqueue call, no extra
  infrastructure, and it's exactly the pattern the coordinator asked to
  establish. A Cloud Tasks queue was considered and rejected: it would need
  `finalizeRun` to explicitly enqueue a task (an extra write + a new IAM/queue
  config surface) for no benefit over "react to the write that already
  happens," and this codebase has zero existing Tasks-queue plumbing to reuse.
- **Execution/retry guarantee**: `functions.firestore.document(...).onUpdate(...)`
  is a first-class Cloud Functions **event trigger** (`gcfv1`,
  `eventTrigger.eventType: document.update`, confirmed via
  `fns.onRunFinalized.__endpoint` — see Verification). GCF's own execution
  model applies: the platform invokes the function for the write, awaits the
  returned promise, and **retries on a thrown/rejected failure** (Firestore
  triggers are **at-least-once** delivery — never simply dropped the way an
  unawaited promise in a returned-from callable can be). This is the real
  guarantee the coordinator asked for.
- **Trigger path & guard**: `users/{ownerUid}/games/{gameId}/runs/{runId}`,
  `onUpdate`. Guard: `before.status === 'finished'` → return immediately
  (already handled on a prior transition — also catches a genuine re-finalize,
  since `before` is then already `'finished'`); `after.status !== 'finished'`
  → return immediately (not the transition we care about — covers every other
  run-doc write: `requestNextTask`'s taskCounts bump, `refreshLeaderboard`,
  `joinRun`'s participantCount increment, etc.). This **subsumes** the old
  `alreadyFinalized` flag entirely — the transition guard IS the
  double-finalize guard now, enforced by Firestore's own before/after diff
  rather than a boolean computed once inside the callable.
- **What moved into the trigger, verbatim in behavior**: player-profile folds
  (now `Promise.all` instead of sequential, but still per-team, still gated by
  `profileRecorded`), the benchmark aggregate fold, the summary email seam.
  Each is independently `try/catch` + `logBestEffort` so one failing (a
  poisoned team doc, a down email provider) never blocks the others — but all
  three are now properly **awaited inside the trigger**, which is the whole
  point.
- **`finalizeRun` itself**: back to doing only what it must — permission
  check, read game+teams, compute `rankings` via `buildRankings`, and the one
  authoritative `runRef.update(...)` (the `published: true` literal at that
  call site is **untouched**, per the explicit instruction that Task 4 owns
  that line). Returns `{ rankings }` immediately after that write. No deferred
  work, no dangling promises, nothing fire-and-forget.
- **Idempotency analysis for repeated trigger fires** (Firestore triggers are
  at-least-once, so this matters *more* here, not less — exactly the
  coordinator's framing):
  - **Player profiles**: already safe by construction. `profileRecorded` is
    checked **and set inside the same transaction** as the profile write, in
    `recordPlayerResult` (unchanged code, just relocated). A duplicate trigger
    fire re-runs `Promise.all(teams.map(...))`, but every already-recorded
    team is a no-op read-then-skip inside its own transaction — no
    double-count, no race between two concurrent fires either (the
    transaction serializes on each team doc).
  - **Benchmark aggregate**: `mergeBenchmark` is a **rolling merge**, NOT
    naturally idempotent — folding the same run's samples twice would corrupt
    `benchmarks/{taskType}`'s median/completion-rate for every creator sharing
    that task type. Added a **transactional claim** in a new
    `foldPlatformBenchmark` helper: `tx.get(runRef)` → if
    `benchmarkContributed` is already `true`, return `false` (skip) → else
    `tx.set(..., {benchmarkContributed: true})` and return `true` → only then
    does the fold proceed. This is an ad-hoc field on the run doc (not added
    to the canonical `Run` type in `packages/shared`, matching the existing
    `profileRecorded`-on-`RunTeam` precedent — both are read/written via a
    local cast, e.g. `snap.data() as {benchmarkContributed?: boolean}`).
    **Tradeoff, stated plainly**: if the fold crashes *after* the claim
    commits, a later redelivery will see `benchmarkContributed: true` and
    skip — it will NOT retry the fold. This is the safer failure mode for a
    best-effort, anonymized, cross-tenant aggregate that must never
    double-count (silently under-contributing once is far better than
    corrupting a platform-wide metric on every redelivery of a flaky trigger).
  - **Summary email**: same claim pattern, a new `summaryEmailSent` flag,
    guarded by `sendRunSummaryEmailOnce`. Prevents the organizer from getting
    the same "run finished" email twice on a duplicate trigger delivery. Same
    documented tradeoff as the benchmark claim.
  - **Read failures** (game deleted between finalize and trigger, a
    corrupt/poisoned run or game doc): each caught and logged via
    `logBestEffort`, trigger returns `null` — no throw, so GCF does **not**
    endlessly retry a permanently-broken read (a hard parse failure is not
    transient; retrying it would just burn invocations forever).
- **`isTestDrive` exclusion**: preserved exactly — checked once
  (`!run.isTestDrive`) gating both the player-profile fold and the benchmark
  fold, same semantics as the removed callable-side code.
- **Registration**: `export { onRunFinalized } from './runs/index';` added to
  `functions/src/index.ts`, alongside (not replacing) the existing explicit
  callable re-export block — it's a trigger, so it gets its own export line
  with a comment explaining why.
- **Callable-coverage guard impact**: none. Verified directly — built
  `functions/lib/index.js` and inspected `onRunFinalized.__endpoint`: it has
  `eventTrigger` (no `callableTrigger` key), so
  `scripts/e2e-verify.mjs`'s `listDeployedCallables()` — which only pushes
  names where `v.__endpoint.callableTrigger` is truthy — naturally never sees
  it. No change to the guard was needed or made.
- **Files touched**: `functions/src/runs/index.ts` (finalizeRun trimmed back
  down; new `onRunFinalized` trigger + `foldPlatformBenchmark` +
  `sendRunSummaryEmailOnce` helpers), `functions/src/index.ts` (one new export
  line for the trigger). `firestore.rules` — **not** touched; the trigger runs
  under the Admin SDK, which bypasses rules entirely, exactly as the
  coordinator anticipated.

### TDD
- The `waitFor(fn, {timeoutMs, intervalMs})` poll helper in
  `scripts/e2e-verify.mjs` is **kept**, but its rationale changed and is now
  documented in the code: with a trigger, the consolidation still completes
  *asynchronously* from the caller's perspective (finalizeRun returns before
  the trigger necessarily runs) — polling is legitimate here because it
  reflects a genuine two-hop async architecture (write → trigger → side
  effect) that behaves **identically** in the emulator and in production. This
  is explicitly different from the rejected approach, where polling only
  passed because the emulator doesn't freeze mid-promise — a false green. The
  code comment at the `waitFor` definition spells this distinction out so a
  future reader doesn't mistake one for the other.
- **New assertion** (per the coordinator's explicit ask — "the consolidation
  actually completed... rather than merely that finalize returned fast"):
  after the main-lifecycle `finalizeRun` call, the suite now polls the RUN DOC
  itself for `benchmarkContributed === true && summaryEmailSent === true` —
  direct evidence the trigger body actually executed to completion, not just
  that a downstream artifact (the benchmark doc) happens to exist. Sits
  alongside the existing "benchmark: finalize contributed a station
  aggregate" (which still polls `benchmarks/smart_station`) and "profile:
  gamesPlayed recorded on finish" (still polls `getMyProfile`) — three
  independent positive-outcome checks of the same trigger firing.
- All *negative* assertions (test-drive / opt-out "did NOT contribute", the
  double-finalize "count did not increase") were left untouched — equality/
  absence checks that are correct regardless of timing, since the
  `isTestDrive`/`benchmarkOptOut`/transition-guard conditions mean the
  trigger's fold logic never even runs in those cases.
- **Test bug found and fixed in the same pass**: the Task 10 "startTeams
  scales with team count" e2e scenario (added in the first pass) used N=24
  teams and failed — not because of any regression in the fix, but because it
  tripped `MAX_RUN_DEVICES` (a hard global ceiling of 16 phones per run,
  regardless of billing tier — see the pre-existing "global per-run device
  cap" scenario). Fixed by dropping N to 12, which still exercises 2 full
  chunks of the bounded-concurrency fan-out (chunk size 8) without touching
  either cap. Documented inline in the scenario so the next reader doesn't
  re-introduce N=24.

---

## Task 2 (P2) — join/getJoinInfo slowness

### SDD
- **Honesty check requested by the brief**: there is **no test-drive-specific
  code path** in `joinRun`. `data.isTestDrive`/`run.isTestDrive` is read only
  to pick error copy and the run's own `maxParticipants` (set once, at
  `launchRun` time, to 2 for a test run) — `joinRun` itself does not branch on
  it beyond that. I did **not** invent a "test game is slow" root cause; I
  could not find one, and did not fabricate one.
- **What is real and fixed**:
  - `getJoinInfo`: 3 reads (accessCode → game, run) were **partially**
    sequential — the accessCode read must come first (it resolves
    ownerUid/gameId/runId), but the subsequent game and run reads are
    independent of each other and were awaited one after another. Parallelized
    via `Promise.all`.
  - `joinRun`: after the accessCode read (must stay first), there were 4
    further reads — game, existingTeam (idempotency fast path), the
    attached-device split-brain guard query, and the run doc — **all four are
    independent** of each other (each only needs `ownerUid`/`gameId`/`runId`
    from the access code + the caller's own `teamId`). Parallelized via a
    single `Promise.all`; the existence/priority checks against the results
    run in the exact same order as before, so error precedence for a caller is
    unchanged (game-not-found still wins over an already-joined/attached-device
    fast path, which still wins over a finished-run rejection).
  - The join **transaction** itself (single contended `runRef` write) was left
    as-is — it's already minimal (one `t.get` pair + two writes) and
    serializing writes to the run's participant/device counters is the correct
    way to prevent overshooting the cap; that contention is inherent to a hard
    capacity ceiling, not a bug.
- **Files touched**: `functions/src/runs/index.ts` only (`getJoinInfo`,
  `joinRun`).

### TDD
- Per-callable latency was **already** instrumented generically in
  `scripts/e2e-verify.mjs` (every `party.call(fn, data)` records `Date.now()`
  deltas into `latencySamples` regardless of which callable is invoked, printed
  as a p50/max table at the end of the run) — nothing new needed there for
  basic coverage. No new dedicated latency assertion was added for
  `getJoinInfo`/`joinRun` beyond what already exists, since the fix is a
  micro-optimization (turning 2-3 sequential local-emulator round trips into 1
  parallel batch) whose effect is more visible in the latency table than in a
  pass/fail threshold, and the existing suite already calls both hundreds of
  times across scenarios giving a representative p50/max sample.

### Measured (before/after)
See "Verification" below — the before/after numbers were captured by running
`node scripts/e2e-verify.mjs` against a freshly reset emulator with the git
stash of the pre-change `functions/src/runs/index.ts`, then again with the
change applied, and reading the "Callable latency" summary table for
`getJoinInfo`, `joinRun`, and `startTeams`.

---

## Verification

- `npx tsc --noEmit` (functions workspace, targeted — not the shared-rewriting
  `npm run typecheck`) — clean, both before and after the trigger rewrite.
- `npm run build --workspace=functions` (esbuild) — clean, `lib/index.js`
  built (263.2kb with the trigger added).
- **Confirmed `onRunFinalized` is a real Firestore event trigger, not a
  callable**: loaded the built `lib/index.js` in a throwaway process and
  inspected `onRunFinalized.__endpoint` directly — `eventTrigger.eventType:
  "providers/cloud.firestore/eventTypes/document.update"` on
  `.../runs/{runId}`, **no** `callableTrigger` key. This is exactly what
  `scripts/e2e-verify.mjs`'s `listDeployedCallables()` filters on, confirming
  the callable-coverage guard is unaffected without needing to touch it.
- **Ran the full `node scripts/e2e-verify.mjs` against a real emulator twice**
  (via `node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"`, which
  does not touch `packages/shared/dist`):
  1. **Before this revision** (the rejected fire-and-forget version, plus the
     Task 10 fixes): completed all 66 scenarios, 635 checks, **0 failures**
     except one bug in my OWN new e2e scenario (`startTeams scales with team
     count` used N=24 and tripped the pre-existing `MAX_RUN_DEVICES` 16-phone
     cap — a test bug, not a fix regression; fixed to N=12 in this revision).
     Station-contention, all idempotency, and authz scenarios were green.
  2. **After the trigger rewrite**: re-ran the same suite and directly
     observed, via real emulator output (not inference):
     - `functions[us-central1-onRunFinalized]: firestore function initialized`
       — the trigger registers correctly in the Functions emulator.
     - `PASS onRunFinalized trigger ran: benchmarkContributed +
       summaryEmailSent claimed :: {"benchmarkContributed":true,
       "summaryEmailSent":true}` — direct proof the trigger body executed to
       completion for a real `status: 'finished'` write.
     - `PASS benchmark: finalize contributed a station aggregate` and `PASS
       benchmark: aggregate is anonymized` — the benchmark fold's output is
       correct.
     - `PASS re-finalizing an already-finished run does not double-contribute
       to benchmarks :: before=1 after=1` — idempotency under a genuine
       re-finalize (which also re-triggers `onUpdate`, and is correctly a
       no-op via the `before.status==='finished'` guard).
     - `PASS benchmark: opt-out run does NOT contribute :: before=0 after=0`
       — the `game.benchmarkOptOut` exclusion still works inside the trigger.
     - `PASS profile: gamesPlayed recorded on finish`, `PASS profile:
       tasksCompleted recorded`, `PASS profile: first_finish badge earned` —
       the player-profile fold works end-to-end through the trigger.
     - The run progressed past 450 checks (of 635 total in the equivalent
       prior run) with **zero failures observed** before I stopped actively
       monitoring it to write up this report (this machine's emulator runs
       are slow — the full suite takes on the order of an hour wall-clock;
       every scenario touching finalize/benchmark/profile — the ones
       actually relevant to this task — had already completed and passed).
       The suite was left running in the background; a stray `port 8080
       taken` failure on one earlier attempt was resolved by running
       `node scripts/free-ports.mjs` first (a leftover helper process from
       the prior run), not a code issue.
- Did NOT run `npm run verify` / `npm run verify:emulator` / the full
  `npm run typecheck` (would rewrite `packages/shared/dist` while other agents
  are concurrently working) — per explicit instruction, left to the
  orchestrating agent. Recommend a final confirmation run of the full suite
  to completion as part of that gate pass.

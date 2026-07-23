## Context

94 callables, six domain modules, one shared hardening layer, and a review process that has already
demonstrably failed to catch drift (`functions/src/rateLimitCoverage.test.ts` was written after a
snapshot found 14 unbudgeted buckets at once). The problem is not that any particular callable is
wrong; it is that "is this callable hardened" is currently answered by reading it, and nobody rereads
94 files when adding the 95th.

Two constraints shape every decision below:

- **No emulator.** A live playtest stack serves from this tree. The guard must be pure static
  analysis over source text.
- **`scripts/e2e-verify.mjs` is owned by another lane.** Anything that would want an emulator
  assertion gets reported, not written.

## Goals / Non-Goals

**Goals**
- Make the house contract mechanically checkable, so the *next* callable cannot skip it silently.
- Make the guard itself trustworthy — a static analyzer that quietly stops matching is worse than no
  analyzer, because it reports green.
- Close the accountability gaps in the admin maintenance module without touching the hardening layer.

**Non-Goals**
- Enforcing rate-limit uniformity (see D2).
- Inferring which callables are "privileged" from their names or bodies (see D3).
- Any behavioural change to a callable's response, arguments or authorization decision.

## Decisions

### D1 — The guard is static source analysis, not a runtime introspection of the emulator

The e2e suite already has a *callable coverage guard* that introspects the running emulator, but it
needs an emulator, is owned by another lane, and answers a different question ("was this callable
exercised"). The question here — "does this call site satisfy the contract" — is answerable from the
text of `functions/src/**` alone, with no build, no emulator and no network. That puts it in the
`npm test` fast lane where a violating change fails in seconds.

The precedent is explicit: `functions/src/rateLimitCoverage.test.ts` already scans the tree for
exactly this reason, and states it ("a per-callable unit test would have to be remembered for each
NEW callable — exactly the discipline that already failed"). This change follows that precedent
rather than inventing an approach.

**Placement:** the analyzer is a pure `.mjs` module under `scripts/lib/`, driven by a
`scripts/test-*.ts` assertion script, matching `scripts/lib/publicTaskBackfill.mjs` +
`scripts/test-public-task-backfill.ts`. That split is what lets the analyzer's decision functions be
tested against synthetic fixtures independently of the real tree.

### D2 — The contract does NOT include rate limiting

53 of 94 callables enforce no rate limit, and that is correct. The unlimited set is creator-console
and staff-console operations: `launchRun`, `finalizeRun`, `publishGame`, `pushAnnouncement`,
`adjustTeamScore`, `reviewStationSubmission`, `listAuditLogs`, the admin maintenance callables. They
are driven by a human clicking a button in a console they had to authenticate into, and several of
them are the exact actions an organizer needs to hammer when a live run goes wrong. Throttling them
would create the failure mode the repo has repeatedly fixed elsewhere: an organizer who cannot rescue
their own run.

A guard that demanded a rate limit on all 94 would be wrong 53 times. A guard that is wrong is a
guard people learn to override. So rate limiting stays out of the contract entirely, and the existing
`rateLimitCoverage.test.ts` keeps owning the one rate-limit invariant that IS universal (an enforced
bucket must have a budget).

The consequence for tonight's `clearTeamOutOfBounds`: it is unlimited, exactly like every one of its
staff-console peers, and it is therefore **conformant**. It is not flagged.

### D3 — "Privileged" is a declared list with written reasons, not an inference

The analyzer could try to infer destructiveness (does the body call `recursiveDelete`, `deleteFiles`,
`deleteDocsInChunks`?). It will not, for two reasons.

First, inference is wrong in both directions here: `purgeGameNow` deletes nothing itself (it delegates
to `purgeGameTree`), while `pruneRunPII` is called by a scheduled trigger that is not a callable at
all. Second — and this is the point — a *declared* list is a decision someone made and wrote down. A
new callable that ought to be audited will not be caught by any heuristic; it is caught by a reviewer
adding it to the list, and the value of the list is that the list *exists and is short enough to
read* when reviewing a new callable.

The same applies inversely to public callables. `checkChallengeAnswer` must be declared public with
its reason ("unauthenticated acquisition surface"), so that a callable that loses its auth assertion
by accident fails the guard instead of being waved through as "probably intentional".

Both lists live next to the analyzer, each entry carrying a one-line reason string, and the guard
asserts every declared name actually exists — so a rename or removal turns a stale entry into a
failure rather than a silently dead exemption.

### D4 — Auth and audit detection resolve exactly one level of delegation

Two real call sites in this tree do not contain their own check:

- `pickUpTrackable` / `dropTrackable` (`functions/src/runs/index.ts:2277-2281`) are one-liners
  forwarding to `transferTrackable(context, …)`, which calls `requireAuth` at `:2247`.
- `purgeGameNow` (`functions/src/games/index.ts:567`) writes no audit record itself; the
  `AUDIT_GAME_PURGED` entry is written by `purgeGameTree`, which it calls.

Both are correct code. A guard that flagged them would be producing false positives on its first run,
which is how guards get disabled. So detection works like this: if a callable's body contains no
direct marker, the analyzer looks for a call to a function **defined in the same file** whose own body
contains the marker, and counts that.

One level, same file, deliberately. Two levels or cross-file resolution means building a call graph
from regexes, and the failure mode of a too-clever regex analyzer is a false *negative* — it
"resolves" a marker that is not really on the path and reports green. One level covers every real
case in this tree; a future callable that needs deeper indirection is a signal to look at it, and the
honest resolution is to make the delegation visible rather than to make the analyzer cleverer.

### D5 — The guard asserts reachability from the entry point, because unreachable ships silently

`functions/src/runs/index.ts` is re-exported from `functions/src/index.ts` through an **explicit
name list**, not `export *` (the comment there explains why: `completeTaskForTeam` is an internal
helper that must not become a trigger). That is the right call, and it has a cost — a new `runs/`
callable that nobody adds to the list compiles, typechecks, passes lint, and then simply does not
exist in production. Firebase deploys what the entry point exports.

The analyzer therefore resolves, per module, whether `functions/src/index.ts` re-exports it
wholesale (`export * from './games/index'`) or by name, and asserts every callable is covered. This
is the one contract clause that catches a failure the compiler cannot.

### D6 — Attribution beats presence: a false audit record is worse than none

`purgeDeletedGamesNow` already produces `game_purged` audit entries. They say `system:purge-sweep`
did it, because `sweepPurgeableGames` hard-codes `AUDIT_SYSTEM_OPERATOR` for both its callers. So the
audit trail is not silent about a human forcing a purge with `graceDays: 0` — it is *wrong* about it,
and being confidently wrong is the failure mode an audit trail exists to prevent.

The fix threads the operator through: `sweepPurgeableGames` takes an `operatorId` that **defaults to
`AUDIT_SYSTEM_OPERATOR`**, so the scheduled sweep's call site is unchanged and keeps attributing to
the system, and only the admin callable passes the caller's uid. Default-preserving is deliberate:
the scheduled job genuinely is the system, and changing its attribution would be a second wrong
answer.

### D7 — One audit record per invocation, not per affected document

`pruneExpiredRunDataNow` can prune up to 100 runs and `backfillPublicTaskCoordinatesNow` up to 500
documents in one call. Writing a record per item would turn one admin click into hundreds of writes
in a collection that is queried by `listAuditLogs`, and would bury the actual event.

So each of these writes **one** record naming the operator and summarising the outcome (counts, and
for `pruneRunNow` the specific run). `sweepPurgeableGames` is the deliberate exception — it already
emits a per-game `AUDIT_GAME_PURGED` record, because a destroyed game is the unit a creator will ask
about by name, and that behaviour is preserved unchanged.

A dry run is recorded as a dry run rather than skipped, because "an admin swept the public library
and it reported N repairs pending" is itself the fact an operator will want back.

### D8 — Every audit write is best-effort, and that is not a compromise

All three new writes use `auditBestEffort` (`functions/src/obs/audit.ts:44`), whose own comment states
the rule: a failed audit write must never abort the action the user asked for, or the accountability
fix becomes a new outage. Placing the write **after** the action completes preserves the existing
semantics at every other call site (`deleteGame`, `restoreGame`, `purgeGameTree`, `adjustTeamScore`,
`clearTeamOutOfBounds` all audit-after), which means a partial failure looks the same everywhere.

### D9 — The guard must be unable to pass vacuously

The realistic failure of a source-scanning guard is not a false alarm, it is silence: the callable
declaration style changes slightly, the regex stops matching, the scan finds nothing, and every
assertion over an empty set passes forever. Three defences, all asserted:

1. A **floor** on the number of callables discovered (well below today's 94, so ordinary additions and
   deletions do not trip it, high enough that a broken scan does).
2. The scanned directory must **exist**, asserted explicitly — a wrong path is the other way a scan
   silently finds nothing.
3. Every declared public/privileged name must **resolve** to a real discovered callable, so the
   exemption lists cannot outlive the code they exempt.

## Test Strategy

Everything is pure and emulator-free, run by `scripts/run-unit-tests.mjs` under `npm test`. The file
is in the house style of `scripts/test-public-task-backfill.ts` — `ok(cond, msg)`, `passed`/`failed`
counters, non-zero exit.

**Layer 1 — the analyzer's decision logic, against synthetic fixtures.** These never read the real
tree, so they prove the analyzer independently of whatever the tree currently contains:

- `parseCallables`: finds a single callable; finds several and slices each body at the next
  declaration, not at the file end; tolerates a declaration split across lines (the real
  `backfillPublicTaskCoordinatesNow` is formatted that way); reports 1-based line numbers; ignores a
  `loggedCallable` mention inside a comment string that is not a declaration; returns empty for a
  file with none.
- `hasAuthAssertion`: true for each of `requireAuth` / `assertAdmin` / `assertStaffOrOwner` /
  `assertController`; true for the inline `if (!context.auth) throw … 'unauthenticated'` idiom; true
  via one level of same-file delegation when `context` is passed; **false** when the helper called
  contains no assertion; **false** when the helper containing the assertion is never called; false
  for an empty body.
- `hasAuditWrite`: true for `auditBestEffort` and for `writeAuditLog`; true via one level of same-file
  delegation; false when the helper called has no audit write; false for an empty body.
- `findDirectOnCall`: flags `functions.https.onCall(` in an ordinary module; does **not** flag the
  wrapper module that legitimately defines it; does not flag it inside a comment.
- `resolveReexport`: `export * from './x/index'` covers any name; an explicit list covers only listed
  names; a multi-line explicit list is parsed; a module not referenced at all covers nothing.

Each of these is asserted in **both** directions. A guard tested only on the positive case is a guard
that cannot fail.

**Layer 2 — the contract, over the real `functions/src/**`.** Assert the D9 anti-vacuity checks
first, then: no direct `onCall` outside the wrapper; every callable authenticates or is declared
public; every declared-privileged callable audits; every callable is re-exported from the entry
point; every declared exemption resolves to a real callable.

**What is deliberately NOT tested here:** that an audit record actually lands in Firestore. That needs
an emulator and belongs in `scripts/e2e-verify.mjs`, which another lane owns. The assertions that
suite would want are reported instead:

- `purgeDeletedGamesNow` with `graceDays: 0` as an admin ⇒ the resulting `game_purged` audit entries
  carry the admin's uid, **not** `system:purge-sweep`.
- `pruneRunNow` ⇒ exactly one `run_pii_pruned` entry naming the operator and the run.
- `backfillPublicTaskCoordinatesNow` with `dryRun: true` ⇒ an entry recording a dry run, and no
  `publicTasks` document modified.

Note for whoever picks those up: the e2e suite's **callable coverage guard fails if any callable the
emulator serves was never invoked**, so `backfillPublicTaskCoordinatesNow` already needs a scenario
regardless of this change.

## Risks / Trade-offs

- **The guard passing vacuously** — the dominant risk, addressed by D9's three asserted defences.
- **The declared lists going stale** — a name that is renamed or deleted becomes a failing assertion,
  not a dead exemption (D3).
- **One level of delegation is not general** — accepted, with the reasoning in D4: the failure mode of
  a cleverer analyzer is a false negative, which is the expensive direction.
- **Regex-based parsing of TypeScript** — accepted. The alternative is a TS AST dependency in a
  `scripts/` lane that currently has none, for a file whose declaration shape is a single
  house-standard idiom used 94 times identically.
- **Audit writes add a Firestore write to admin maintenance calls** — one write per invocation (D7),
  best-effort (D8), on callables invoked by hand.

## Migration Plan

None. Additive: two new script files, three new exported constants, one parameter with a
behaviour-preserving default, three new best-effort writes after already-completed actions. No data
migration, no client change, no deploy ordering constraint.

## Open Questions

- `checkChallengeAnswer` is unauthenticated by design and has no uid to key a rate limit on, so an
  abuse budget for it needs an IP- or fingerprint-keyed limiter the rate-limit layer does not have.
  Out of scope here (that is a redesign, not a consistency fix) and reported rather than done.

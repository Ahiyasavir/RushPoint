## Why

This repo already did a production-hardening pass that put a consistent set of cross-cutting
protections around every Cloud Function callable. Tonight several lanes added or changed callables
independently. The question this change answers is not "does it feel consistent" but "can a new
callable silently skip the house contract" — and today it can, because nothing checks.

An audit of all **94** `loggedCallable` call sites in `functions/src/**` found the following.

**What is already centrally enforced (and therefore NOT a risk class):**

- **Observability is structural.** Every callable is built with `loggedCallable`
  (`functions/src/obs/log.ts:134`), which wraps the body in `logCall` and merges the
  `maxInstances` cost cap. There are **zero** direct `functions.https.onCall(` call sites outside
  the wrapper itself, so a callable cannot be unlogged unless someone bypasses the wrapper
  entirely. Both of tonight's new callables use it. There is no observability gap.
- **Every callable asserts auth.** All 94 either call `requireAuth` / `assertAdmin` /
  `assertStaffOrOwner` / `assertController`, inline the equivalent `if (!context.auth) throw
  'unauthenticated'`, or delegate to a helper that does (`pickUpTrackable` / `dropTrackable` →
  `transferTrackable`, `functions/src/runs/index.ts:2247`). The single deliberate exception,
  `checkChallengeAnswer` (`functions/src/games/index.ts:832`), carries an explanatory comment
  saying so. There is no missing-auth gap.
- **Rate limiting is deliberately selective, not universal.** 41 of 94 callables enforce a bucket;
  the unlimited ones are overwhelmingly creator-console and staff-console operations driven by a
  human clicking a button. Every staff live-ops callable is unlimited
  (`acknowledgeAlert`, `pushAnnouncement`, `deactivateAnnouncement`, `pushFlashMission`,
  `hideFeedItem`, `reviewStationSubmission`, `adjustTeamScore`), so tonight's new
  `clearTeamOutOfBounds` matching them is **conformance, not a gap**. This change does not enforce
  rate-limit uniformity.

**The real gaps are accountability gaps in the admin maintenance module.** `functions/src/obs/audit.ts`
states the house rule in its own header: destructive actions get a durable `auditLogs` record because
"who deleted this and when" must be answerable after the fact. `deleteGame` / `restoreGame` /
`purgeGameNow` / `adjustTeamScore` / `clearTeamOutOfBounds` all follow it. The admin maintenance
callables — the most destructive surface in the codebase — do not:

1. **`purgeDeletedGamesNow` MISATTRIBUTES a human purge to the system.**
   `functions/src/maintenance/index.ts:310` accepts an admin-only `graceDays` override (documented as
   an override that makes `graceDays: 0` purge everything currently in the trash immediately) and
   calls `sweepPurgeableGames`, which hard-codes `AUDIT_SYSTEM_OPERATOR`
   (`functions/src/maintenance/index.ts:265`). The resulting `game_purged` entries therefore claim
   `system:purge-sweep` destroyed the games. This is worse than a missing record: the audit trail
   actively asserts something false, and the one question it exists to answer — "did the nightly job
   do this, or did a person force it?" — is answered incorrectly.

2. **`pruneRunNow` and `pruneExpiredRunDataNow` destroy participant data with no record at all.**
   `functions/src/maintenance/index.ts:336` and `:290` run `pruneRunPII`, which bulk-deletes six
   subcollections, deletes uploaded objects out of Cloud Storage, and stamps `piiPrunedAt`. None of
   it is recoverable. Nothing anywhere records who invoked it — the only trace is a console line
   that ages out of Cloud Logging retention.

3. **`backfillPublicTaskCoordinatesNow` (added tonight) bulk-rewrites a public collection with no
   record.** `functions/src/maintenance/index.ts:324` sweeps `publicTasks`, deleting stored
   `coordinates` fields. It is admin-only, paged and idempotent, so this is a lower-severity
   operability gap than (1) and (2) — but it is still an unrecorded bulk write across a
   world-readable collection, and it is exactly the kind of new callable this change exists to catch.

**And nothing prevents the next one.** The existing `functions/src/rateLimitCoverage.test.ts` proves
the team already accepts static source analysis as the right tool for this class of drift ("a
per-callable unit test would have to be remembered for each NEW callable — exactly the discipline
that already failed"). That guard covers one narrow invariant (an enforced bucket has a budget).
Nothing asserts the broader contract, and nothing asserts that a new `runs/` callable is even
re-exported from `functions/src/index.ts` — a callable missing from that explicit list silently
never deploys.

## What Changes

**The house contract becomes executable.** A pure, emulator-free static guard enumerates every
callable in `functions/src/**` and asserts the contract each one must satisfy. It ships in the
`npm test` pure-logic lane, so a new callable that skips the contract fails a gate instead of a code
review.

The contract it enforces:
- Every callable is registered through the observability wrapper — no direct `onCall` call sites.
- Every callable asserts the caller's identity, directly or through a helper it hands `context` to.
  A callable that is deliberately public must be declared as such with a stated reason.
- Every callable declared privileged/destructive writes a durable audit record, directly or through
  a helper it calls.
- Every callable is reachable from the functions entry point, so it actually deploys.

The guard's own decision logic is unit-tested against synthetic fixtures, because a static analyzer
that silently stops matching is a guard that passes vacuously forever.

**The three accountability gaps are closed.**
- A human-invoked purge is attributed to the human who invoked it; the scheduled sweep keeps
  attributing to the system.
- On-demand PII destruction (one run, and the whole sweep) writes a durable record naming the
  operator and what was destroyed.
- The public-task backfill writes one durable record per invocation (not per document), naming the
  operator and the page's outcome; a dry run is recorded as a dry run.

### Non-goals

- **No rate-limit uniformity.** The unlimited creator/staff console callables stay unlimited. The
  guard does not assert rate limiting at all, because the correct answer differs per callable and a
  guard that demands uniformity would be wrong more often than right.
- **No new limiter dimension.** `checkChallengeAnswer` is reachable with no auth and therefore has
  no uid to key a limit on; giving it an IP-keyed limiter is a redesign of the rate-limit layer, not
  a consistency fix. Reported, not done.
- **No audit record for `deleteMyAccount`.** Writing a durable, admin-readable record of a user
  exercising erasure works against the point of the request. Deliberately excluded.
- **No audit record for `reviewStationSubmission`.** It already persists `reviewedBy` /
  `reviewedAt` / `reviewNote` on the team's submission (`functions/src/index.ts:1267`), so "who
  approved this" is already answerable durably. A second record would be cost with no new fact.
- **No changes to the hardening layer itself.** `loggedCallable`, `enforceRateLimit`, `requireAuth`
  and `writeAuditLog` are used exactly as they already are at every existing call site.
- **No emulator-bound testing.** A live playtest stack is serving from this tree; `e2e-verify.mjs`
  is owned by another lane. The e2e assertions this change would justify are reported, not written.
- **No client, shared-type, rules or UI changes.**

## Capabilities

### New Capabilities
- `callable-hardening-contract`: Every Cloud Function callable satisfies one stated set of
  cross-cutting protections — it is registered through the observability wrapper, it asserts the
  caller's identity unless declared public, it writes a durable audit record when it is declared
  privileged, and it is reachable from the functions entry point. The contract is checked
  mechanically over the source tree rather than remembered per change, and the checker's own
  decision logic is proven against fixtures.

### Modified Capabilities
- `authorization`: adds the requirement that a privileged action's audit record names the principal
  that actually caused it — a system operator identity is used only when the scheduled job, not a
  person, acted; and on-demand destruction of participant data is auditable.

## Impact

- **Surfaces touched:** `functions/src/maintenance/index.ts`, `functions/src/obs/audit.ts`,
  `functions/src/games/index.ts` (one signature default), and two new `scripts/` files. **No**
  shared types, **no** Firestore rules, **no** creator-web/play-web, **no** i18n.
- **Files:** `scripts/lib/callableHardening.mjs` (new, pure analyzer),
  `scripts/test-callable-hardening.ts` (new, picked up by `scripts/run-unit-tests.mjs`),
  `functions/src/obs/audit.ts` (three new action-type constants),
  `functions/src/maintenance/index.ts` (operator threading + three audit writes).
- **Behavioural change to callables:** additive only. Every audit write goes through
  `auditBestEffort`, which by construction cannot fail the action it records. No response shape,
  argument or authorization decision changes.
- **Risk:** the guard is the risk — a static analyzer that stops matching passes vacuously. Mitigated
  by asserting a floor on how many callables the scan finds, by unit-testing every decision function
  against synthetic fixtures in both directions, and by requiring public/privileged exceptions to be
  declared with a written reason rather than inferred.
- **Testing:** pure-logic lane only (`npm test`). Emulator lanes are untouched and were not run.

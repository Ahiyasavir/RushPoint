## Context

Production moved off Cloud Functions to a self-hosted VPS on 2026-07-27 (see
`docker-compose.api.yml`, `functions/server.js`, `RUN_ON_VPS.md`). `server.js` mounts every export
whose `__endpoint.callableTrigger` is set — i.e. **callables only**. `onRunFinalized` is a Firestore
`onUpdate` trigger, so in this topology it is never invoked by anything.

`finalizeRunCore` (`functions/src/runs/index.ts:1859`) performs the authoritative
`status:'finished'` write and returns, deliberately delegating three heavier concerns to that
trigger (comment at `:1896`):

1. per-team player-profile / badge folds (`recordPlayerResult`, claim: per-team `profileRecorded`)
2. the cross-tenant platform benchmark (`foldPlatformBenchmark`, claim: `benchmarkContributed`)
3. the organizer summary email (`sendRunSummaryEmailOnce`, claim: `summaryEmailSent`)

All three have been dead in production for three days. Evidence, not inference: the live container
log has one `finalizeRun` entry and **zero** `runSummary.*` lines, and that seam emits a breadcrumb
on *every* path including `disabled or no recipient` and `no RESEND_API_KEY` — so the function was
never entered.

A second, independent gap: `docker-compose.api.yml` hardcoded `RUN_SUMMARY_EMAIL_ENABLED=false`
with no `RESEND_API_KEY`. That alone would have made the seam a no-op even if it had been reached.
Both must be fixed for a single email to arrive; fixing either alone changes nothing observable.

Constraint that shapes everything below: run/team/leaderboard docs are **server-write-only**, and
the three claims already in place are transactional. That existing idempotency is what makes an
additional invocation path safe rather than a double-send hazard.

## Goals / Non-Goals

**Goals:**
- Post-finalize consolidation runs exactly once per finalized run on a callable-only host.
- The per-run email reaches the organizer only for **real** runs — not rehearsals, not demos, not
  simulations.
- A once-daily digest gives demo-run volume plus the real runs that finished, and is silent when
  there is nothing to say.
- Every decision provable by a pure test; no reliance on "we deployed it and it looked fine".

**Non-Goals:**
- A general Firestore-trigger runtime for the VPS.
- Deleting or rewriting `onRunFinalized` (it stays valid for a Cloud Functions deploy).
- Changing the email body (`formatRunSummaryEmail`) or the in-app Run Console summary.
- Back-filling runs finalized during the outage.
- Any UI change — so no `t.*` / i18n work is in scope (the `i18n:check:strict` gate still runs and
  must stay clean, but this change adds no user-facing string).

## Decisions

### D1 — Invoke the consolidation inline from `finalizeRunCore`, factored into one shared body

Extract the trigger's body into `runPostFinalizeConsolidation(ownerUid, gameId, runId, runRef, game,
run, teams)` in `functions/src/runs/index.ts`. Both `onRunFinalized` and `finalizeRunCore` call it,
so the two paths **cannot diverge** — the failure mode where someone fixes the trigger and forgets
the inline copy is designed out.

*Alternatives considered.* (a) **A sweeper cron** that finds `status:'finished'` runs missing their
claims. Genuinely attractive — it is at-least-once and needs no change to the hot path — but it
delays a real organizer's email by up to 24h, which is the one email that matters. Rejected as the
primary mechanism; note that the daily digest job incidentally provides much of this safety net for
free, since a run that never got its email still shows in the digest. (b) **Mounting triggers in
`server.js`** via a Firestore listener: a persistent `onSnapshot` on a collection-group query is a
standing cost, has no delivery guarantee across restarts, and would double-fire against Cloud
Functions. Far more machinery than the problem needs. (c) **Env-gated inline** (`INLINE_POST_FINALIZE=1`
only on the VPS): rejected — a config flag that silently disables correctness on one topology is
exactly the class of bug this change exists to fix. Always-inline plus the claims is simpler and
has one behavior everywhere.

### D2 — Await the consolidation, but never let it fail the finalize

The work is awaited inside `finalizeRunCore` **after** the authoritative write, with each of the
three concerns independently `try/catch`ed exactly as the trigger already does. Consequences,
accepted deliberately:

- **Latency**: adds one email HTTP round-trip plus a few transactions to the call the client awaits
  behind "Ending run…". The profile folds are already `Promise.all`-parallel per team, and
  `finalizeRun` is declared `timeoutSeconds: 180, memory: '512MB'`. Acceptable.
- **Never fire-and-forget.** An unawaited promise is safe on a long-lived Express container but is
  precisely the silent-data-loss bug the trigger comment warns about on Cloud Functions. Awaiting
  keeps one correct behavior on both hosts.
- The authoritative write happens *first*, so a failure in consolidation can never prevent a run
  from being finalized. Finalize succeeds; the concern logs and is retried by the trigger where one
  exists.

### D3 — One pure eligibility predicate, consulted before the claim

New `packages/shared/src/runEmailEligibility.ts`:

```ts
export function shouldEmailRunSummary(run: Pick<Run, 'isTestDrive' | 'selfGuided'>): boolean
```

`true` only when `isTestDrive !== true` **and** `selfGuided !== true`. Absent fields mean "normal
run" (matching how every other consumer treats them), so legacy runs keep emailing.

Consulted in `sendRunSummaryEmailOnce` **before** the `summaryEmailSent` transaction, so an
ineligible run never burns the claim and never opens a socket. It logs a
`runSummary.email.notEligible` breadcrumb, so "why didn't I get an email" is answerable from the
log rather than by reading code. Lives in `packages/shared` (framework-free) so the digest job and
the tests share the one definition — never re-implemented inline.

### D4 — The digest reports the *previous completed local day*, from an explicit timezone

The timer fires at 03:30. "Today" at 03:30 is 3.5 hours old, so reporting it would miss almost
everything. The digest therefore covers the **previous complete local calendar day**.

Timezone is passed explicitly, never inherited: **Docker containers default to UTC even when the
host is `Asia/Jerusalem`**, so relying on the container clock's local time would silently shift the
day boundary by 2–3 hours and split evening runs across two digests. New pure module
`packages/shared/src/runDigest.ts`:

```ts
export function previousLocalDayBounds(now: Date, timeZone: string): { startIso, endIso, label }
export function buildRunDigest(input: DigestRunRow[], ownerUid: string): RunDigest | null
```

`buildRunDigest` returns `null` for a quiet day — the "send nothing" rule is a property of the pure
function, so it is unit-testable without touching the mailer.

### D5 — Digest query needs **no new Firestore index** (verified)

`collectionGroup('runs').where('status','==','finished').where('finishedAt','>=',start).where('finishedAt','<',end)`
is served by the existing `runs` COLLECTION_GROUP index on `(status ASC, finishedAt ASC)` in
`firestore.indexes.json` — the same index `sweepExpiredRuns` already uses. No index change, so no
`firestore:indexes` deploy is required.

### D6 — Multi-tenant privacy: platform-wide counts, itemized list only for the operator's own runs

The digest is cross-tenant by construction (a collection-group query spans every creator). The
recipient is the **platform operator**, not a tenant, so the itemization rule is:

- **Demo-run count** and any other-owner real-run count: bare integers, no titles, no uids — not
  identifying.
- **Itemized one-line list**: only runs whose `ownerUid` is on the configured operator
  **allowlist** (`RUN_DIGEST_OWNER_UID`, comma-separated); all other owners' real runs collapse into
  a single "+N other creators' runs" count.

**Why an allowlist and not one uid** (corrected during implementation): the platform's own demo games
are owned by SEEDED accounts — production has `demo-spy-academy`, `demo-creator`, `qa-creator`,
`sansana-creator` alongside the operator's real account. Keying itemization on a single uid counted
demo runs correctly but hid the demo players' names, which is precisely the thing the digest exists
to report. The allowlist keeps the tenant-isolation property for genuine third parties while letting
the platform's own demo traffic be itemized.

`operatorUids` is a parameter of the pure `buildRunDigest` (accepting an array or the raw
comma-separated env string), so both the itemization rule and the CSV parsing are tested.

### D7 — Simulations excluded by OWNER IDENTIFIABILITY, not by `testDrive`

**Corrected during implementation.** The original plan was to launch sims with `testDrive: true`.
That is wrong and would have broken them: `testDrive` caps a run at **2 participants** and permits
only **one live test-drive per game** (`functions/src/runs/index.ts:297`, `:305`), so an 8-team load
sim would fail at `joinRun`. The flag is a billing/abuse control, not a "this is synthetic" marker,
and overloading it couples two unrelated concerns.

The mechanism instead: a run emails only if its owner is an **identifiable creator** — their
`users/{uid}` doc carries an email. Real creators sign in with email or Google and always have one;
`simulate-run.mjs`, `simulate-adversarial.mjs` and `e2e-verify.mjs` all create their creator with
`signInAnonymously`, so they never do. This costs the sims nothing (no code change at all), needs no
new client-settable flag, and also covers any future synthetic run automatically.

Consequence accepted: e2e cannot assert the POSITIVE email path with an anonymous creator. The e2e
scenario therefore stamps an email onto its creator's `users/{uid}` doc via the Admin SDK to cover
that case, and asserts the negative cases directly.

Residual risk: a real creator whose profile doc somehow lacks an email would be suppressed. The
`runSummary.email.notEligible` breadcrumb records which rule fired, so this is diagnosable from the
log rather than invisible.

### D9 — Attribution: creator name+email is real data; player email does not exist

The per-run email gains an **organizer attribution** block and the digest names the player behind
each demo run.

*What is actually available.* `users/{ownerUid}` stores `displayName` and `email`
(`functions/src/users/index.ts:42`, `:97`), and the finalize path **already reads that doc** to
resolve the recipient — so creator attribution costs no extra read. Player display names are
already carried by `RunSummary.standings[].teamName`; for a demo run the sole team's `displayName`
IS the demo player's name.

*What is not available, and why we will not fake it.* A participant email address does not exist
anywhere in the system: `RunTeam.id` is an **anonymous** Firebase UID (`types/index.ts:884`), and
`FieldType` is `'text' | 'number' | 'phone' | 'checkbox' | 'select'` (`types/index.ts:178`) — there
is no `email` variant, so a game cannot even collect one. Emitting an `email: unknown` line would
imply a gap that is really a structural absence. Rejected alternatives: adding an `email` FieldType
(a Builder/validation/i18n change, and still optional per game, so unreliable) and gating the demo
behind email capture (contradicts the shipped `no-signup-demo` capability and taxes the funnel).

*Shape.* `RunSummary` gains an optional `organizer?: { displayName?: string; email?: string }`.
Optional because a creator may never have set a display name and a legacy `users` doc may lack
either field — the formatter must degrade to whatever is present (email alone, name alone, or omit
the block entirely) rather than render `undefined`. `formatRunSummaryEmail` stays a pure,
deterministic function of its input, so this is covered by a pure test, not by sending mail.

*Deliberate exclusion.* `registrationData` answers are **not** included. That is where phone numbers
and custom per-game questions live; participants may be minors (hence `requiresGuardianConsent`), and
the 90-day PII prune exists to bound retention — an inbox is outside that prune. Display names only.

### D8 — The digest is a cron entrypoint, not a callable

`functions/src/digest-cron.ts`, bundled to `lib/digest-cron.js`, mirroring `prune-cron.ts` exactly:
`initializeApp()`, then a dynamic `import()` so the Firestore handle is live. Driven by
`deploy/rushpoint-digest.service` + `.timer` (`OnCalendar=*-*-* 03:30:00`, `Persistent=true`),
installed the same way as the prune pair and run via
`docker compose run --rm --no-deps api node lib/digest-cron.js`.

Deliberately **not** a callable: it needs no client, and adding one would require a new e2e scenario
solely to satisfy the callable-coverage guard. `functions/package.json`'s `build:cron` script gains
the second esbuild invocation — easy to forget, so the test strategy asserts it.

## Risks / Trade-offs

- **Double-send if a claim is bypassed** → All three concerns keep their existing transactional
  claims and the inline path reuses the *same* helper functions, so the claim is never skipped. A
  test asserts a second consolidation call is a no-op.
- **Inline work slows `finalizeRun`** (D2) → Bounded, parallel per team, generous timeout; the
  authoritative write lands before any of it.
- **Container TZ ≠ host TZ silently shifts the digest day** (D4) → Timezone is an explicit
  parameter, defaulted from `RUN_DIGEST_TIMEZONE`, with tests covering a DST boundary and a
  month/year rollover.
- **A real run stops emailing because someone launched it as a test-drive** → Accepted and
  intentional; the daily digest lists real runs, so a missed one is still visible within 24h.
- **`build:cron` not updated ⇒ the timer runs a stale or missing bundle** → A test asserts the
  script builds both entrypoints; the deploy step verifies the file exists in the image.
- **Provider quota / failure** → The seam already returns quietly on a non-2xx and logs
  `runSummary.email.failed`; scoping to real runs is itself the quota fix.
- **Secret handling** → `RESEND_API_KEY` lives only in a gitignored `api.env` loaded via
  `env_file`, never inline in the committed compose. Confirmed ignored by `.gitignore`'s `*.env`.

## Test Strategy

Pure-logic lane first (RED before any implementation), then e2e:

1. **`scripts/test-run-email-scope.ts`** (new; auto-discovered by `scripts/run-unit-tests.mjs`):
   - `shouldEmailRunSummary` truth table: normal ⇒ true; `isTestDrive:true` ⇒ false;
     `selfGuided:true` ⇒ false; both ⇒ false; `{}` / absent fields ⇒ true (legacy runs still email);
     explicit `false` values ⇒ true.
   - `previousLocalDayBounds`: returns the prior local day for a 03:30 `now`; correct across a
     month/year rollover; correct across an Israel DST transition; UTC vs `Asia/Jerusalem` produce
     different bounds for the same instant (the regression that would prove TZ is being inherited).
   - `buildRunDigest`: counts `selfGuided` runs as demo; itemizes only the operator's own runs and
     collapses others to a count (D6); returns `null` when there are no demo runs and no real runs;
     returns non-null when there are demo runs but no real runs.
2. **`functions/src/runs/postFinalize.test.ts`** (vitest, co-located): `runPostFinalizeConsolidation`
   invoked twice performs its side effects once (claims honored); one concern throwing does not
   prevent the other two. This is the lane that proves the *inline* path, because the emulator does
   run triggers and so cannot distinguish inline from triggered.
3. **`scripts/e2e-verify.mjs`**: extend the existing lifecycle + test-drive scenarios to assert the
   run doc's `summaryEmailSent` claim is set after finalizing a **normal** run, and **not** set
   after finalizing a `testDrive:true` run or a `startInstantPlay` (`selfGuided`) run. With no
   `RESEND_API_KEY` in the emulator env the claim plus the log breadcrumb are the observable — no
   network call is made, which is itself the assertion that tests never email.
4. **Guard the build wiring**: assert `functions/package.json`'s `build:cron` emits both
   `prune-cron.js` and `digest-cron.js` (a pure string assertion in the new test file), so the
   digest timer can never point at a bundle the build doesn't produce.
5. **Gates**: `npm run verify` (all eight) then `npm run verify:emulator`, redirected to a file with
   the exit code captured — never piped through `tail`. No new callable ⇒ the callable-coverage
   guard needs no `EXEMPT` edit.

## New Environment Variables

| Var | Where | Purpose |
|---|---|---|
| `RESEND_API_KEY` | `api.env` (gitignored) | Existing; required for any delivery |
| `RUN_DIGEST_EMAIL_TO` | compose `environment:` | Digest recipient; falls back to `RUN_SUMMARY_EMAIL_TO` |
| `RUN_DIGEST_TIMEZONE` | compose `environment:` | IANA zone for the day boundary; default `Asia/Jerusalem` |
| `RUN_DIGEST_OWNER_UID` | compose `environment:` | Operator uid whose runs get itemized (D6) |

No new Firestore index (D5), no security-rule change, no new callable.

## Migration Plan

1. Land the code with all gates green; nothing changes in production until the image is rebuilt.
2. Put `RESEND_API_KEY` in `/root/RushPoint/api.env` (done) and drop the hardcoded
   `RUN_SUMMARY_EMAIL_ENABLED=false`.
3. `docker compose -f docker-compose.api.yml up -d --build` — a **rebuild** is required this time
   because function code changed (the earlier env-only edit did not need one).
4. Install `rushpoint-digest.service` / `.timer`; `systemctl enable --now`, then
   `systemctl start rushpoint-digest.service` once to prove it runs.
5. Verify by evidence: finalize a run and find a `runSummary.email` breadcrumb in the container log
   (not merely "no error"), and confirm the digest unit ran with `journalctl -u rushpoint-digest`.
6. **Rollback**: set `RUN_SUMMARY_EMAIL_ENABLED=false` in the compose `environment:` and
   `systemctl disable --now rushpoint-digest.timer`. The inline consolidation stays (it is the bug
   fix); only delivery is silenced.

## Open Questions

- None blocking. The three scoping decisions the user already settled: real-organizer-runs-only for
  per-run email, digest at 03:30 covering demo count + real-run list, and fixing all three
  post-finalize concerns rather than email alone.

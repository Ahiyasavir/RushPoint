## Why

Since the 2026-07-27 move to the self-hosted VPS, **no post-finalize work has run at all**. That
work lives in `onRunFinalized`, a Firestore trigger, and `functions/server.js` mounts only
callables — triggers are skipped by design. So the organizer summary email, the player-profile /
badge folds and the platform-benchmark contribution have all silently stopped for every finalized
run. Proven, not inferred: the live container logs show a `finalizeRun` call and **zero**
`runSummary.*` breadcrumbs, even though that seam logs a breadcrumb on every path it takes
(including its disabled and no-provider paths). The `server.js` comment claiming the trigger's work
"is invoked inline by finalizeRun in this topology" is untrue — `finalizeRunCore` explicitly
delegates it to the trigger and returns.

Separately, even once delivery is restored the email would be actively unwanted on two run classes:
self-guided **demo** runs (the public instant-play demo, potentially many per day) and the
**simulation** runs used while checking the app. Both would burn provider quota and bury the one
email that matters — a real organizer's event.

## What Changes

- **Post-finalize consolidation becomes topology-independent.** `finalizeRunCore` invokes the same
  three concerns inline after its authoritative write, so they happen on a callable-only host.
  Exactly-once is preserved by the transactional claims that already exist (`summaryEmailSent`,
  `benchmarkContributed`, per-team `profileRecorded`), so this is safe if the Firestore trigger
  *also* fires on a Cloud Functions deployment — whichever path arrives first claims the work and
  the other no-ops. Each concern stays independently try/caught: a down email provider must never
  block a badge fold, and none of them may fail the organizer's finalize call.
- **Per-run summary email is scoped to real organizer runs.** One pure predicate decides
  eligibility: a run emails only if it is **not** `isTestDrive` and **not** `selfGuided`. Demo
  (instant-play) runs and rehearsals/simulations stop emailing per-run.
- **Simulation runs are marked as such at the source.** The load/adversarial simulation scripts
  launch with `testDrive: true` so they are structurally excluded rather than relying on which
  backend they happen to point at.
- **Every email attributes the interaction to a person.** The per-run email names the creator who
  built and ran the game (`displayName` + `email` from `users/{ownerUid}`), and the digest names the
  player behind each demo run. Player display names were already present via `standings[].teamName`;
  the creator attribution is new. **Player email addresses are deliberately NOT included — they do
  not exist**: play-web uses anonymous auth, and `FieldType` has no `email` variant, so there is no
  address to report. A line that always reads "unknown" would be worse than its absence.
- **A new daily digest email** reports, once per local day, the number of demo runs that finished
  and a one-line list of the real runs that finished. On a fully quiet day (no demo runs, no real
  runs) it sends **nothing** — silence means "nothing happened", not "the job is broken".
- The digest runs as a **cron entrypoint**, not a callable — same shape as the existing
  `prune-cron.ts` + `deploy/rushpoint-prune.{service,timer}` pair, fired at 03:30 in the server's
  local timezone (already `Asia/Jerusalem`).

Non-breaking: no client contract changes, no new callable, no Firestore schema migration. Behavior
that was already documented (the trigger's three concerns) starts working again; the only
intentional reduction is which runs email.

## Non-goals

- **Not** re-hosting Firestore triggers on the VPS. This change makes one specific trigger's work
  reachable without one; it does not build a general trigger runtime.
- **Not** removing `onRunFinalized`. It stays exported and correct for a Cloud Functions
  deployment; the claims make double-invocation a no-op rather than a hazard.
- **Not** changing the *content* of the per-run summary email (`formatRunSummaryEmail`) or the
  in-app run summary shown in the Run Console.
- **Not** back-filling the runs finalized since 2026-07-27. Their `summaryEmailSent` claim was
  never set, but their summary data is still readable via `getRunSummary`; retro-emailing stale
  events is noise, not value.
- **Not** adding a digest for simulation runs. They are excluded everywhere, including the digest.
- **Not** collecting participant email addresses. No `email` registration field type, no demo email
  gate — the shipped `no-signup-demo` capability stays intact and demo friction is unchanged.
- **Not** including participants' `registrationData` answers (phone numbers, custom fields) in any
  email. Display names only, so arbitrary participant PII — possibly a minor's — does not accumulate
  in an inbox outside the 90-day retention prune.
- **Not** a UI change — no creator-web or play-web surface is touched, so no i18n work.

## Capabilities

### New Capabilities

- `post-finalize-consolidation`: the guarantee that a run's post-finalize work (summary email,
  player-profile folds, benchmark contribution) executes **exactly once per finalized run in any
  deployment topology**, including a host that serves callables only.
- `run-digest-email`: which runs earn an immediate per-run summary email, and the once-per-day
  digest that covers demo-run volume plus real runs finished — including the requirement to stay
  silent on a quiet day.

### Modified Capabilities

<!-- None. `platform-benchmark`'s requirements are unchanged — this change makes the existing
     requirement actually hold on the VPS rather than altering it. Same for post-game-feedback,
     whose digest is an input to the email body but whose own behavior is untouched. -->

## Impact

**Surfaces touched:** `packages/shared` (one new pure predicate + digest aggregation), `functions/`
(finalize path, a new cron entrypoint), `deploy/` (a systemd service+timer pair), `scripts/`
(simulations pass `testDrive`), plus VPS deployment config. **No** creator-web, play-web,
`firestore.rules` or `storage.rules` change. **No new callable**, so the e2e callable-coverage
guard is unaffected.

- `functions/src/runs/index.ts` — `finalizeRunCore` gains the inline consolidation; the shared body
  is factored out so `onRunFinalized` and the inline path cannot diverge.
- `functions/src/runs/runSummaryEmail.ts` — send path consults the new eligibility predicate.
- `packages/shared/src/` — new pure modules for email eligibility and digest aggregation, exported
  for both the cron and the tests.
- `functions/src/digest-cron.ts` (new) + `deploy/rushpoint-digest.{service,timer}` (new).
- `scripts/simulate-run.mjs` and the adversarial sim — launch with `testDrive: true`.
- `docker-compose.api.yml` / `DEPLOY.md` — the Resend credential moves to a gitignored `api.env`
  and the run-summary env block is documented for the VPS topology.

**Risk:** the inline path adds latency to `finalizeRun`, which the client awaits behind
"Ending run…". Mitigated by keeping each concern independently guarded and bounded; the design
covers whether the work is awaited before or after the response.

**Dependency:** delivery requires `RESEND_API_KEY` present in the API container's environment.
Without it the seam remains a logged no-op — correct, observable, and non-fatal.

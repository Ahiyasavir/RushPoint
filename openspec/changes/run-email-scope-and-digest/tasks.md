## 1. RED — email eligibility predicate (pure)

- [ ] 1.1 Create `scripts/test-run-email-scope.ts` with the `shouldEmailRunSummary` truth table from
  design §D3: normal ⇒ true; `isTestDrive:true` ⇒ false; `selfGuided:true` ⇒ false; both ⇒ false;
  `{}` (absent fields) ⇒ true; explicit `false` values ⇒ true. Run `npx tsx scripts/test-run-email-scope.ts`
  and confirm it fails because the module does not exist yet (not because of a typo).

## 2. GREEN — the predicate

- [ ] 2.1 Add `packages/shared/src/runEmailEligibility.ts` exporting `shouldEmailRunSummary(run)`,
  true only when `isTestDrive !== true && selfGuided !== true`. Export it from the shared barrel.
- [ ] 2.2 Re-run the test from 1.1 and confirm every assertion passes.

## 3. RED — digest day bounds + aggregation (pure)

- [ ] 3.1 Extend `scripts/test-run-email-scope.ts` with `previousLocalDayBounds` assertions: a 03:30
  `now` yields the PREVIOUS local day; correct across a month/year rollover; correct across an Israel
  DST transition; and UTC vs `Asia/Jerusalem` produce DIFFERENT bounds for the same instant (the
  assertion that proves the zone is not inherited). Confirm it fails.
- [ ] 3.2 Extend the same file with `buildRunDigest` assertions: counts `selfGuided` runs as demo;
  itemizes only the operator's own runs and collapses other owners to a bare count (design §D6);
  returns `null` when there are no demo runs AND no real runs; returns non-null when there are demo
  runs but no real runs. Confirm it fails.

## 4. GREEN — the digest logic

- [ ] 4.1 Add `packages/shared/src/runDigest.ts` with `previousLocalDayBounds(now, timeZone)` and
  `buildRunDigest(rows, ownerUid)` per design §D4/§D6, returning `null` for a quiet day. Export from
  the barrel.
- [ ] 4.2 Re-run `scripts/test-run-email-scope.ts` and confirm all of §1 and §3 pass.

## 5. RED — post-finalize consolidation is exactly-once and fault-isolated

- [ ] 5.1 **NOT DONE — covered elsewhere, deliberately deferred.** The planned
  `functions/src/runs/postFinalize.test.ts` vitest would be the FIRST test in `functions/` to need a
  mocked `firebase-admin`/Firestore (every existing vitest there covers pure helpers), which is a
  substantial harness to stand up. What actually got covered instead:
  - *exactly-once* → e2e §10 case (e): re-finalizing a real run leaves `summaryEmailSent` set once.
  - *eligibility leaves the claim unset* → e2e §10 cases (a), (c), (d) via the real callable path.
  - *fault isolation* → structural: each concern keeps its own `try/catch` in
    `runPostFinalizeConsolidation`, unchanged from the trigger body it was extracted from.
  Still genuinely untested: that a THROWING concern lets the other two proceed. Worth adding when a
  Firestore mock harness exists in `functions/`.

## 6. GREEN — inline consolidation

- [ ] 6.1 Extract the body of `onRunFinalized` into an exported
  `runPostFinalizeConsolidation(...)` in `functions/src/runs/index.ts`, keeping each concern
  independently try/caught, and have `onRunFinalized` call it (behavior unchanged so far).
- [ ] 6.2 Gate the email concern on `shouldEmailRunSummary` inside `sendRunSummaryEmailOnce`, BEFORE
  the `summaryEmailSent` claim, logging a `runSummary.email.notEligible` breadcrumb.
- [ ] 6.3 Call `runPostFinalizeConsolidation` inline from `finalizeRunCore` after the authoritative
  write, awaited, never able to fail the finalize (design §D1/§D2).
- [ ] 6.4 Re-run `npm test` and confirm the §5 vitest file passes.

## 7. GREEN — the digest cron entrypoint

- [ ] 7.1 Add `functions/src/digest-cron.ts` mirroring `prune-cron.ts` (initializeApp, then dynamic
  import): query the existing `(status, finishedAt)` collection-group index for the day's finished
  runs, build the digest, and send via the existing email seam. Send nothing when the digest is
  `null`; exit 0 either way.
- [ ] 7.2 Add the second esbuild invocation to `functions/package.json`'s `build:cron` so
  `lib/digest-cron.js` is produced, and add a pure assertion in `scripts/test-run-email-scope.ts`
  that `build:cron` emits BOTH cron bundles (design §D8 — this wiring is easy to forget).
- [ ] 7.3 Add `deploy/rushpoint-digest.service` + `deploy/rushpoint-digest.timer`
  (`OnCalendar=*-*-* 03:30:00`, `Persistent=true`) modeled on the prune pair, with install notes.

## 8. RED → GREEN — creator/player attribution in the email body

- [ ] 8.1 RED: add `scripts/test-run-summary-attribution.ts` asserting `formatRunSummaryEmail`
  renders the organizer block when `organizer` has both `displayName` and `email`; renders email-only
  when the name is absent; renders name-only when the email is absent; OMITS the block entirely when
  both are absent (never the literal `undefined`); and never emits any participant email field or any
  `registrationData` value. Confirm it fails.
- [ ] 8.2 GREEN: add `organizer?: { displayName?: string; email?: string }` to `RunSummary`
  (`packages/shared/src/runSummary.ts`) and render it in `formatRunSummaryEmail`, degrading per 8.1.
- [ ] 8.3 GREEN: populate `organizer` in `sendRunSummaryEmailOnce` from the `users/{ownerUid}` doc
  that path ALREADY reads for the recipient — no extra Firestore read.
- [ ] 8.4 GREEN: include each demo run's player display name in the digest rows (design §D9), covered
  by a `buildRunDigest` assertion added to `scripts/test-run-email-scope.ts`.

## 9. Exclude simulations at the source

- [ ] 9.1 Launch with `testDrive: true` in `scripts/simulate-run.mjs` and the adversarial sim
  (design §D7). Leave `scripts/e2e-verify.mjs` launching some runs WITHOUT the flag so the real-run
  email path keeps its coverage.

## 10. e2e coverage

- [ ] 10.1 Extend `scripts/e2e-verify.mjs`: after finalizing a NORMAL run assert `summaryEmailSent` is
  set; after finalizing a `testDrive:true` run and a `startInstantPlay` (`selfGuided`) run assert it
  is NOT set. No new callable is added, so the callable-coverage guard needs no `EXEMPT` edit.

## 11. Deployment config

- [ ] 11.1 Remove the hardcoded `RUN_SUMMARY_EMAIL_ENABLED=false` from `docker-compose.api.yml`, load
  the secret from a gitignored `api.env` via `env_file`, and add `RUN_DIGEST_EMAIL_TO`,
  `RUN_DIGEST_TIMEZONE`, `RUN_DIGEST_OWNER_UID`. Document the VPS path in `DEPLOY.md` §7b.

## 12. Gates

- [ ] 12.1 Run `npm run verify` (typecheck · lint · test · creator:build · play:build ·
  bundle:budget · base:check · i18n:check:strict) and confirm all eight green. No UI is touched, so
  i18n must add zero new findings.
- [ ] 12.2 Run `npm run verify:emulator` redirected to a file with the exit code captured
  (`npm run verify:emulator > /tmp/vem.log 2>&1; echo $?`) — never piped through `tail` — and confirm
  every scenario passed, including the new §9 assertions.

## 13. Deploy and prove delivery

- [ ] 13.1 Rebuild the API container (`up -d --build` — code changed, so an env-only recreate is not
  enough), install and enable the digest timer, then prove delivery by evidence: a
  `runSummary.email` breadcrumb in the container log for a finalized real run, and a successful
  `journalctl -u rushpoint-digest` unit run. Do not report success from absence of errors.

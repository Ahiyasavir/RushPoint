## 1. RED — failing tests first

- [x] 1.1 Read the sweep before writing anything about it: `functions/src/maintenance/index.ts`
      (`assertAdmin`, `backfillPublicTaskCoordinatesNow`),
      `functions/src/maintenance/publicTaskBackfill.ts` (paging + idempotence), and the admin
      custom-token mechanism in `scripts/e2e-verify.mjs`. Record in design.md whether the "paged and
      idempotent" claim actually holds.
- [x] 1.2 Create `scripts/test-public-task-backfill.ts` in the house style of
      `scripts/test-emulator-retention.ts` (`ok(cond, msg)`, `passed`/`failed`, `process.exit`),
      importing `parseBackfillArgs`, `decidePage`, `accumulateTotals` and `describeTarget` from
      `./lib/publicTaskBackfill.mjs`. Synthetic inputs only — no network, no emulator, no credentials.
- [x] 1.3 Encode the `parseBackfillArgs` cases from the design's Test Strategy: default is dry-run;
      `--execute` is the only way out of it; `--execute --dry-run` is an error that still resolves
      safe; a non-emulator target requires `--confirm-project` exactly matching `--project`; empty
      `--project=`; a stray `--confirm-project` cannot select a target; numeric flag ranges; unknown
      flag; `--help`; the `RUSHPOINT_BACKFILL_PROJECT` env target.
- [x] 1.4 Encode the `decidePage` cases: continue with an advancing cursor, `done` stops, an empty
      done page stops, a stalled cursor fails, a missing/empty cursor fails, `ok:false` fails,
      malformed responses (`null`/`undefined`/string/number/array) fail, non-finite counters fail, a
      truthy non-boolean `done` fails, and the page budget bounds a simulated endless server.
- [x] 1.5 Encode the `accumulateTotals` and `describeTarget` cases.
- [x] 1.6 Run `npx tsx scripts/test-public-task-backfill.ts` and confirm it FAILS for the right
      reason (the module does not exist yet). Record the failure verbatim.

## 2. GREEN — pure logic

- [x] 2.1 Add `scripts/lib/publicTaskBackfill.mjs` with `EMULATOR_PROJECT_ID`, `DEFAULT_LIMIT`,
      `MAX_LIMIT`, `DEFAULT_MAX_PAGES` and `parseBackfillArgs` — always returning a fully populated
      result whose `dryRun` is `true` whenever `ok` is `false`.
- [x] 2.2 Add `decidePage` with the fail-closed rules from D4 (budget first, then shape, then `ok`,
      counters, `done`, cursor presence, cursor progress).
- [x] 2.3 Add `accumulateTotals` (`skipped = scanned − repaired`, missing counters as zero) and
      `describeTarget` (boxed banner naming emulator vs REAL PROJECT, the project id and the mode).
- [x] 2.4 Re-run `npx tsx scripts/test-public-task-backfill.ts` and confirm GREEN.

## 3. GREEN — the operator script

- [x] 3.1 Add `scripts/backfill-public-tasks.mjs` in the house style of `scripts/emulator-restore.mjs`
      / `scripts/seed-local.mjs`: header comment stating the commands, `[backfill] …` logging,
      `console.error` + non-zero exit on failure.
- [x] 3.2 Print `describeTarget(...)` BEFORE any Firebase initialization, and exit 1 on a parse
      error (including the unconfirmed real-project execute) before any network call.
- [x] 3.3 Wire auth: emulator hosts defaulted to `127.0.0.1`, Admin SDK custom token with
      `{ admin: true }`, `signInWithCustomToken`; for a real project require
      `GOOGLE_APPLICATION_CREDENTIALS` and `RUSHPOINT_WEB_API_KEY`/`VITE_FIREBASE_API_KEY` with a
      specific error naming whichever is missing, and add a 5-second abort window before executing.
- [x] 3.4 Drive the paging loop with `decidePage`, printing one progress line per page (scanned /
      repaired / skipped / cleared / orphaned / cursor) and a final summary; print the resume cursor
      on any failure; exit non-zero on failure.
- [x] 3.5 Add ONE line to root `package.json`: `"backfill:public-tasks": "node
      scripts/backfill-public-tasks.mjs"` (re-read the file immediately before editing — it is owned
      by another agent — and change nothing else).
- [x] 3.6 Smoke the two guard paths that make no network call: `--help` exits 0, and
      `--project=<id> --execute` without confirmation prints the refusal and exits 1.

## 4. Runbook

- [x] 4.1 Add **DEPLOY.md §11** — the operator runbook: the symptom that means it is needed, what the
      leak is, the emulator rehearsal, the real-project prerequisites (service-account JSON + web API
      key) and exact commands, how to resume, how to verify success (re-run to `repaired: 0`,
      spot-check a document for no `coordinates`, look at the task-library map), and the tuning flags.
- [x] 4.2 Cross-reference the runbook from the script header and from this change's proposal/design.

## 5. REFACTOR & gates

- [x] 5.1 Review the new pure functions for duplication with existing script helpers; keep the
      argument/paging logic in one module with no filesystem or network reads.
- [x] 5.2 Run `npm run typecheck`, `npm run lint` and `npm test`; all must pass. Record output
      verbatim. `i18n:check` does not apply — no UI is touched.
- [x] 5.3 Run `npx openspec validate public-task-backfill-runbook --strict`; must pass.
- [x] 5.4 Explicitly record that the script has **never been run end to end**: the Firebase wiring
      (Admin SDK init, custom-token mint, sign-in, the callable round trip, the real-project
      credential path) is UNVERIFIED, and `npm run e2e` was not run, because a live playtest stack is
      serving from this tree and must not be disturbed.

## Context

The sweep already exists and is well built. What follows is what was read, not assumed.

- **The callable.** `backfillPublicTaskCoordinatesNow` (`functions/src/maintenance/index.ts:263-273`)
  calls `assertAdmin(context)` and forwards `{ limit, startAfter, dryRun }` to
  `backfillPublicTaskCoordinates`, returning `{ ok: true, ...result }`.
- **The gate.** `assertAdmin` (`maintenance/index.ts:34-39`) requires `context.auth.token.admin` and
  has **no emulator bypass** — the comment says so and `e2e-verify.mjs` mints a real custom token
  rather than leaning on one.
- **It is genuinely paged.** `backfillPublicTaskCoordinates`
  (`functions/src/maintenance/publicTaskBackfill.ts:66-165`) runs
  `db.collection('publicTasks').orderBy('__name__').limit(limit)`, applying `.startAfter(cursor)` when
  given, and returns `cursor` = the id of the **last document in the page** (`null` for an empty page)
  and `done` = `snap.size < limit`. `limit` is clamped server-side to 1…1000, default 500. So the
  loop contract is: call, take `cursor`, pass it back as `startAfter`, stop when `done`.
- **It is genuinely idempotent** — verified by reading, not by claim. Two independent reasons:
  (a) every document is pre-checked with `hasLegacyCoordinates(data)` and `continue`d if it does not
  carry the legacy field (`:97`), and (b) a repaired document is written with
  `{ coordinates: FieldValue.delete(), approxLocation: repair.approxLocation ?? DELETE }` (`:143-146`),
  i.e. the legacy field is **removed**, not nulled — so the repaired document fails the pre-check on
  the next pass and is skipped. `repairPublicTask` returning falsy is additionally treated as
  "nothing to do". `e2e-verify.mjs` asserts the same property from the outside
  (`the sweep is idempotent (repaired: 0 on a clean second pass)`).
  Writes are `set({merge:true})` in `≤MAX_BATCH_OPS` chunks, so a concurrent unpublish cannot fail
  the batch and lose the rest of the page. **Conclusion: the "paged and idempotent" claim holds.**
- **Its only caller is a test.** `grep` over the repo finds `backfillPublicTaskCoordinatesNow` in
  `functions/src/index.ts` (the re-export), `functions/src/maintenance/index.ts` (the definition) and
  `scripts/e2e-verify.mjs` (the sweep scenario + the authz denial matrix). Nothing else.
- **How the e2e suite authenticates as admin** (`scripts/e2e-verify.mjs:359-366`): the Admin SDK
  (initialized with `projectId` only, with `FIREBASE_AUTH_EMULATOR_HOST` set) mints
  `createCustomToken('e2e-platform-admin', { admin: true })` and the client SDK signs in with
  `signInWithCustomToken`. That is the mechanism this script reuses.
- **House style for an operator script** (`scripts/emulator-restore.mjs`, `scripts/seed-local.mjs`):
  a long comment header stating the command and what it does, `[tag] …` prefixed `console.log`s,
  `console.error` + `process.exit(1)` on failure, `process.env.*_EMULATOR_HOST ??= '127.0.0.1:…'`,
  `PROJECT_ID = 'rushpoint-pwa-7daaa'`.

**Hard constraint:** a live playtest/dev stack (Vite 5180/5181, Firestore emulator 8080) serves from
this tree and holds preserved user data. No emulator/Vite/tunnel/backup process may be started,
stopped or restarted, and the script must **not** be run against the live emulator — not even in
dry-run, since it needs an admin token against a live suite. Verification is therefore pure-logic
plus the two argument-guard paths that exit before any network call.

## Goals / Non-Goals

**Goals**
- Make the remediation invocable by a human with one npm command.
- Make the safe mode the default and the dangerous mode an explicit, project-id-retyping act.
- Make the target unmistakable *before* anything is written.
- Make progress visible per page, and the whole loop resumable, idempotent and bounded.
- Put every decision that can be wrong (flag parsing, the confirmation rule, the loop decision)
  behind pure functions with adversarial unit tests.

**Non-Goals**
- Changing the callable, the pure `repairPublicTask` rule, or what a repaired document looks like.
- Any UI, rules, shared-type or i18n change.
- Scheduling the sweep, or granting anybody a persistent admin claim.
- Actually running the sweep in this change.

## Decisions

### D1 — Pure logic in `scripts/lib/publicTaskBackfill.mjs`, I/O in the script

The same split as `scripts/lib/emulatorBackup.mjs` + `scripts/emulator-backup.mjs`. Three pure
functions carry every decision that can be wrong:

- `parseBackfillArgs(argv, env)` → `{ ok, errors[], help, mode, dryRun, target, projectId, limit,
  maxPages, startAfter }`
- `decidePage({ page, previousCursor, pageIndex, maxPages })` → `{ action: 'continue'|'stop'|'fail',
  cursor, reason }`
- `accumulateTotals(totals, page)` → running `{ pages, scanned, repaired, cleared, orphaned, skipped }`
- `describeTarget(args)` → the boxed pre-flight banner (pure string, so its wording is testable)

Everything else in `backfill-public-tasks.mjs` is Firebase I/O and printing.

### D2 — Dry-run is the default, and a contradiction resolves to the safe side

`--execute` is the only thing that clears `dryRun`. `parseBackfillArgs` always returns a fully
populated result, and when `ok === false` it returns `dryRun: true` — so a caller that ignores `ok`
still cannot mutate anything. `--execute --dry-run` together is an error *and* stays in dry-run,
rather than the parser picking a winner.

### D3 — A non-emulator target must be confirmed by retyping its id

`--project=<id>` (or `RUSHPOINT_BACKFILL_PROJECT`) selects a real project. Executing against it
requires `--confirm-project=<id>` **exactly equal** to the target id; a mismatched or missing
confirmation is a parse error, so the script exits 1 before initializing Firebase. A *dry-run*
against a real project needs no confirmation — it is read-only, and forcing a ceremony on the safe
rehearsal would push operators to skip straight to `--execute`. A stray `--confirm-project` can never
*select* a target, only unlock one.

Rejected: an interactive `readline` prompt. It cannot be unit-tested, and it does not work in CI or
over a non-TTY shell. A flag that must contain the project id is the same guard, testable.

### D4 — The loop is bounded three ways

`decidePage` fails — never loops — when any of these holds: the page is not an object; `ok !== true`;
a counter is present but non-finite; `done` is neither `true` nor `false`; `done === false` with no
non-empty string cursor; the cursor equals the previous one (no progress); or `pageIndex >= maxPages`
(default 200 pages ≈ 100k documents). Only "done" stops successfully. This is the difference between
a wedged terminal at 3 a.m. and a clear failure with a resume cursor.

### D5 — Auth mirrors `e2e-verify.mjs`, extended for real projects

- **Emulator:** `FIREBASE_AUTH_EMULATOR_HOST`/`FIRESTORE_EMULATOR_HOST` default to `127.0.0.1`,
  `adminSdk.initializeApp({ projectId })`, `createCustomToken(uid, { admin: true })`,
  `signInWithCustomToken` against `connectAuthEmulator`, callable via `connectFunctionsEmulator`.
- **Real project:** `GOOGLE_APPLICATION_CREDENTIALS` (a service-account JSON) supplies the identity
  that *signs* the custom token, and `RUSHPOINT_WEB_API_KEY` (or `VITE_FIREBASE_API_KEY`) lets the
  client SDK *exchange* it for an ID token. Both are checked up front with a specific error naming
  the missing one. Region comes from `RUSHPOINT_FUNCTIONS_REGION`, default `us-central1` (the repo's
  functions declare no region, so that is the deployed default).

No persistent claim is set on any user: `admin: true` exists only inside that one short-lived token.
This is deliberately the *smallest* privilege escalation that satisfies `assertAdmin`.

### D6 — Runbook lives in DEPLOY.md, not a new doc

`docs/README.md` states plainly that `docs/` holds point-in-time and historical material and that the
canonical operator docs are at the repo root. DEPLOY.md already carries operator runbooks in exactly
this shape (§7 first admin, §10 emulator backups). The backfill runbook is therefore **DEPLOY.md
§11**, cross-referenced from the script header and from this change.

### D7 — Progress output

One line per page: `page N · scanned · repaired · skipped · cleared · orphaned · cursor`, then a
summary block. `skipped = scanned − repaired` is computed here, not by the callable — it is the count
of already-conformant documents, which is the number that proves idempotence to an operator's eye.

## Risks / Trade-offs

- **The script triggers production writes.** Mitigated by D2/D3, the pre-flight banner, a 5-second
  abort window before a real-project execute, and the callable's own idempotence.
- **`--limit` is not clamped silently.** An out-of-range value is a hard error, because a silently
  clamped 5000 → 1000 would make an operator's page-count arithmetic wrong.
- **The script has never been executed end to end** (see Test Strategy). The pure decisions are
  covered exhaustively; the Firebase wiring is not, and that is stated as an open risk rather than
  hidden.

## Migration Plan

None — additive tooling. Nothing changes for any running system until an operator runs the command.

## Test Strategy

**Lane: pure logic only** (`scripts/test-public-task-backfill.ts`, run by `scripts/run-unit-tests.mjs`
via `npm test`). No emulator, no network, no credentials; the file cannot trigger a sweep.

House style: `ok(cond, msg)`, `passed`/`failed` counters, `process.exit(failed === 0 ? 0 : 1)`.

**`parseBackfillArgs`**
- no arguments → `ok`, `dryRun: true`, `mode: 'dry-run'`, `target: 'emulator'`, default limit/pages,
  `startAfter: null`
- `--dry-run` alone → accepted (redundant)
- `--execute` alone → `dryRun: false` (the only route out of dry-run)
- `--execute --dry-run` → `ok: false` **and still `dryRun: true`**
- `--project=<id>` alone → `target: 'project'`, still dry-run
- `--project=<id> --execute` → refused, and the error names `--confirm-project`
- `--confirm-project` naming a *different* project → refused
- `--confirm-project` matching exactly → accepted, `dryRun: false`
- `--project=` (empty) → error, not a silent fall back to the emulator
- a stray `--confirm-project` with no `--project` → still `target: 'emulator'`
- `--limit` / `--max-pages` / `--start-after` parse; `--limit=0|-3|abc|1001` and `--max-pages=0|x`
  are errors; `--limit=1000` (the callable's own max) is accepted
- an unknown flag is an error (a mistyped `--execute` must never run as a silent no-op)
- `RUSHPOINT_BACKFILL_PROJECT` selects the target and is subject to the same confirmation rule

**`describeTarget`** — the emulator banner says "emulator" and still prints the project id and the
mode; the real-project banner says `REAL PROJECT`/`PRODUCTION` and, when executing, says writes will
happen.

**`decidePage`**
- a full page, not done, fresh cursor → `continue`, carrying that cursor
- `done: true` → `stop`; `done: true` with `scanned: 0, cursor: null` (empty collection) → `stop`
- cursor identical to the previous one → `fail`, reason names the cursor
- `done: false` with `cursor: null` or `''` → `fail`
- `ok: false` or missing `ok` → `fail`
- `null` / `undefined` / a string / a number / an array as the whole response → `fail`
- non-numeric or `NaN` counters → `fail`
- `done: 'yes'` (truthy non-boolean) → `fail`, never read as done
- `pageIndex >= maxPages` → `fail`, reason names the budget; `pageIndex === maxPages - 1` → `continue`
- **a simulated endless server** (always returns a fresh cursor, never `done`) terminates at exactly
  `maxPages + 1` iterations

**`accumulateTotals`** — `skipped = scanned − repaired`; totals accumulate across pages; missing
counters contribute zero rather than `NaN`.

**Argument-guard smoke (no network):** `node scripts/backfill-public-tasks.mjs --help` exits 0, and
`--project=<id> --execute` (no confirmation) prints the refusal and exits **1** — both return before
any Firebase initialization, so they are safe to run beside the live stack.

**Gates:** `npm run typecheck`, `npm run lint`, `npm test`. No UI is touched, so `i18n:check` does not
apply.

**Explicitly NOT verified (stated, not assumed):** the script has **never been run end to end**. The
Firebase wiring — Admin SDK init, custom-token mint, `signInWithCustomToken`, the callable round trip,
and the real-project credential path — is unexercised, because doing so requires an admin token
against a live emulator suite or a real project, and the live playtest stack serving from this tree
must not be disturbed. `npm run e2e` (which does exercise the callable itself) was not run for the
same reason.

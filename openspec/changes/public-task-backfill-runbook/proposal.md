## Why

The `publicTasks` legacy-coordinate sweep exists, is correct, and **cannot be run by anyone**.

Verified in this working tree:

1. **The remediation has exactly one caller, and it is a test.** `backfillPublicTaskCoordinatesNow`
   (`functions/src/maintenance/index.ts:263`, exported at `functions/src/index.ts:28`) is invoked
   nowhere in the repo except `scripts/e2e-verify.mjs` (the admin-only sweep scenario and the authz
   denial matrix). There is no operator script, no npm script, and no admin UI.
2. **It is `assertAdmin`-gated with no emulator bypass** (`maintenance/index.ts:34-39`), so it cannot
   be reached from creator-web or play-web at all — not even by the game's owner, which the e2e
   denial matrix asserts on purpose.
3. **What it repairs is a live location-privacy leak.** Before `task-library-map-view`, `publishGame`
   copied a task's exact authored `coordinates` into `publicTasks/{gameId}_{taskId}`, whose Firestore
   rule is `allow read: if true` — `hideLocation` tasks included. That fix changed only what is
   written from then on; every document published before it still carries the exact point and carries
   no coarse `approxLocation`.
4. **The user hit it as a visible product bug tonight**: the creator task-library map is empty and
   reports that no task has a published area — because the map draws `approxLocation`, which those
   legacy documents do not have. The leak and the empty map are the same defect.

A remediation nobody can invoke closes nothing. The gap is not in the sweep; it is that the sweep has
no operator entry point, no safe default, no progress output, no documented credential path, and no
runbook.

## What Changes

**The sweep becomes runnable — safely — by a human at a terminal.**

- A new operator script, invoked as `npm run backfill:public-tasks`, drives the callable's paging
  loop to completion.
- **Dry-run is the default.** The script reports what it *would* repair and writes nothing unless the
  operator passes an explicit execute flag. The safe thing requires no knowledge; the dangerous thing
  requires an argument.
- **The target is stated loudly before anything happens** — a boxed banner naming the project id and
  whether it is the local emulator or a real project. Executing against a **non-emulator** target
  additionally requires the operator to retype that project id in a confirmation flag; without it the
  script refuses and exits non-zero. Sweeping production while meaning to sweep the emulator has to
  be hard.
- **Progress is visible.** One line per page — scanned, repaired, skipped, cleared, orphaned, and the
  cursor — plus a final summary. An operator running this against production is never staring at a
  silent terminal.
- **Resumable and idempotent.** Every page prints the cursor to resume from; the callable already
  skips conforming documents, so a second full pass repairs nothing and re-running after an
  interruption is safe.
- **Bounded.** A malformed response, a cursor that stops advancing, or a server that never reports
  `done` aborts with a non-zero exit rather than spinning forever.
- **Non-zero exit on failure**, so the script is usable from automation.

**The credential path is documented precisely, not implied.** Against the emulator the script needs
nothing: it mints an admin custom token with the Admin SDK exactly as `e2e-verify.mjs` does. Against
a real project it needs a service-account JSON (`GOOGLE_APPLICATION_CREDENTIALS`) plus the project's
web API key, and the runbook says so with the exact commands.

**A runbook ships with it** (DEPLOY.md §11): the commands in order, what the output means, how to
resume, how to confirm success (re-run to `repaired: 0`, spot-check a document, look at the map), and
how to tell whether the sweep is still needed at all.

### Non-goals

- **No change to the sweep itself.** `backfillPublicTaskCoordinatesNow`,
  `backfillPublicTaskCoordinates` and the pure `repairPublicTask` rule are untouched — no new
  callable, no changed callable signature, no change to what a repaired document looks like.
- **No Firestore rules, no shared types, no creator-web, no play-web, no UI, no i18n.**
- **No admin UI** for the sweep, and no persistent admin claim granted to anyone: the admin
  capability lives only inside one short-lived custom token minted per invocation.
- **Does not schedule the sweep.** It stays a deliberate, human-triggered one-time remediation.
- **Does not run the sweep.** This change ships the tooling; a live playtest stack is serving from
  this tree, so the script is deliberately **never executed end to end** here.

## Capabilities

### New Capabilities

- `public-task-backfill-operations`: the legacy-coordinate sweep is invocable by an operator, with a
  safe-by-default mode, an unmistakable target declaration and a confirmation requirement for real
  projects, visible per-page progress, resumability, a bounded loop, a failing exit code, and a
  documented runbook.

## Impact

- **Surfaces touched:** `scripts/` + docs only. **No** callables, **no** shared types, **no**
  Firestore rules, **no** creator-web/play-web, **no** i18n.
- **Files:** new `scripts/backfill-public-tasks.mjs` (operator entry point), new
  `scripts/lib/publicTaskBackfill.mjs` (pure argument/paging decisions), new
  `scripts/test-public-task-backfill.ts` (picked up by the `npm test` aggregator), one added line in
  root `package.json` (`backfill:public-tasks`), and a new **DEPLOY.md §11** runbook.
- **New env vars (all optional / operator-supplied):** `RUSHPOINT_BACKFILL_PROJECT`,
  `RUSHPOINT_WEB_API_KEY`, `RUSHPOINT_FUNCTIONS_REGION`; plus the standard
  `GOOGLE_APPLICATION_CREDENTIALS` for a real project.
- **Risk:** the script triggers writes to a world-readable collection in production. Mitigated by
  dry-run-by-default, the retype-the-project-id confirmation, the loud pre-flight banner, the
  callable's own idempotence, and by making every one of those rules a pure function with adversarial
  unit tests rather than inline argv handling.
- **Testing:** pure-logic lane only. The script is **not executed end to end** — it requires an admin
  token against a live Firebase project or emulator suite, and the live playtest stack serving from
  this tree must not be disturbed. That is stated, not assumed.

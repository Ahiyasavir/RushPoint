# RushPoint — multi-tenant "field game" platform

> Coding guidelines & Firestore path rules: [INSTRUCTIONS.md](INSTRUCTIONS.md) ·
> Architecture: [TECH_SPEC.md](TECH_SPEC.md) · Directory map: [STRUCTURE.md](STRUCTURE.md) ·
> **Going live + payments: [DEPLOY.md](DEPLOY.md)**

## ⚙️ How we work — Spec-Driven Development + TDD (mandatory)

Every non-trivial change goes through **OpenSpec** (spec-driven) and is built **test-first (TDD)**.
Trivial one-liners (typo, copy tweak, obvious bugfix with an existing test) may skip the ceremony.

**The loop** (slash commands provided by OpenSpec, see `.claude/commands/opsx/`):
1. `/opsx:propose "<what you want>"` — generates `openspec/changes/<name>/` with **proposal.md**
   (what & why) → **design.md** (how + test strategy) → **tasks.md** (RED→GREEN→REFACTOR steps).
2. Review/adjust the artifacts, then `/opsx:apply` — implement the tasks **strictly in order**.
3. `/opsx:archive` — once all gates are green, fold the change into the living specs.

**TDD is enforced by the task ordering** (see `openspec/config.yaml` rules): the first task of any
logic/callable change is *write a failing test*, then minimum code to green, then refactor. Test lanes:
- **Pure logic** (scoring/geo/validation/routing) → co-located **vitest** `*.test.ts` in `functions/`
  *or* a `scripts/test-*.ts` tsx assertion script — both run by `npm test` (vitest + the
  `scripts/run-unit-tests.mjs` aggregator). No emulator needed. The planned v2.1 work has a
  RED-phase blueprint in `functions/src/__planned__/v21-*.todo.test.ts` (`test.todo` per roadmap row).
- **Callable behavior** → add failing assertions to `scripts/e2e-verify.mjs`, then implement (`npm run e2e`).
- **UI** → verify via the preview tools (no component test runner).

**Gates before any change is done:** `npm run typecheck` · `npm run lint` · `npm test` ·
`npm run creator:build` · `npm run play:build` · `npm run bundle:budget` · `npm run base:check` ·
`npm run origin:check` · `npm run i18n:check:strict` ·
`npm run e2e` — all green (the first nine are exactly `npm run verify`). Project context +
per-artifact rules that drive proposals/designs/tasks live in
[openspec/config.yaml](openspec/config.yaml).

RushPoint is a **web platform where any creator builds and runs their own real-world team
"field game"** (scavenger-hunt / amazing-race style). A creator designs a game
(stages + geolocated tasks), launches a live run, shares an access code; participants join on
their phones, get routed between tasks, and are scored automatically. The original "Race to
Tzion" Jerusalem event is now just one game built on this platform.

> **History:** v1 was a single-event app (`apps/admin` + an Expo `apps/mobile` app, human judges,
> an 8/6-slot system, Tene baskets). **v2 replaced it** with this generic multi-tenant web
> platform — `apps/creator-web` + `apps/play-web`, automatic scoring, no judges. `apps/mobile`
> still exists on disk but is **archived** (not in the npm workspaces). Ignore v1 concepts.

---

## Architecture — monorepo (npm workspaces + Turborepo)

| Package | Tech | Purpose | Dev URL |
|---|---|---|---|
| `apps/creator-web` | React + Vite (dark theme) | **Creator console** — real Firebase Auth (email/Google). Build games, launch & run live ops. | http://localhost:5180 |
| `apps/play-web` | React + Vite PWA (light "Warm Trail" theme) | **Participant app** — anonymous auth (uid == teamId). Join, play, finish. Also hosts the **Staff console** (`?staff`). | http://localhost:5181 |
| `functions/` | Node 20 + Firebase Functions (v1 `onCall`) | All game/run/scoring/payment logic. Clients never write game state. | :5001 |
| `packages/shared` | TypeScript (`@rushpoint/shared`) | Canonical types, `FIRESTORE_PATHS`, scoring presets, geo/map helpers. | — |
| `scripts/` | Node (mjs / tsx) | Emulator launcher, seed, port cleanup, e2e. | — |

**Backend:** Firebase (Firestore, Auth, Cloud Functions, Storage) — local Emulator Suite in dev.
**Project id** `rushpoint-pwa-7daaa` (used as the Firebase project id everywhere).

---

## Local development — one command

```bash
npm install        # once
npm run dev:all    # boots EVERYTHING in one terminal
```

`dev:all` runs (via `concurrently`, after a `predev:all` port cleanup): **EMU** (emulator suite),
**SEED** (seed-if-empty once Firestore+Auth are up), **CREATOR** (Vite :5180), **PLAY** (Vite :5181).

**Emulator ports:** UI 4000 · Auth 9099 · Functions 5001 · Firestore 8080 · Storage 9199.
`dev:all` and every `playtest*` target always use exactly this block. Only an **emulator-bound
gate** can be shifted off it, via `RUSHPOINT_EMULATOR_PORT_OFFSET` (see
`scripts/lib/emulatorPorts.mjs` below) — that is how a gate runs beside a live playtest.

### Required gates (run before declaring anything done)
```bash
npm run typecheck        # all workspaces — must pass
npm test                 # pure-logic lane: scripts/test-*.ts aggregator + vitest in functions/
npm run lint             # creator-web eslint — 0 errors (style warnings ok)
npm run creator:build    # production build of creator-web — must pass
npm run play:build       # production build of play-web — must pass (don't let a play-web break slip through)
npm run bundle:budget    # play-web first-load byte budget + "heavy dep must stay lazy" (needs play:build first)
npm run base:check       # built index.html asset base == the path that dist is served from (needs the builds first)
npm run origin:check     # deployed bundles really carry VITE_API_ORIGIN + no .env.local exists (needs the builds first)
npm run e2e              # node scripts/e2e-verify.mjs — full lifecycle vs the emulator
npm run i18n:check:strict # ⚠ MANDATORY AFTER ANY UI CHANGE — Hebrew↔English correctness, PART B regressions fail
```
`npm run e2e` runs as isolated **scenarios** (a throw fails one scenario, not the whole suite;
ends with a per-scenario + per-callable-latency summary). Beyond the happy path it hunts bug
classes directly: the createGame→…→finalize lifecycle, partial stages, locationless routing,
paid hints, all task types, hidden-location, referral, consent, safe-zone; PLUS a **sanitizer
allowlist** (a new `Task` field fails loud instead of leaking — update `ALLOWED_TASK_KEYS`/
`ALLOWED_SMART_KEYS` in the script when you add one), a **leaderboard invariant oracle** +
live/final parity, a **station-contention** race (concurrent `requestNextTask` can't exceed a
station cap) + duplicate-submission idempotence, a **table-driven authz denial matrix**
(participant/stranger/other-run-staff/owner × privileged callables), and **seeded boundary
fuzz**. There is **no emulator authz bypass** — the suite mints a real `admin` custom-token and
real staff tokens, so authz runs the same as production. A **callable coverage guard** ends the
run: it introspects the callables the emulator serves and fails if any was never invoked (bar an
explicit `EXEMPT` list, itself checked for stale entries), so a **new callable ships RED until it
has a test** — add a scenario, don't just add the callable. The table below lists **99** callables
(plus `stripeWebhook`, the `pruneExpiredRunData` schedule and the `onRunFinalized` trigger, which
are not callables). Keep it green; extend the relevant scenario (not just the lifecycle).
`functions/src/__property__/invariants.property.test.ts` is the fast (no-emulator) invariant lane
— seeded-random property tests for scoring/ranking/answer/geo/rate-limit; run via `npm test`.
`npm run simulate` (scripts/simulate-run.mjs, `--teams=N`) is the v2 concurrent load sim — N
teams play a real game at once, then it audits leaderboard invariants + that every station
counter returns to 0. (`simulate:v1` is the archived v1 tournament script.)
**One-command gauntlets for agents:** `npm run verify`
(typecheck·lint·test·creator:build·play:build·**bundle:budget**·**base:check**·**origin:check**·**i18n:check:strict**,
no emulator) — the same nine gates as ever, now run in **three dependency-ordered phases** that each
parallelize internally (~2m45 cold, was ~13m):
`verify:graph` (ONE `turbo run typecheck lint test` — turbo's graph builds `packages/shared`
once and fans the rest out) → `verify:builds` (both app builds + the pure-logic lane + the i18n
check, concurrently) → `verify:artifacts` (bundle/base/origin, concurrently). The phase boundaries
are **not** stylistic: phase 1 is the single writer of `packages/shared/dist` (the in-place-rewrite
footgun below), phase 2 needs that dist stable, phase 3 needs phase 2's `dist/`. Note `verify:graph`
runs `typecheck lint test` and deliberately **never** `build` — turbo declares `dist-playtest/**`
as a build output, and letting it prune/restore that directory could wipe what a live playtest is
serving; the app builds therefore stay direct `npm run --workspace` calls. `concurrently` is given
no `--kill-others`, so a red gauntlet reports **every** failing gate in one pass.
And `npm run verify:emulator` (builds → e2e → **rules (Firestore + Storage in ONE lighter boot,
`--only=firestore,storage` via `scripts/run-rules-suites.mjs`: neither suite calls a callable, and
`@firebase/rules-unit-testing` mints its tokens locally, so the functions and auth emulators were
pure boot cost)** → 8-team simulate → adversarial simulate, each under its own self-booted suite — no
long-running emulator needed). The two HEAVY phases keep a fresh JVM each on purpose; only the two
LIGHT rules phases were merged. `npm run verify:emulator` is emulator-bound end to end; to run it **beside a live
playtest** use the port-offset lane (`RUSHPOINT_EMULATOR_PORT_OFFSET=1000`, see the
`scripts/lib/emulatorPorts.mjs` note below).

> 🌐 **i18n gate — if you touch ANY UI (text, JSX, components, `i18n.ts`), you MUST run
> `npm run i18n:check:strict` and it MUST come out clean** — `npm run verify` runs the STRICT
> variant, so a PART B regression now fails the gauntlet. It guarantees Hebrew copy is really Hebrew
> and English copy is really English, and that no component hardcodes a UI string that won't switch
> language (the recurring "English text showing while the app is in Hebrew" bug, especially in the
> Builder). **PART A (dictionaries) is a hard gate — never ship with a PART A error.** PART B lists
> hardcoded strings that bypass `t.*`: fix the ones your change touches (route the text through
> `t.*`), or, for a deliberate non-switchable literal (brand mockup, sample data), add a trailing
> `// i18n-ignore` on that line with a reason. New UI must add **zero** new PART B warnings — verify
> with `npm run i18n:check:strict`. See [scripts/check-i18n.ts](scripts/check-i18n.ts). The
> "this Hebrew string leaks English / this English string leaks Hebrew" predicate lives in exactly
> ONE place — `scripts/lib/i18nLeak.ts` — imported by both `check-i18n.ts` and
> `test-i18n-parity.ts`; fix the rule there, never in a checker.

### What the dev scripts handle (hard-won — don't regress)
- **`scripts/dev-emulator.mjs`** — detects Java and **auto-switches to a JDK ≥ 21** (the emulator
  needs 21+). **Builds Cloud Functions before** the emulator starts (a stale `functions/lib` was a
  past failure). Data persists via `--import`/`--export-on-exit` to `.firebase/emulator-data`.
- **`scripts/free-ports.mjs`** (`predev:all`) — kills stale Vite/emulator processes.
- **`scripts/seed-local.mjs`** — seeds only if empty (idempotent): a demo creator (`demo-creator`),
  the "Old City Treasure Hunt" demo game, a live run + access code. `npm run seed:reset` re-seeds.
- **`scripts/check-bundle-budget.mjs`** (`npm run bundle:budget`) — measures the BUILT play-web
  (`play:build` first) against a first-load byte budget **and** asserts the heavy deps
  (maplibre-gl / jsqr / qrcode) are absent from the entry chunk. Decisions are pure in
  `scripts/lib/bundleBudget.mjs`, unit-tested by `scripts/test-bundle-budget.ts`.
- **`scripts/check-build-base.mjs`** (`npm run base:check`) — reads each built
  `apps/<app>/<outDir>/index.html` and asserts its asset base is the path that directory is served
  from (`ARTIFACT_CONTRACT`: everything is `/` except creator-web's `dist-playtest`, which is
  `/creator/` because both apps share one tunnel origin behind the proxy). An unbuilt
  directory is skipped, never failed. Decisions are pure in `scripts/lib/buildArtifactGuard.mjs`
  (which also asserts the `package.json` build/serve wiring), unit-tested by
  `scripts/test-build-artifact-guard.ts`. See the gate-vs-playtest gotcha below.
- **`scripts/check-backend-origin.mjs`** (`npm run origin:check`) — asserts each DEPLOYED bundle
  (`apps/<app>/dist`) actually contains the `VITE_API_ORIGIN` its own `.env` declares, and that no
  app carries a `.env.local`. Both halves exist because of a real outage (see the env-override
  gotcha below): every other gate stayed green while creator.rush-point.com could not load a
  single game. `dist-playtest` is deliberately NOT covered — it is emulator-bound by design.
  An unbuilt directory is skipped, never failed. Decisions are pure in
  `scripts/lib/backendOriginGuard.mjs`, unit-tested by `scripts/test-backend-origin-guard.ts`.
- **`scripts/backfill-public-tasks.mjs`** (`npm run backfill:public-tasks`) — operator entry point
  that drives the admin callable `backfillPublicTaskCoordinatesNow` to completion, repairing
  legacy `publicTasks` docs that still carry exact `coordinates`. **DRY-RUN by default**; a real
  project needs `--execute --confirm-project=<id>`. Runbook: DEPLOY.md §11. Pure paging/arg logic
  in `scripts/lib/publicTaskBackfill.mjs` (`scripts/test-public-task-backfill.ts`).
- **`scripts/lib/emulatorReap.mjs`** (pure) **+ `scripts/lib/reapEmulatorExec.mjs`** (shell) — a
  finished `emulators:exec` can leave firebase-tools/JVMs/functions-runtime holding
  8080/9099/5001/4000 and wedge the next gate. The pure file decides which pids are orphans; the
  shell enumerates, reads `.firebase/emulator-exec-sessions.json` and kills only those. **Fails
  closed**: a process dies only when lineage attributes it to a FINISHED exec session of THIS repo,
  so a live dev/playtest stack is never touched. `RUSHPOINT_REAP_DISABLE=1` disables it,
  `RUSHPOINT_REAP_DEBUG=1` prints verdicts and kills nothing (`scripts/test-emulator-reap.ts`).
  It reasons **only** about lineage, session records and process age, **never about ports** — so it
  is offset-agnostic by construction; don't make it port-aware (that would let a port coincidence
  authorise a kill).
- **`scripts/lib/emulatorPorts.mjs`** (pure) — the single source of truth for the emulator port
  block, so an emulator-bound gate can run **beside a live playtest** instead of fighting it for
  8080/9099/5001/9199/4000. `RUSHPOINT_EMULATOR_PORT_OFFSET=1000 npm run verify:emulator` shifts the
  whole suite (ui · hub · logging · functions · hosting · firestore · firestore-websocket · auth ·
  storage). **Unset / empty / `0` / garbage ⇒ byte-for-byte today's ports**, and
  `emulator-exec.mjs` then passes no `--config` at all, so the default command line is unchanged.
  An offset is snapped UP to a multiple of 1000 on purpose: no pairwise gap between two default
  ports is a multiple of 1000, so a shifted port can never land on a LIVE emulator's port (a naive
  `+1019` puts the gate's Firestore on the live Auth port). Because the Firebase CLI has **no port
  flags**, an offset run generates root-level `firebase.emulator-offset.json` (gitignored) and
  passes `--config`; it must be in the ROOT because the CLI resolves a config's relative paths
  against that file's own directory. `dev:all` / `playtest*` deliberately ignore the offset and
  always use the default block. `scripts/test-emulator-ports.ts` pins all of it.
- **`scripts/lib/emulatorIsolation.mjs`** (pure) — **moving the ports was not enough.** The Firebase
  CLI's emulator-hub *locator* is keyed by **project id alone** and lives in `os.tmpdir()`
  (firebase-tools@15.18.0 `lib/emulator/hub.js:24-32`), and it is the ONLY way
  `firebase emulators:export` picks a target (`lib/emulator/controller.js:730-745`; there is no
  `--host`/`--port`). So the playtest's 120 s backup loop could aim its export at the GATE's
  Firestore and wedge it — an offset gate died mid-suite with a completely clean
  `firestore-debug.log`, and the CLI printed "you are running multiple instances of the emulator
  suite". An offset run therefore also gets a **private temp dir**
  (`TEMP`/`TMP`/`TMPDIR` → `.firebase/emulator-offset-tmp/offset-<n>`) ⇒ a private locator neither
  suite can read or overwrite. Note the CLI does NOT overwrite a live locator: it warns and gives
  up, so ownership goes to whoever booted while the file was absent and never changes hands —
  which is why the fix must be "don't share the file", not "write it later".
  `RUSHPOINT_EMULATOR_ISOLATE_DISABLE=1` rolls it back; at offset 0 **nothing** is overridden.
- **`scripts/lib/staleHelperSweep.mjs`** (pure) **+ `scripts/free-ports.mjs`** (shell) — free-ports
  used to kill emulators by **command-line pattern** only, so a playtest restart destroyed an
  in-flight offset gate (it matches `emulators:exec`, `.cache\firebase\emulators`,
  `functionsEmulatorRuntime` AND `scripts/emulator-exec.mjs`) no matter which ports it held. A
  pattern match is now necessary but **not sufficient**: a match is spared when it is the sweeper or
  its ancestor, when its lineage reaches a **still-running** session in
  `.firebase/emulator-exec-sessions.json` (root, ancestor-of-root or descendant, including an orphan
  naming an absent root), when its command line carries an offset marker, or when it is an emulator
  on a `--port` outside the block being swept. The playtest's own default-block emulators carry
  `--port 8080`/`9099`, no marker and no running session, so they still die exactly as before. An
  unfinished session record expires after 6 h so a crashed gate can't make its debris immortal.
  `scripts/test-emulator-gate-isolation.ts` covers both modules.
- **`scripts/lib/callableHardening.mjs`** — pure static analysis of the callable surface: every
  `loggedCallable` must carry an auth marker (unless in the declared public allowlist) and every
  privileged one must write an `auditLogs` record. Both lists are **declared, never inferred**, so a
  callable that loses its auth assertion fails. Run by `scripts/test-callable-hardening.ts`.
- **`scripts/lib/playA11yScan.ts`** — pure source scan of play-web `.tsx` (no component test runner
  exists): physical-direction Tailwind classes (Hebrew is the default language, so `ml-2` is a
  mainline bug), icon-only `<button>`s with no accessible name, `onClick` on non-interactive
  elements, plus a WCAG `contrastRatio` helper. Run by `scripts/test-play-a11y-scan.ts`.
- **Rules suites (emulator-bound, NOT in `npm test`):** `npm run test:rules`
  (`scripts/test-rules.mjs`, Firestore) and `npm run test:rules:storage`
  (`scripts/test-storage-rules.mjs`, Storage — participant photo/audio prefixes, staff run scoping,
  size/content-type limits, dead legacy prefixes). **Both** are in `verify:emulator`; run either one
  on its own under `scripts/emulator-exec.mjs` when you touch only that rules file.
- **`scripts/run-unit-tests.mjs`** (the pure-logic lane) auto-discovers every
  `scripts/test-*.ts` and runs each in **its own tsx process, ~7 at a time** (`cpus-1`, capped at
  12). One process per file is deliberate — these are top-level programs that end in
  `process.exit(...)` and import product singletons, so a shared process would mean shimming exit
  and letting one file's module state reach the next; isolation is the whole point of the lane. It
  used to shell out to `npx tsx <file>` with `shell: true`, SERIALLY: **4.6 s of npx + cmd.exe +
  tsx boot per file × 193 files = 10m08s**, of which the assertions were ~20 ms each. Spawning
  `process.execPath --import tsx` directly and filling the idle cores took it to **59 s at 98%
  parallel efficiency** — measured, not estimated. Output is buffered per file and a failure is
  replayed IN FULL at the end, so a red run reads better than the serial one did. There is now also
  a per-file timeout (`RUSHPOINT_UNIT_TIMEOUT_MS`, default 120 s) — the old runner had none, so one
  hang wedged the gate forever. `RUSHPOINT_UNIT_CONCURRENCY=1` restores serial live-streamed output
  for debugging. Same lesson elsewhere: `npx <bin>` inside an npm script is pure overhead — npm
  already puts every workspace's and the root's `node_modules/.bin` on PATH.
- **New pure suites in `npm test`** (each is a `scripts/test-*.ts` run by the aggregator):
  `test-bundle-budget` · `test-callable-hardening` · `test-emulator-reap` · `test-play-a11y-scan` ·
  `test-public-task-backfill` · `test-public-task-seed` (publicTasks privacy on the write path) ·
  `test-stuck-player-guards` (retry lockout, offline gate, GPS retry) · `test-game-presentation`
  (`BUILDER_EDITABLE_FIELDS` completeness) · `test-enforced-settings` · `test-tags` ·
  `test-play-web-i18n-dictionary` · `test-i18n-leak` (the shared leak predicate + that both checkers
  import it) · `test-legal-routes` · `test-join-code` · `test-held-team-notice` ·
  `test-task-duration-defaults` · `test-build-artifact-guard` (asset base vs. serve path + the
  playtest build/serve wiring) · `test-emulator-ports` (the offset resolver + the generated config) ·
  `test-emulator-gate-isolation` (private hub locator + the free-ports sweep verdicts) ·
  `test-task-media-durability` (stored media survives a runtime whose accept-set refuses it) ·
  `test-task-media-repair` (the orphan-recovery planner) · `test-upload-origin-parity` (the
  canonical upload origin is declared identically in shared and functions/server.js) ·
  `test-hidden-search-area` (the coarse sealed-task circle + the play-web selector) ·
  `test-map-recenter` (the play map's recentre verdict) · `test-skip-single-task` (`planTaskSkip`) ·
  `test-gallery-task-detail` (the gallery mission detail view-model + its secrecy sweep) ·
  `test-creator-tour` (the guided-tour step data, reducer and persistence). The runner
  **auto-discovers** every `scripts/test-*.ts` — drop a file in and it is in the gate.

> ⚠️ **Stop with Ctrl+C** so `--export-on-exit` persists emulator data.
> ⚠️ Client configs connect over **`127.0.0.1`** (not `localhost`) to avoid the Windows IPv6 mismatch.

---

## Firestore data model ⚠️ (multi-tenant — never deviate)

```
users/{ownerUid}                                              creator profile + wallet ref
users/{ownerUid}/games/{gameId}                              private game template (the Builder edits this)
                                                             `deletedAt`/`deletedBy` = TOMBSTONE (soft delete);
                                                             rules deny client delete + tombstone edits
users/{ownerUid}/games/{gameId}/runs/{runId}                 a live run (CF-written only)
                                                             `taskStatusOverrides` = per-RUN task
                                                             pause/close (setRunTaskStatus), never
                                                             on the template
       …/runs/{runId}/teams/{teamId}                         a team/individual's full progress (teamId == participant uid)
       …/runs/{runId}/{announcements|flashMissions}          live-ops broadcasts (read: any authed)
       …/runs/{runId}/{alerts|teamLocations|staffInvites}    SOS, live map pings, staff PINs
       …/runs/{runId}/{chat|feedItems|locationTrack}         team↔HQ chat, live photo feed, GPS track (90-day prune)
publicGames/{gameId}, publicTasks/{taskId}                   denormalized gallery (public read). A publicTask's
                                                             `approxLocation` is the EXACT authored point of
                                                             EVERY located mission — hidden included
                                                             (gallery-exact-hidden-location): the creator's map
                                                             must be accurate, and the in-game hidden puzzle is
                                                             sealed separately by the participant sanitizer.
                                                             Locationless/unplaced ⇒ field omitted. The deprecated
                                                             exact `coordinates` key is never written.
wallets/{uid}, wallets/{uid}/transactions/{txId}             creator credit ledger
accessCodes/{CODE}                                           join-code → {ownerUid, gameId, runId}
auditLogs/{id}                                               immutable admin trail (CF only)
```

**Run / team / score / leaderboard docs are SERVER-WRITE-ONLY.** `firestore.rules` deny client
writes; only Cloud Functions (Admin SDK) write them. To add a mutation, write a **callable** in
`functions/` and a typed wrapper in the app's `services/calls.ts` — never a client write.
Always use `FIRESTORE_PATHS` from `@rushpoint/shared`; never hardcode path strings.

**Auth:** creator-web = real Firebase Auth (email/Google). play-web = anonymous (uid == teamId).
**Staff** sign in with a one-time PIN → `staffSignIn` mints a custom token (claims: `staff`,
`ownerUid/gameId/runId`) → scoped Firestore read of that one run's teams + alerts.

---

## Cloud Functions — by domain module

All callables are re-exported from `functions/src/index.ts`. `completeTaskForTeam` and the routing
helpers are **internal** (not triggers) — never re-export them.

| Module | Callables |
|---|---|
| `games/index.ts` | createGame · updateGame · **deleteGame (SOFT: tombstone + 30-day trash)** · listDeletedGames · restoreGame · purgeGameNow · duplicateGame · publishGame · getGame · listGames · checkChallengeAnswer · translateGame · **exportGameFile** · **importGameFile** |
| `runs/index.ts` | launchRun · joinRun · getJoinInfo · startTeams · skipStage · **skipTaskForTeam (skips ONE mission for ONE team, stays in the stage)** · finalizeRun · refreshLeaderboard · getPublicLeaderboard · getRunRecap · getRunReplay · getRunAnalytics · getRunSummary · getRunHeatmap · listRunTeams · completeTask · requestNextTask · requestTaskHint · reportArrival · submitTaskAnswer · submitSequenceStep · getRecommendedTasks · checkOutTask · getMyTeamState · listLiveRuns · getMyProfile · createTrackable · getRunTrackables · pickUpTrackable · dropTrackable · startInstantPlay · createZone · deleteZone · getRunZones · captureZone · joinTeamAsDevice · transferController · claimController · submitRunFeedback · getRunFeedbackSummary · getRunSurveyResults · requestGuardianConsent · grantGuardianConsent · activateHotZone · deactivateHotZone · getRunDiscoveryPois · claimDiscoveryPoi · **onRunFinalized (Firestore trigger, not a callable)** |
| `gallery/index.ts` | searchGallery · searchTaskLibrary · incrementTaskCopyCount · **setPublicLike** |
| `payments/index.ts` | getWallet · getWalletStatus · purchaseCredits · subscribePro · claimReferral · stripeWebhook (onRequest) |
| `users/index.ts` | updateMyProfile · exportMyData · deleteMyAccount |
| `maintenance/index.ts` | pruneExpiredRunDataNow · purgeDeletedGamesNow · **backfillPublicTaskCoordinatesNow** · pruneRunNow · pruneExpiredRunData (pubsub schedule, not a callable) |
| `admin/index.ts` | **listPlatformUsers** (admin-only creator activity rollup: games created, runs launched, derived last-active, time on site, activation stage — see `apps/creator-web` `/admin/users`) · **recordEngagement** (NOT admin-only: every creator flushes their OWN engaged time; uid from the token, value clamped by `clampEngagementDelta`, stored in the server-only `userEngagement/{uid}`) · **setUserNote** (admin-only private note ABOUT a creator, server-only `userNotes/{uid}`; empty CLEARS the doc. Both collections are deleted by `deleteMyAccount` — they live OUTSIDE `users/{uid}` so the recursiveDelete does not reach them) |
| `index.ts` (root) | inviteStaff · staffSignIn · updateLocation · triggerSOS · **sendTeamChatMessage** · acknowledgeAlert · **clearTeamOutOfBounds** · pushAnnouncement · deactivateAnnouncement · pushFlashMission · **reactToFeedItem** · **reportFeedItem** · **hideFeedItem** · verifyStationCode · submitStationPhoto · reviewStationSubmission · adjustTeamScore ·
**setRunTaskStatus** (pause/close/resume ONE task for ONE run) · listAuditLogs |
| `routing/assignNextTask.ts` | (internal) `assignTask` · `buildRecommendations` · `computeSkillRatio` · `releaseTask` |
| `scoring/` | `taskScore.ts`, `calculateScore.ts`, `scoringPresets.ts` (in shared), `stationVerification.ts` |
| `batchUtil.ts` | (internal) `chunk` · `deleteDocsInChunks` — every sweep commits in ≤`MAX_BATCH_OPS` (450) chunks |

---

## Core concepts

### Game → Stage → Task
A **Game** has ordered **Stages**; each Stage has 1+ **Tasks**. A stage unlocks the next when
complete; the `isFinal` stage triggers the Final screen. Task **types**: `field` (check-in),
`self_report`, `smart_station` (secret code), `photo` (upload → staff review or auto-approve),
`quiz` (multiple-choice or typed answer; `answers[]`), `numeric` (`numericAnswer` ± `numericTolerance`),
`geofence` (auto check-in within `geofenceRadiusMeters` — server validates GPS), `sequence`
(ordered `steps[]` at one stop). **Answer keys are server-secret** — the participant sanitizer
strips `answers`/`numericAnswer`/`steps[].answer`/`hint`/`secretCode`; verify via `submitTaskAnswer`
/ `submitSequenceStep` / `verifyStationCode`.

- **Partial-completion stages** — `Stage.requiredTaskCount`: a team completes only N of M tasks;
  routing picks the best-suited subset and the rest auto-skip. Undefined = all tasks.
- **Locationless tasks** — `Task.locationless`: a general task with no map pin, done from anywhere
  (zero transit in routing, off the map + distance badge).
- **Paid hints** — `Task.hint` + `hintPenalty`: participants reveal a hint for a point cost
  (`requestTaskHint`, charged once per team/task). The hint **text is never** in the task payload —
  the sanitizer exposes only `hasHint` + cost.
- **Clock-pausing tasks** — `Task.pausesTimer`: while a team is on this task its race clock stops.
  The server stamps `RunTaskRecord.excludedMs` ONCE at completion from its own
  `startedAt → completedAt` span (`packages/shared/src/pausedClock.ts`); `buildRankings` sums the
  stamps and feeds every time-derived term. Not a secret — sanitizer passthrough.
- **Live task pause** — `setRunTaskStatus` writes `Run.taskStatusOverrides[taskId]` =
  `active|paused|closed` for THAT run only. Routing resolves it via `effectiveTaskStatus()`
  (`packages/shared/src/liveTaskStatus.ts`); the completion path never reads it, so a team already
  holding a paused task still finishes and scores it.
- **Mutually exclusive tasks** — `Stage.exclusiveGroups`: a team may complete at most one task per
  group. `maxCompletableTasks()` (`packages/shared/src/mutualExclusion.ts`) is the single ceiling
  read by the Builder, `updateGame`/`importGameFile` validation and the live pause guard.
- **Default task durations** — `packages/shared/src/taskDuration.ts` derives
  `expectedDurationMinutes` from the task's own interaction (authoring time only; no scoring path
  calls it, so no in-flight or finalized run moves).
- **Hidden missions get a search AREA, never a pin** — a still-sealed `locationHidden` task's
  participant payload carries `searchArea {lat, lng, radiusMeters}` from
  `hiddenSearchArea(task)` (`packages/shared/src/hiddenSearchArea.ts`): a grid-snapped circle
  guaranteed to contain the real spot. It is the ONLY locational value a sealed payload has ever
  shipped — `sanitizeTaskForParticipant` still builds the sealed stub by construction, so no
  `coordinates` / `geofenceRadiusMeters` / `smart` reaches it, and `reportArrival`'s server GPS
  verdict is still the only thing that unseals.
- **Skip ONE mission for ONE team** — `skipTaskForTeam` (owner or run-scoped staff) marks a single
  task `skipped` with `earnedScore: 0`, releases its station slot, keeps the team **in the same
  stage** and, if the skip put `requiredTaskCount` out of reach, lowers that team's stored
  requirement by the smallest winnable amount. `planTaskSkip` (`packages/shared/src/taskSkip.ts`)
  is the arithmetic. `skipStage` (whole stage + its `skipAward` consolation) is unchanged — this is
  an addition, not a replacement.

### Scoring — 3 automatic presets (NO human judge), see `packages/shared/scoringPresets.ts`
- `time_only` — ranked purely by completion time.
- `fixed_points_speed` — fixed points per task + a speed bonus.
- `smart_weighted` — sigmoid time multiplier × difficulty.
Final ranking (`finalizeRun`): `Σ earned + completion bonus − bonusPenalty`, then a Z-Score time
normalization. `bonusPenalty` absorbs hints + adjustments. `buildRankings()` is shared by
`finalizeRun` and `refreshLeaderboard` so live and final standings can't drift.

### Smart routing (`routing/assignNextTask.ts`) — **preset-aware**
`smart_weighted`: `0.5·load − 0.3·transit + 0.2·skill` (load = station availability, transit =
walking haversine, skill = difficulty fit to the team's measured pace). `fixed_points_speed` /
`time_only`: `0.6·load − 0.4·transit` (nearest available, no skill target). Locationless ⇒ transit 0.

### Live ops & resilience
Staff/creator push **announcements** + **flash missions** (bilingual EN/HE) + a **live leaderboard**
(`refreshLeaderboard`, organizer-only until `published`). Participant app is offline-hardened:
Firestore `persistentLocalCache`, a service worker (offline app shell), an offline banner, a crash
ErrorBoundary, screen wake-lock while racing, and a lazy-loaded map chunk. User-authored content
uses `dir="auto"` so Hebrew renders RTL without full chrome i18n.

---

## Where things live (navigation)

- **Add/realize a backend mutation** → callable in the right `functions/src/<domain>/index.ts`
  + re-export in `functions/src/index.ts` + wrapper in the app's `services/calls.ts`.
- **Creator UI** → `apps/creator-web/src/pages/*` (Dashboard, Builder, Gallery, Wallet, RunConsole,
  RunsOverview, Settings, Trash);
  shared kit in `components/ui.tsx`; data layer `services/api.ts` (`callable()`) + `services/calls.ts`.
  Builder is tile + modal (`BuilderPage` `TaskEditor`); quick-start templates in `templates.ts`;
  whole-route `RoutePreviewMap` on the Preview step. New-game flow seeds a template via updateGame.
  The Run Console's layout is DATA, not inline JSX conditions — `lib/runConsoleLayout.ts`
  (`buildRunConsolePlan` → `pinnedPanels` + `buildRunConsoleSections` + `assignPanelColumns`) drives
  a Builder-style section rail; `lib/teamAttention.ts` and `lib/photoReviewQueue.ts` are the pure
  (clock-injected, never-throwing) triage verdicts the console renders. Also pure and console-owned:
  `lib/runConsoleSignals.ts` (`buildRunSignals` — the ranked "what needs you right now" strip; a
  quiet run yields `[]`), `lib/runConsolePanelMeta.ts` (icon + title/help/empty copy contract per
  `PanelId`, so no panel can ship nameless), `lib/runConsoleActions.ts` (severity **and** the
  `CONSEQUENCE` record + `teamRowActions` inline/overflow split) and `lib/runConsoleLabels.ts`
  (`resolveEnumLabel` — no raw enum or uid reaches a human). Gallery/library mission detail is a
  view-model, not markup: `lib/galleryTaskDetail.ts` copies named fields OUT of a `PublicTask`, so
  an unknown future field can never reach the screen. Every route is mounted through
  `lib/lazyWithRetry.ts`, never bare `React.lazy` — any rebuild renames the hashed route chunk the
  open tab still asks for, so a bare lazy import 404s and drops a healthy session on the
  ErrorBoundary crash screen. It reloads ONCE per key, then rethrows honestly. play-web carries its
  own copy at the same path, behaviourally matched and deliberately duplicated rather than shared
  (`packages/shared` is framework-free — no React dependency).
  First-run onboarding is also DATA: `lib/creatorOnboarding.ts` holds BOTH the derived checklist and
  the guided tour (`TOUR_STEPS`, `tourReducer`, `shouldAutoStartTour`, the `localStorage`
  `rp-tour-seen:<uid>` record); `components/CreatorTour.tsx` only renders it, anchoring on
  `data-tour` attributes. No callable, no server state.
- **Participant UI** → `apps/play-web/src/screens/*` (Join, Play, Final, StaffConsole,
  GamePromo, PublicLeaderboard) + `components/*` (TaskRunner, NavMap, LiveOps, ConnectionBanner).
  Session in `store.ts`. **Public marketing routes** (no router; `App.tsx` reads query params):
  `?game=<id>` → game promo/teaser (public `publicGames` read), `?board=<accessCode>` → public
  shareable leaderboard (`getPublicLeaderboard`, published-only). Shareable "story" images are
  canvas-drawn in `lib/storyCard.ts` (`shareStoryCard()` — finish + in-run brag cards).
  **Legal pages** are served at the participant origin too: `/terms` and `/privacy` resolve via
  `resolveLegalPath()` in `lib/playRoute.ts` → lazy `screens/LegalScreen.tsx`, which deep-imports
  `@rushpoint/shared/legalContent` + `/legalMarkdown` (never the barrel — the prose must stay out of
  the entry chunk). creator-web keeps `/creator/terms` + `/creator/privacy` off the same source.
  Other pure play-web decisions: `lib/stuckGuards.ts` (fail-open submit/GPS guards),
  `lib/holdNotice.ts` (why a held team is still waiting), `lib/joinCode.ts` (join-code normalize +
  error mapping), `lib/searchAreas.ts` (`selectSearchAreas` — which sealed hidden missions get a
  circle on the map; total, never throws), `lib/recenter.ts` (`recenterVerdict` — is there a usable
  fix, and where should the camera go; drives the map's "focus back on me" button, which replaced
  MapLibre's `GeolocateControl` so the app runs exactly ONE geolocation watch).
- **Marketing & virality** — branded OG images at `apps/*/public/og.jpg` (see
  [scripts/og-cards.README.md](scripts/og-cards.README.md)); creator landing page is the
  logged-out `AuthGate`; `ShareSheet` (QR + copy + native share) powers game-promo and referral
  invites; referral program = `claimReferral` + `?ref=<uid>` capture in `AuthGate` (grants a free run to
  both sides, `REFERRAL_BONUS_FREE_RUNS`). The play-web finish screen also carries a `?ref=<ownerUid>`
  "Powered by RushPoint" footer on non-Pro runs.
- **Types / paths / scoring / geo** → `packages/shared/src` (`types/index.ts`, `scoringPresets.ts`,
  `geo.ts`, `mapStyle.ts`, `validation.ts`; plus `pausedClock.ts`, `taskDuration.ts`,
  `liveTaskStatus.ts`, `mutualExclusion.ts`, `safeZone.ts`, `chat.ts`, `tags.ts`,
  `hiddenSearchArea.ts` (the coarse circle a SEALED hidden task reveals to a PLAYER — separate from
  `publicTaskLocation.ts`, which now publishes the EXACT authored point of every located mission to the
  world-readable gallery, hidden included (gallery-exact-hidden-location); the in-game hidden puzzle is
  sealed only by the participant sanitizer, not by this projection),
  `taskSkip.ts` (`planTaskSkip` — what skipping ONE mission does to the team's stage)). `legalContent.ts`
  + `legalMarkdown.ts` are deliberately **not** in the barrel — deep-import them only.
- **Maps** — MapLibre + MapTiler `outdoor` with a keyless OpenTopoMap fallback; style via
  `resolveMapStyle()` in `@rushpoint/shared/mapStyle`.

## Conventions & gotchas (already hit — don't repeat)
- **Server-only state:** never write run/team/score/leaderboard from a client; rules block it.
- **`.set({merge})` + dotted keys is a footgun:** `{['a.b']: v}` in `.set()` writes a *literal*
  top-level field named "a.b", NOT a nested path. Use a real nested object. (`.update()` dotted keys
  ARE nested paths — but never dotted-update an **array** element; it coerces the array to a map.)
- **Tailwind:** static class strings only (no `bg-${x}`). play-web reverses the zinc scale so
  `text-zinc-100` reads dark-on-light. Prefer logical classes (`ms-`/`text-start`) for RTL.
- **Emulator:** needs Java ≥ 21 (launcher auto-switches); connect via `127.0.0.1`; Ctrl+C to persist.
- **Bundle:** keep heavy deps (MapLibre) behind `React.lazy`. `npm run bundle:budget` fails on a
  collapsed code split — a single static import re-entering the play-web entry chunk still builds
  and still passes every other gate.
- **Never ship an absolute deadline to a device clock:** an `until` instant counted down against the
  phone's clock freezes a slow-clocked phone. Decide on the server, send a **remaining duration**,
  and bound it on READ so an out-of-range stored value self-heals
  (`packages/shared/src/wrongAnswerPenalty.ts` — `evaluateRetryLockout`; the low-level
  `cooldownRemainingSeconds` needs BOTH args from the same clock).
- **Every client-side blocking flag must fail OPEN** — the server re-validates every submission, so a
  wrong client gate must still let the player through. `navigator.onLine` reads `false` on working
  connections: warn once per task, then send anyway
  (`apps/play-web/src/lib/stuckGuards.ts` `offlineSubmitGate`).
- **Never permanently `clearWatch` a geolocation watch on error** — one transient
  POSITION_UNAVAILABLE kills auto check-in for a task type with no manual submit. Restart on capped
  backoff (`stuckGuards.ts` `gpsRetryDelayMs`, 3 s → 30 s).
- **Low-confidence GPS is not proof.** A safety verdict must be total and fail open: absent, stale,
  malformed, low-accuracy or staff-overridden ⇒ not a violation; only a fresh fix clearing the
  boundary by more than its own error radius counts (`packages/shared/src/safeZone.ts`
  `evaluateSafeZoneStatus`). `clearTeamOutOfBounds` is the staff escape hatch (grace window so the
  next bad fix can't re-latch).
- **A Firestore WriteBatch is capped at 500 ops** — any sweep over an unbounded (sub)collection MUST
  chunk or the commit throws. Use `chunk` / `deleteDocsInChunks` from `functions/src/batchUtil.ts`
  (`MAX_BATCH_OPS = 450`); never hand-roll a batch loop.
- **`allow delete` on an owner-scoped doc bypasses a soft-delete design.** Deleting a game touches
  five systems (game subtree · publicGames/publicTasks · accessCodes · Storage · audit) and only the
  server does all five; a client delete does one and leaves no tombstone for `purgeGameNow` to act
  on. `firestore.rules` is `allow delete: if false` on `users/{uid}/games/{gameId}` — the client path
  is the `deleteGame` callable.
- **Rules gate documents, not fields — and never run for the Admin SDK.** The projection contract on
  world-readable `publicTasks` is enforced on the WRITE path only (`publishGame`/the seed write
  `approxLocation` via `publicTaskLocation` — now the EXACT point of every located mission, hidden
  included; `searchTaskLibrary` strips server-secret keys; the backfill repairs legacy docs, including
  upgrading old coarse hidden pins to exact). Don't re-raise it as a rules finding — and note a hidden
  mission's exact spot IS deliberately world-visible in the gallery now (gallery-exact-hidden-location);
  the in-game puzzle is sealed by the participant sanitizer, not here.
- **The Builder's save payload IS its dirty check.** `buildSavePayload()` copies only
  `BUILDER_EDITABLE_FIELDS` (`apps/creator-web/src/lib/savePayload.ts`) and the Builder diffs
  `JSON.stringify` of that payload — so a field missing from the list never saves *and* never even
  registers as a change (the control looks alive because local state round-trips). Add a Builder
  control ⇒ add its field to that list; `scripts/test-game-presentation.ts` enforces it.
- **Exclusive groups cap how many tasks a stage can yield.** `Stage.requiredTaskCount` must never
  exceed `maxCompletableTasks(stage)` (`packages/shared/src/mutualExclusion.ts`) — a group
  contributes at most ONE completion — or the stage silently shrinks or can't be completed at all.
  Use `requiredTaskCountProblem()` (same file); it is what the server's save/import
  validation and the Builder's launch readiness both read.
- **A run-scoped operational override belongs on the RUN document, not the game template.** The
  template is replayed by later runs, copied by duplicate/export/publish, and rewritten wholesale by
  the Builder — so "this stop is closed today" written there is closed forever. Pattern:
  `Run.taskStatusOverrides` (`packages/shared/src/types/index.ts`, `Run`) written only by
  `setRunTaskStatus` (`functions/src/index.ts`).
- **Live/final leaderboard parity: anything affecting duration or score must be a pure function of
  the STORED team document** — never re-derived from the current template and never from `now`.
  `buildRankings` sums the server-stamped `RunTaskRecord.excludedMs` (via `teamExcludedMs`) instead
  of re-reading `task.pausesTimer` (`functions/src/runs/index.ts`, `buildRankings`), because a
  mid-run template edit would otherwise retroactively re-time finished work and make the live board
  jump.
- **Two duration fields, NOT interchangeable.** `Task.expectedDurationMinutes` = interaction time AT
  the stop, read only by `scoreFixedPointsSpeed` (`packages/shared/src/scoringPresets.ts`);
  defaults derived per type in `taskDuration.ts`. `Task.estimatedMinutes` is measured from
  ASSIGNMENT (`RunTaskRecord.startedAt` is stamped when the task is claimed, in
  `assignNextInActiveStage`'s claim transaction, `functions/src/runs/index.ts`), so it
  **includes travel**,
  and it feeds `taskScoreSmart` / `computeSkillRatio` (`computeSkillRatio` in
  `functions/src/routing/assignNextTask.ts`) and the UI.
- **Never run `verify` and `verify:emulator` concurrently on the same working tree:** both invoke
  `shared:build`, which rewrites `packages/shared/dist` **in place**. If one gauntlet's tsc is
  rewriting `dist` while the other's typecheck/esbuild reads it, functions fails with a spurious
  `No matching export … from './runs/index'` (a partial-`dist` read, not a real code error). Run the
  two gauntlets **sequentially**; in CI keep them in **separate jobs / checkouts** so they never
  share `dist`.
- **A gate build must never write the directory the live playtest serves.** The always-on playtest
  serves PRE-BUILT bundles through `vite preview`; `npm run verify` builds the same apps. When both
  wrote `apps/*/dist`, every `npm run verify` silently broke the live site in two ways, with **no
  error anywhere** (every process healthy, every request 200):
  **(a) base clobber** — creator-web's base is `/creator/` only under `--mode playtest`
  (`apps/creator-web/vite.config.ts`). `creator:build` writes base `/`, so the served HTML asks for
  `/assets/index-*.js`; the single-origin proxy routes only `/creator*` to creator-web, so that goes
  to **play-web**, which returns 200 with its own SPA HTML → the live creator console is a **blank
  page**. **(b) backend clobber** — `isEmulatorBuild` (`packages/shared/src/env.ts`) is
  `DEV || MODE === 'playtest'`, so ONLY the playtest bundle keeps the emulator wiring; `play:build`'s
  production bundle points participants' phones at real Firebase, where anonymous auth is disabled
  (`auth/admin-restricted-operation`) and nobody can join. Fixed structurally: `--mode playtest`
  builds to **`dist-playtest`**, the gate keeps **`dist`**, and both playtest previews pin
  `--outDir dist-playtest` (supported on the pinned Vite 5.4.21,
  `node_modules/vite/dist/node/cli.js:878`). So: **gate/deploy ⇒ `npm run creator:build` /
  `npm run play:build`; live playtest ⇒ `npm run playtest:build`** — never mix them. `npm run
  base:check` (in `verify`) + `scripts/test-build-artifact-guard.ts` (in `npm test`) make a
  regression loud. `bundle:budget` and `firebase.json` hosting still read `dist`, unchanged.
- **A `.env.local` is loaded by Vite in EVERY mode — including a production build — so a
  local-only override ships to real users.** `apps/creator-web/.env` sets
  `VITE_API_ORIGIN=https://api.rush-point.com` (the self-hosted VPS every callable goes to). A
  gitignored `apps/creator-web/.env.local` overrode it with an EMPTY value so a LOCAL dev server
  could not autosave into real creator data — correct, and genuinely wanted, because the Builder
  saves 1.5 s after any edit. But `npm run deploy:hosting` compiled that empty value into the real
  bundle, and creator.rush-point.com shipped with every callable pointing nowhere: the console
  showed *"טעינת המשחקים נכשלה"* and nothing else was wrong. **Every existing signal stayed
  green** — the build succeeded, `base:check` passed (the asset base WAS correct),
  `bundle:budget` passed, `firebase deploy` reported success, the served asset hash matched the
  local build byte for byte, and the site answered 200. All true, all measuring something else: a
  hash match proves you deployed the file you built, never that the file was built against the
  right backend. Fixed structurally — a dev-only override lives in **`.env.development.local`**
  (dev mode ONLY, so a production build cannot inherit it), and `npm run origin:check` (in
  `verify`) refuses a `.env.local` outright AND asserts each deployed bundle really contains its
  declared origin. When a deploy "succeeds" but the app loads with no data, check the bundle's
  CONTENT, not its hash: `grep -o api.rush-point.com apps/creator-web/dist/assets/*.js`.
- **A validator that FILTERS is a data-destroyer when the same call site also sees already-stored
  data.** `normalizeTaskMedia` (`packages/shared/src/validation.ts`) dropped any `image`/`video`
  entry whose URL failed the origin accept-set, and `normalizeStagesMedia`
  (`functions/src/games/index.ts`) then deleted the `media` field outright. Correct for input a
  client just invented — catastrophic for input the server accepted last week, and **the same call
  site sees both**, because the Builder autosaves the WHOLE `stages` array ~1.5 s after every edit.
  So a stored picture was re-judged on every keystroke-triggered save against
  `process.env.VPS_UPLOAD_ORIGIN`, `updates.stages` was written as a whole new array, and the
  callable returned **success**. A creator attached a photo to a mission, saw it, and later found it
  gone — no error, no log, nothing to notice. The accept-set is a property of the SAVING RUNTIME,
  not of the data: a URL minted in production is refused by a playtest/emulator save and vice versa,
  and one missing env var refused *everything*. Fixed structurally: the canonical upload origins are
  **compiled in** (`RUSHPOINT_UPLOAD_ORIGINS`, merely unioned with the env var by
  `storageOriginOpts()`), and validation now governs only what may be newly **introduced** —
  `normalizeStagesMedia(stages, storedStages)` grandfathers a URL already persisted on that task
  (logging the drift) and refuses a NEW bad one **loudly** with `invalid-argument`. Refusing
  everything unrecognised instead would brick autosave for every game already holding a drifted URL,
  which is the cleared-optional-field trap below. `scripts/test-task-media-durability.ts` +
  `scripts/test-upload-origin-parity.ts` pin it; `npm run diagnose:task-media` recovers the files
  (the object always survived — only the Firestore reference was eaten). **Adding any allow-list over
  a stored field ⇒ decide what happens to values that were already accepted, and never let the answer
  be "silently deleted".**
- **A game copied by spreading its document does NOT own its uploaded media.** Media objects are
  keyed on the owning game id (`gameMedia/{ownerUid}/games/{gameId}/…`,
  `functions/src/storagePaths.ts`), so `duplicateGame`/`translateGame` spreading the source `Game`
  left the copy addressing the SOURCE's folder. It rendered fine right up until the original was
  purged, at which point `purgeGameTree` → `deleteGameMedia` prefix-deleted that folder and every
  picture in the "duplicate" broke. `copyGameMedia` (`functions/src/storageUtil.ts`) copies the bytes
  and `rewriteStagesMedia` re-points the urls — copy first, rewrite second, write the doc last, so a
  failed copy degrades to "still points at the original" rather than "points at nothing". Same helper
  migrates media uploaded before the game had an id (`gameMedia/{uid}/games/draft/…`) on the first
  stages-carrying save. **Any new "this game becomes a new game" path must go through
  `rehostGameMedia`.**
- **An `async` handler that commits `{...task, ...patch}` reverts every edit made while it was
  awaiting.** `MediaSection.onPickFile` awaited a multi-second upload and then committed the `task`
  captured by the render that STARTED it, silently undoing concurrent edits and losing the first of
  two parallel uploads. A ref holding the latest task is the only thing current at await-resolution
  (`apps/creator-web/src/components/TaskWizard.tsx`). Applies to every await-then-commit handler.
- **The callable transport encodes `undefined` as `null`, so "clear this optional field" arrives as
  a malformed value.** The Builder's opt-in groups clear by patching their fields to `undefined`
  (the correct way to express "unset" in local state), but the Firebase callable serializer maps
  BOTH `undefined` and `null` to `null` on the wire. Server guards are written
  `value !== undefined && (typeof value !== 'number' || …)`, and `null` is not `undefined` — so
  closing the Builder's "time and scoring" group sent `expectedDurationMinutes: null` and
  `updateGame` refused EVERY autosave until a value was put back. The creator was rejected for
  clearing an optional field, with no way to comply. Fixed at the payload, not the server:
  `buildSavePayload` (`apps/creator-web/src/lib/savePayload.ts`) drops `undefined` keys inside
  `stages` so "unset" arrives ABSENT — which every optional guard already accepts — while a
  top-level explicit `null` is left alone (`safeZone: null` is a documented "clear this" signal, a
  different meaning that must not be conflated). `0`/`false`/`''` are kept: they are authored
  values. Pinned by `scripts/test-save-payload-undefined.ts`. **Adding an optional task field ⇒
  make sure clearing it sends ABSENT, not `null`.** (The same transport quirk is why NaN reaches
  the server as `null` in `scripts/e2e-verify.mjs` — there the refusal is correct.)
- **`npm run lint` is `turbo run lint` — a workspace with no `lint` SCRIPT is silently NOT linted,
  and turbo still reports "Tasks: N successful".** play-web had neither `.eslintrc.cjs` nor a `lint`
  script, so the app players actually hold was the ONE app never linted — while `verify` and CI both
  looked green. That is how a `useState` sitting BELOW the `if (!task) { … return … }` early returns
  in `TaskRunner` reached production: `task` is null while routing has not yet handed back the next
  mission, so any render that hit the waiting state ran one hook fewer than the render before it and
  React threw #300 *"Rendered fewer hooks than expected"*, crashing the whole tree to the
  ErrorBoundary. It fired on SOME transitions, not all — that intermittency is what made it look
  random rather than like a rendering bug. The callable had already succeeded server-side, so
  the player saw "Something went wrong" on an action that actually worked — and a reload resumed
  with the points banked, which is why it read as random. `react-hooks/rules-of-hooks` names this
  exact defect (`error React Hook "useState" is called conditionally`), so the fix is structural:
  **every React workspace declares a `lint` script and extends `plugin:react-hooks/recommended`**
  (`apps/play-web/.eslintrc.cjs`). Adding a new app ⇒ add its lint script in the same commit, and
  confirm turbo actually ran it by finding `@rushpoint/<app>:lint` in the output — a passing gate
  that never ran is indistinguishable from a passing gate that did.
- **Never pipe a gate through `tail`/`head` and trust the exit status — you get the PAGER's code,
  not the gate's.** `npm run verify:emulator | tail -80` reported exit 0 while the run had actually
  died partway: e2e printed "✅ ALL PASS", then the NEXT `emulators:exec` aborted with *"Could not
  start Firestore Emulator, port taken"* (stale JVMs from a killed dev stack), so the rules, storage
  rules, simulate and adversarial stages never ran at all. The truncated tail showed only the happy
  part. Redirect to a file and capture the code (`npm run verify:emulator > /tmp/vem.log 2>&1; echo
  $?`), then read the file. Related: a preview/dev stack stopped by anything other than Ctrl+C can
  leave emulator JVMs holding 8080/9099/5001 — run `node scripts/free-ports.mjs` before the next
  emulator-bound gate, or use the `RUSHPOINT_EMULATOR_PORT_OFFSET` lane.
- **Firestore's `WebChannelConnection RPC 'Listen' stream transport errored` is NOISE, not an
  outage.** It is the SDK's long-polling auto-detect handshake failing over, and it retries on
  backoff and connects. Confirm before chasing it: `localStorage['firestore_online_state_…']` reads
  `{"onlineState":"Online"}` and the chat/feed panels render their empty state instead of hanging.
  Do not "fix" it by forcing `experimentalForceLongPolling` in production.

## Environment files (all gitignored; emulator-safe defaults baked into client configs)
```
apps/creator-web/.env   # VITE_FIREBASE_* (+ VITE_MAPTILER_KEY)
apps/play-web/.env      # VITE_FIREBASE_* (+ VITE_MAPTILER_KEY)
functions/.env          # STRIPE_*, QR_SECRET (server-only)
```

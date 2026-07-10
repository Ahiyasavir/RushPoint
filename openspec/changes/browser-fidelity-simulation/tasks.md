## 1. GPS route helper (pure logic — RED → GREEN)

- [x] 1.1 Write failing `scripts/test-gps-route.ts` (auto-picked by `run-unit-tests.mjs`) encoding the GPS-path contract: `walkPath(from, to, t)` returns `from` at `t=0` and `to` at `t=1`, is monotonic in latitude/longitude along the segment, and `jitterFix(p, rng, accuracyM)` stays within the jitter bound of `p`; plus a `crossesRadius` assertion — a team walking from outside to a target enters the geofence radius on some tick, and a team parked outside never does. Run `npm test`, confirm it fails because `scripts/lib/gpsRoute.mjs` doesn't exist yet.
- [x] 1.2 Implement `scripts/lib/gpsRoute.mjs` (`walkPath`, `jitterFix`, a seeded LCG matching `simulate-run`, and a `routeFor(stops)` tick generator) — minimum code to make `test-gps-route` green. Run `npm test`, confirm green.

## 2. Shared run-audit extraction (REFACTOR — no behavior change)

- [x] 2.1 Extract the end-of-run audit from `scripts/simulate-run.mjs` (leaderboard oracle, live/final parity, score conservation, `run.taskCounts` all 0 / none negative) into `scripts/lib/run-audit.mjs` exporting a reusable `auditRun({ creator, teams, states, gameId, runId, accessCode })` with an injectable `audit(label, cond, detail)` sink.
- [x] 2.2 Rewire `simulate-run.mjs` to call the extracted `auditRun`; run `npm run simulate` (or `verify:emulator`) and confirm the audit still passes identically (no regression).

## 3. play-web DOM selectors (UI — render-only testids)

- [x] 3.1 Add `data-testid` + `data-task-type`/`data-task-id` hooks in `apps/play-web/src/components/TaskRunner.tsx` per design D5 (card root; field/self_report; CodeEntry; QuizEntry/OrderingEntry; NumericEntry; SequenceRunner; SurveyEntry; PhotoEntry; GeofenceAuto status).
- [x] 3.2 Add `join-submit` + `join-name` testids in `apps/play-web/src/screens/JoinScreen.tsx`, `offline-banner` in `ConnectionBanner.tsx`, and a `final-screen` marker in the Final screen.
- [x] 3.3 Run `npm run i18n:check` and `npm run i18n:check:strict` — confirm zero new findings (testids add no user-facing strings); run `npm run test:ui` render smoke — confirm existing specs still green.

## 4. Browser simulation driver

- [x] 4.1 Scaffold `scripts/simulate-browser-run.mjs`: parse `--teams=N` (default 3), launch headless Chromium, build the game via a creator callable party (extend `simulate-run`'s `buildStages` to seed at least one task of EVERY type — field, geofence, self_report, smart_station, photo, quiz, numeric, sequence — carrying the answer keys the driver needs), launch the run, and print `game/run/code`.
- [x] 4.2 Per team: create an isolated mobile `BrowserContext` (Pixel-7 profile, `permissions:['geolocation']`, initial geolocation), open play-web, join the run through the DOM (`join-name` + `join-submit`), and start a ~1 Hz GPS ticker driven by `routeFor(...)` that walks the team toward its current task's coordinates via `context.setGeolocation`.
- [x] 4.3 Implement the per-type play dispatcher: read `data-task-type`/`data-task-id` off `task-card`, then satisfy each type from its testid control using answers from the seeded config (field/self_report check-in; smart_station code; quiz choice/text or ordering; numeric; sequence steps; survey; photo via `setInputFiles` of a scratchpad PNG; geofence by walking into radius and asserting auto-check-in). Loop until `final-screen` or a turn/time budget is hit.
- [x] 4.4 Collect per-context `pageerror` events and a white-screen check; designate one team for an offline blip (`setOffline(true)` → assert `offline-banner` + no error → `setOffline(false)` → still reaches `final-screen`).

## 5. Integrity audit + wiring

- [x] 5.1 After all teams reach `final-screen`, read team states + boards via the ops party and call `auditRun` from `scripts/lib/run-audit.mjs`; add browser-only assertions (every task type was exercised at least once, zero uncaught page errors across contexts, zero white-screen crashes, every team reached `final-screen`). Exit non-zero on any violation with a per-context summary.
- [x] 5.2 Add `package.json` scripts: `simulate:browser` (`node scripts/simulate-browser-run.mjs`) and `verify:browser` (self-boots the emulator via `firebase-tools emulators:exec` and runs the browser sim, mirroring `verify:emulator`). Do NOT add either to the blocking `verify` gauntlet.

## 6. Full gate pass

- [x] 6.1 Run the full gate set green: `npm run typecheck` · `npm run lint` · `npm test` (incl. new `test-gps-route`) · `npm run creator:build` · `npm run play:build` · `npm run i18n:check` (+ `:strict`) · `npm run e2e`.
- [x] 6.2 Run `npm run simulate:browser` against a booted emulator (or `npm run verify:browser`) and confirm the full run + integrity audit come out green end-to-end.

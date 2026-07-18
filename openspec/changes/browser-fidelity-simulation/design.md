## Context

RushPoint's automated coverage is strong at the callable layer and thin at the browser layer:
- `scripts/e2e-verify.mjs` (`npm run e2e`) and `scripts/simulate-run.mjs` (`npm run simulate`) drive the **callable API directly** — they never render the React apps.
- `playwright.config.ts` + `e2e-ui/*.spec.ts` (`npm run test:ui`) render-smoke two screens (creator mount, one play-web join round-trip) but do not play a full run, emulate GPS motion, or exercise offline behavior.

The gap: geofence check-ins that pass a direct `completeTask` but fail against a real GPS drift stream; UI/state bugs (a control that never enables, the wrong task control rendered, a frozen/readOnly overlay); and connectivity regressions in the offline hardening. Today only field playtests catch these.

Relevant current behavior (from reading the code):
- `apps/play-web/src/components/TaskRunner.tsx` renders **per-type controls** off `task.type` (lines ~278–304): `field`/`self_report` → a single check-in `Button`; `smart_station` → `CodeEntry`; `quiz` → `QuizEntry`/`OrderingEntry`; `numeric` → `NumericEntry`; `geofence` → `GeofenceAuto` (auto check-in via `navigator.geolocation.watchPosition`); `sequence` → `SequenceRunner`; `survey` → `SurveyEntry`; photo/audio → `PhotoEntry`/`AudioEntry`.
- GPS is consumed via `navigator.geolocation.watchPosition` in `TaskRunner` (`DistanceBadge`, `GeofenceAuto`) and `PlayScreen` — all overridable by Playwright `context.setGeolocation`.
- `apps/play-web/src/components/ConnectionBanner.tsx` shows an offline banner on the `window` `offline` event.
- Answer keys (`smart.secretCode`, quiz `answers`, `numericAnswer`, `steps[].answer`) are **server-secret** and stripped from the client payload — so the driver must learn them from the **seeded template config**, never scrape them from the client.
- `simulate-run.mjs` already establishes the reusable pattern: a creator party builds a game via callables, launches a run, and an end-of-run audit checks leaderboard oracle + score conservation + `run.taskCounts` all back to 0.

## Goals / Non-Goals

**Goals:**
- A computer-runnable `npm run simulate:browser` that plays N concurrent teams through the **real play-web UI** with streamed simulated GPS, mobile emulation, and injected offline conditions, then runs the `simulate-run` integrity audit plus browser-only assertions (no page errors, no white-screen crash).
- Deterministic and reproducible (seeded RNG for jitter, same as `simulate-run`).
- Reuse existing infrastructure: the emulator suite, the `simulate-run` game-template + audit code, Playwright (already a devDependency), and `playwright.config.ts` device presets.

**Non-Goals:**
- Not a replacement for real field playtests — it cannot reproduce true GPS multipath/signal loss, sun-glare UX, or device-specific Safari/old-Android quirks (`playtest:ngrok` remains for that).
- No backend/callable/rules changes, no new server state, no new Firestore index or env var.
- Not added to the blocking `npm run verify` gauntlet (needs Chromium + emulator) — opt-in only.
- Not a full service-worker app-shell verification (Vite dev may not register the SW); offline coverage asserts banner + no-crash + reconnect-convergence.

## Decisions

### D1 — One `BrowserContext` per team (not one context, many pages)
Each virtual team gets its own `browser.newContext({ ...devices['Pixel 7'], geolocation, permissions:['geolocation'] })`. Rationale: geolocation override, storage/auth (anonymous uid == teamId), and `setOffline` are **per-context** in Playwright — one context per team gives each an independent uid, independent GPS stream, and independent offline toggle. Alternative (one context, many tabs) rejected: geolocation and offline would be shared across teams.

### D2 — Creator/ops setup via callables; participant play via UI only
The driver's **creator** party builds the game + launches the run via callables (reusing/extending `simulate-run`'s `buildStages`), exactly as `simulate-run` does — the spec's "no direct callables" rule is about **participant actions**. Every participant action (join, task completion) goes through the rendered DOM. The end-of-run audit may still **read** state (`getMyTeamState`, `refreshLeaderboard`, `finalizeRun`, the run doc) via the creator/ops party — reads are not participant mutations.

### D3 — GPS as a ticking stream via `context.setGeolocation`
A Node-side ticker (~1 Hz) advances each team's position along an interpolated path between task stops and calls `context.setGeolocation({ latitude, longitude, accuracy })` with per-fix jitter/drift from the seeded RNG. Because `watchPosition` re-reads the override on each poll, the UI sees motion. A small pure helper `walkPath(from, to, t)` + `jitterFix(p, seedFn)` (a **shared, unit-tested** module — see Test Strategy) computes each fix. Alternative (single `setGeolocation` teleport per stop) rejected: it wouldn't exercise the `watchPosition` distance-badge/geofence-approach path, which is the whole point.

### D4 — Answers come from the seeded config, not the client
The driver's per-type play functions receive the correct answer/code from the **template it seeded** (quiz choice, numeric value, station `secretCode`, sequence step answers, ordering). This respects answer-key secrecy (the client never exposes them) and mirrors how `simulate-run` already knows `'jerusalem'`/`7`.

### D5 — Stable `data-testid` hooks (the only product-code change)
Add render-only `data-testid` (+ `data-task-type`/`data-task-id` on the card root) so the driver dispatches per type without depending on Hebrew copy. Files/attrs in `apps/play-web/src/components/TaskRunner.tsx`:
- card root → `data-testid="task-card" data-task-type={task.type} data-task-id={task.id}`
- field/self_report `Button` → `data-testid="task-field-checkin"`
- `CodeEntry` input/button → `task-code-input` / `task-code-submit`
- `QuizEntry` choices/input/submit → `quiz-choice` / `quiz-text-input` / `quiz-text-submit`
- `OrderingEntry` submit → `ordering-submit`
- `NumericEntry` input/submit → `numeric-input` / `numeric-submit`
- `SequenceRunner` input/submit → `sequence-input` / `sequence-submit`
- `SurveyEntry` choices/text/submit → `survey-choice` / `survey-text` / `survey-submit`
- `PhotoEntry` file input/submit → `photo-file` / `photo-submit`
- `GeofenceAuto` status root → `geofence-status` (read-only; asserts approach/arrival)
Plus `apps/play-web/src/screens/JoinScreen.tsx` join CTA → `join-submit`, name field → `join-name`; `ConnectionBanner.tsx` root → `offline-banner`; and a Final-screen marker → `final-screen`. These are non-behavioral and add **zero** user-facing strings, so `npm run i18n:check` stays clean (verified as a gate).

### D6 — Photo upload via `setInputFiles`
`PhotoEntry` has a real `<input type="file">`; the driver uses `setInputFiles` with a tiny generated PNG written to the scratchpad. No URL-paste path needed.

### D7 — Offline injection via `context.setOffline`
For at least one designated team, `context.setOffline(true)` mid-run, assert `offline-banner` visible + no page error, then `setOffline(false)` and assert the team still reaches `final-screen`. CDP throttling (`Network.emulateNetworkConditions`) is an optional degraded-but-online variant; the offline toggle is the primary assertion.

### D8 — Convergence + audit
"Finished" is detected from the UI (`final-screen` testid) with a turn/time budget; the integrity audit reuses `simulate-run`'s oracle/score-conservation/`taskCounts==0` checks (extract the shared audit into `scripts/lib/run-audit.mjs` so both scripts call it — no logic duplication). Browser-only additions: each context accumulates `pageerror` events and a white-screen check (`document.body` has meaningful content); any non-empty error list or blank screen fails the run.

## Test Strategy (TDD — RED first)

Per the project's lanes, ordered RED→GREEN:
1. **Pure logic (RED first):** new `scripts/test-gps-route.ts` (auto-picked by `run-unit-tests.mjs`) for the GPS path helper — asserts: `walkPath` endpoints are exact (`t=0`→from, `t=1`→to) and monotonic; interpolated fixes stay on the segment within the jitter bound; a team walking toward a geofence **crosses** the radius threshold (so auto-check-in can fire) and a team parked outside **never** enters. Write it failing, then implement `scripts/lib/gpsRoute.mjs` to green. This is the first task.
2. **The simulation is its own harness:** `npm run simulate:browser` (small default fleet) must complete with the audit green — it IS the behavioral test for the driver + testids. Run under a self-booted emulator via a new `verify:browser` convenience script (mirrors `verify:emulator`).
3. **UI edits proof:** `npm run i18n:check` must stay clean (render-only testids, no new strings); the existing `npm run test:ui` render smoke must stay green (testids don't break current locators).
4. **No callable changes** → no `e2e-verify.mjs` additions; the callable-coverage guard is unaffected.

Gates to run before done: `npm run typecheck` · `npm run lint` · `npm test` (incl. the new `test-gps-route`) · `npm run creator:build` · `npm run play:build` · `npm run i18n:check` · then `npm run simulate:browser` against a booted emulator.

## Risks / Trade-offs

- [`watchPosition` doesn't re-fire on override change] → tick `setGeolocation` at ~1 Hz with small deltas; `GeofenceAuto` uses `maximumAge: 5000`, so a fresh fanned position is read within the poll window.
- [Concurrency flakiness (dev servers + emulator + N Chromium contexts)] → small default fleet (3–4), bounded parallelism, generous per-step timeouts, seeded RNG so failures reproduce; keep it opt-in, not in the blocking gate.
- [Service worker not registered in Vite dev] → scope offline assertions to banner + no-crash + reconnect-convergence; document that full app-shell SW verification needs a preview/prod build (out of scope).
- [`smart_station`/quiz/numeric answers are server-secret] → driver reads them from the seeded template config (D4), never from the client payload — preserves answer-key secrecy.
- [Testids drift from copy] → driver targets `data-testid`/`data-task-type` only, never visible Hebrew/English text, so copy/i18n changes don't break it.
- [Map (MapLibre) lazy chunk cost per context] → task completion never depends on a map tap (buttons/forms + streamed GPS drive everything); the map renders but isn't on the critical path.

## Open Questions

- Default `--teams` for `simulate:browser` (proposed: 3, since each is a full Chromium context; `--teams=N` overrides).
- Whether to fold `simulate:browser` into `verify:emulator` later once proven stable, or keep it strictly standalone (proposed: standalone `verify:browser` for now).

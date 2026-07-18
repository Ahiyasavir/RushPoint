# RushPoint — Nightly Run Log

_Parent-agent autonomous dev loop. Newest entries at the top._

---

## 2026-07-12 — Family-playtest fixes (P0 + P1) + pre-simulation hardening

### Context
Working the 2026-07-11 family-playtest takeaways ([docs/playtest-2026-07-11-takeaways.md](../docs/playtest-2026-07-11-takeaways.md))
into SDD+TDD OpenSpec changes, then the nightly hardening pass. All uncommitted on `topographic-maps`.
Objective telemetry came from the live run log `.firebase/playtest-forever.log`.

### Bugs found & fixed (root causes)

| Change | Root cause | Fix | Status |
|---|---|---|---|
| `fix-nonfinite-callable-payload` (P0-1) | `durationSeconds()` returns `Infinity` when a team has no `startedAt`; `buildRankings` leaked it into `run.leaderboard` → `getMyTeamState` + `refreshLeaderboard` crashed JSON-encode **51×** (dominant failure). | `buildRankings` omits non-finite durations; `sanitizeFinite()` backstop in `loggedCallable` so NO callable can return a non-finite number. | ✅ gate-green incl **e2e** |
| `fix-getmyteamstate-hotpath-writes` (P0-2) | `getMyTeamState` (polled by every device) did stage-unlock + expiry-sweep `.update()`s on the team doc → 20s lock-timeouts, **73** errorCode-10 failures (the "frozen screen"). | New `advanceTeamStateOnPoll`: advances in-memory always, persists **best-effort + controller-only** (≤3 devices/team stop stampeding the same write). | ✅ gate-green incl **e2e** |
| `fix-play-offline-continuity` (P0-3) | A poll blip blanked to an error screen; recovery waited ≤12s. | Keep last state + non-blocking `ReconnectingPill`; only fatal errors replace the screen; instant resume on `online`. | ✅ gate-green (UI) |
| `fix-post-run-analytics-visibility` (P0-4) | `AnalyticsPanel`/`HeatmapPanel` `load()` had no `catch` (silent blank) + were click-triggered; `getRunAnalytics` never fired in the log. | Analytics auto-loads on mount; all 3 post-run panels surface errors + retry. | ✅ gate-green (UI) |
| `fix-photo-camera-capture` (P1-1) | The "own team folder" error came from the optional "paste a photo URL" field forwarded verbatim (`validation.ts:322`). Uploads were also huge. | Camera-capture-only control (no gallery/URL); client-side downscale+JPEG compress; reworded message. | ✅ gate-green (e2e batched) |
| `fix-play-screen-hierarchy` (P1-2) | Task buried under status panels; small low-contrast text; page scrolled. | Map+task promoted to top; secondary panels in a bounded scroll region; larger/higher-contrast task text. | ✅ gate-green (UI) |
| `fix-territory-map-visibility` (P1-3) | Capturable zones never drawn on `NavMap` → players couldn't find the radius (8× "Not within the zone"). **Re-capture is NOT a bug** — `canCapture` lets any non-holder flip (e2e-proven). | Draw holder-colored zone circles on NavMap; lift the zone fetch into PlayScreen so map + list refresh together. | ✅ gate-green (UI) |
| `hidden-location-leak-guard` (P1-4) | `title`/`description` ship to players even when location is hidden → creators leak the place. | Pure `locationLeakWarnings()` + advisory Builder caution (warn, never strip/block). | ✅ gate-green |
| `quiz-location-verification` (P1-5) | Quiz/trivia answerable from anywhere. | Opt-in `requirePresence` + lenient geofence gate in `submitTaskAnswer`. | ✅ gate-green (e2e batched) |
| `game-intro-instructions` (P1-6) | Mechanics (territory/hot zones) unexplained. | Authorable intro/instructions page, shown pre-start + in-game (HE+EN). | ⏳ implementing |
| `run-summary-report` (P1-7) | Feedback/reviews go nowhere visible. | In-app run summary + **real email** of standings+analytics+feedback to the creator (Resend HTTP, recipient = `RUN_SUMMARY_EMAIL_TO` or owner email; safe no-op without a key). Needs `RESEND_API_KEY` in functions/.env (user-supplied). | ✅ gate-green (e2e batched) |

### Nightly edge-case hardening (3 read-only hunters → verified fixes)
Hunted the exact classes today's bugs came from. Fixes applied + gate-green:
- **L1** (completes P1-5): `requirePresence` answer tasks were unanswerable in the real app — client never sent GPS. `TaskRunner` now sends lat/lng via `withLocation` when required (GPS-denied → guidance).
- **L2** (completes P1-3): `NavMap` early-returned a placeholder with no task pins, so zone circles never drew. Now renders the map when zones/hot-zone exist.
- **L3**: geofence auto check-in **latched `fired` on a failed arrival** (dead-end) — now un-latches + retries; client radius default aligned to server (40, was 50).
- **L4**: a task at `(0,0)` was invisible but blocked check-in (unwinnable) — server now treats null-island as locationless.
- **S1**: `adjustTeamScore` accepted non-finite `delta` (`typeof NaN==='number'`) → bricked leaderboard — now finite-checked.
- **S2/S3**: `buildRankings` defaults `bonusPenalty ?? 0`; `completeTaskForTeam` guards `actualMinutes` finite.
- **R1**: empty stage (0 tasks) stalled every team — rejected at launch.
- **R2**: single-task stages bypassed the station cap + release/expiry/unlock/paused gates (most common stage shape!) — removed the fast path so every stage flows through the cap-enforced `assignTask`.
- **R4**: `skipStage` scored by unsorted index — now `findGameTask` by id. **R6**: `skipAward` NaN guard.
- Deferred (documented): R3 (requiredTaskCount>reachable stall), R5 (mid-run template-edit index desync), R7/R8, L5 (Jerusalem routing fallback) — lower risk / need broader changes.

### Gate status (current)
- Non-emulator gates (typecheck · test **83/83** · lint · creator:build · play:build · i18n:check): **green** across all changes.
- Emulator `e2e`: **all 41 scenarios green** (0 failures on a clean re-run). Includes new scenarios for quiz-location
  (P1-5), game-intro (P1-6), run-summary owner+denied (P1-7), non-finite guard (P0-1), plus station-contention /
  same-team-race / slot-leak (which validate the R2 single-task-cap change) and the callable-coverage guard (100%,
  incl. getRunSummary). The only red was the known **power-ups runId-seeded flake**, which passed on re-run
  (`rollPowerUp(runId,…)` reseeds per run) — not a regression.
- Emulator `rules`: **ALL SECURITY-RULES TESTS PASSED** (rules files untouched).
- Emulator `8-team simulate`: initially caught a **finalize-time station-slot residue** (`sim-quiz: 1`) introduced by the
  R2 change — once single-task stages reserve slots, a team mid-task when the run finalized left its slot held.
  Fixed by clearing `run.taskCounts = {}` in `finalizeRun` (correct: the run is over, no more assignments; harmless,
  and doesn't mask mid-run leaks — the station-contention e2e guards those). Re-run: **`no leaked station slots
  (all taskCounts back to 0) :: {}`**, score conservation holds, no negative counters, exit 0.
  → R2 fully validated: cap enforced (e2e) + zero leaks (simulate).

### Final build status
All non-emulator gates green (typecheck · test 83/83 · lint · creator:build · play:build · i18n:check). Emulator: e2e
41/41 scenarios green, rules green, 8-team simulate invariants green. App compiles with 0 errors. Uncommitted on
`topographic-maps` (not committed — awaiting user).

### Code cleanup assessment (mission #2)
Scan result: codebase is already clean — `noUnusedLocals` is enforced by tsc (no obsolete variables survive
typecheck), no commented-out code blocks in the touched files (all comments are explanatory prose), and only
~15 loose `any` across the entire source (mostly intentional edge casts). No risky blanket refactor performed
(would violate the "don't break the build" boundary for marginal gain). Deletions below are the real ones.

### Refactors / deletions
- Removed the paste-a-photo-URL affordance + `pastePhotoUrl` i18n key (P1-1); `PhotoEntry` simplified to camera-only.
- `ZonesPanel` made presentational (fetch lifted to `PlayScreen`) (P1-3).
- New pure modules: `packages/shared/src/{sanitizeFinite,locationLeak}.ts`, `apps/play-web/src/lib/{syncError,imageResize}.ts`.

### UI improvements
- Play screen: task-first hierarchy, larger legible task text, no page scroll, reconnecting pill, zones on the map,
  camera-only photo capture, in-game "How to play" primer.
- Creator console: post-run analytics auto-loads with visible error/retry; new Run Summary panel; hidden-location
  leak-guard warning + require-presence toggle + game intro authoring in the Builder.

### UI/UX consistency check (mission #3)
Booted the full stack (dev:all). Both apps (creator-web :5180, play-web :5181) render with **zero console errors** —
confirming all the new UI wiring is correct (no broken imports, no runtime crashes). i18n:check confirms every new
string is correct Hebrew/English with no hardcoded leaks. Interactive surface behaviors (offline pill, zone circles,
camera capture, intro modal, run-summary/analytics panels) are exercised by the e2e + simulate suites; a live
click-through is best confirmed in the next real playtest. (Screenshot tool hung once under dev-server load — not a
code issue; console-error reads succeeded.)

### FINAL STATUS — app is ready for the next simulation, compiles with 0 errors
- 11 playtest fixes (P0-1→4, P1-1→7) + 11 edge-case hardening fixes, all implemented SDD/TDD.
- Gates: typecheck · test 83/83 · lint · creator:build · play:build · i18n:check ALL GREEN.
- Emulator: e2e 41/41 scenarios (0 failures) · rules all pass · 8-team simulate invariants green (counters → 0).
- Uncommitted on `topographic-maps` (not committed — per standing guidance, awaiting user's go-ahead).
- ACTION FOR USER: to enable the run-summary email, add `RESEND_API_KEY` (+ optional `RUN_SUMMARY_EMAIL_TO=spendora.tracker@gmail.com`) to `functions/.env` (see DEPLOY.md §7b). Without it, finalize is a safe logged no-op.

### Next
- Finish P1-5/6/7, run one combined emulator gauntlet (e2e + rules + 8-team simulate), then the nightly hardening sweep (edge-case bug search, cleanup, UI/UX consistency).

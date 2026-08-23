# Night-sim #02 — Browser-fidelity real-UI run (2026-07-16, overnight)

Agent #02. Drove the REAL play-web UI in headless Chromium (Playwright, Pixel-7 profile,
`locale: he-IL`, synthetic GPS shim adapted from `scripts/simulate-browser-run.mjs`) against the
ALREADY-RUNNING 24/7 stack (emulator suite + prod-built apps behind the :3000 proxy). No source
edits, no server restarts, no process kills. All throwaway harness code lived in the session
scratchpad (`night-sim-02.mjs`, `probe-starved.mjs`, `probe-hidden.mjs`).

## What ran

| Scenario | Result |
|---|---|
| **A** — Join `PLAY01` via the real Join screen with Hebrew team/member names, play the demo to Final: quiz (🏁 choice), numeric (42), sequence (confirm→typed "קדימה"→confirm), photo (real generated JPG through `photo-file` + submit) | ✅ Final screen reached; **0 console errors, 0 page errors** |
| **A (resilience)** — mid-game `context.setOffline(true)` for 30 s while interacting, then reconnect; then a full page reload mid-race | ✅ offline banner ≤ 20 s, offline submit politely blocked, banner cleared on reconnect, **reload restored the session to the same task in 0.8 s** |
| **B** — Join a fresh run of the Sansana game (launchRun→`Y9SJJU`), walk a fake GPS track between all 5 stations (home→synagogue→Ben-Dor→HaLev→home), all 10 tasks incl. radius-gated field check-ins, 3 photos, 2 quizzes, vault numeric 4763 | ✅ Final screen; **0 console errors**; server accepted check-ins only after the simulated walk arrived |
| **B (leak sniff)** — captured every backend response body (functions + Firestore channel) until just before the vault submit and grepped for answer keys | ✅ **131 bodies, zero leaks** (no `answers`, `numericAnswer`, `secretCode`, `steps[].answer`, hint text, no "4763") |
| **Hidden-location probe** — built a 2-stage game with a `hideLocation` field task at distinctive secret coords, played it through the UI | ✅ clue UI shown (no pin, no distance badge), **0/32 pre-arrival bodies contained the coords**, arrival check-in → Final |
| **C** — public pages in a fresh context: `?board=PLAY01`, `?game=demo-game-oldcity` | ✅ both render (unpublished-board message + share CTA; full promo teaser), 0 console errors |
| **Starved-station probe** — joined the seeded `SANSANA` run whose first station's 5 slots are all held by abandoned teams from earlier sims | ⚠ captured the dead-end UX (defect 3) |
| NavMap | ✅ MapLibre canvas renders on located tasks (an earlier in-run "no canvas" reading was my harness checking during a locationless task — false alarm, re-verified in a dedicated probe) |

Caveat: scenarios A/B/C only worked after a **network-layer workaround in the harness** (prod
Firebase hosts rewritten to the local emulators, and the storage bucket rewritten in the
`submitStationPhoto` payload) — because of defects 1 and 2 below. That workaround is exactly what
made those two defects visible and provable.

## Defects found

### 1. P0 — The always-on playtest host serves builds that talk to PRODUCTION Firebase (joining is impossible)
- `vite build --mode playtest` compiles out ALL emulator wiring: it's gated on `import.meta.env.DEV`
  (`apps/play-web/src/services/firebase.ts:72`, `apps/creator-web/src/services/firebase.ts:74`), and
  mode `playtest` ≠ `development`, so `DEV=false`. There is no `.env.playtest` and no `define` that
  compensates.
- Evidence: the served `assets/index-DDynIRRN.js` (:5181) contains **no** `connectAuthEmulator`, no
  `9099` — same for the creator bundle; a real browser on the page issues
  `POST https://identitytoolkit.googleapis.com/v1/accounts:signUp` → **400
  `auth/admin-restricted-operation`** (anonymous auth disabled in prod), so no participant can join
  through this stack (tunnel or LAN). Public leaderboard renders "טבלת הדירוג אינה זמינה
  Error (auth/admin-restricted-operation)".
- Note: `npm run playtest` / `playtest:ngrok` use the **dev server** (`npm run dev`), where `DEV=true`
  — that's why family playtests worked. Only the `vite preview`/`playtest:build` path (the
  playtest-forever always-on host, `playtest:play:preview`) is broken.
- Suggested fix: key emulator wiring on an explicit flag (e.g. `VITE_USE_EMULATORS` via
  `.env.playtest` or a `define` in the playtest mode) instead of `DEV`; and/or make
  `playtest-forever` fail loudly if the built bundle lacks emulator wiring.

### 2. P0 — Storage-bucket mismatch rejects every real photo/audio upload ("לא הצלחנו לשמור את התמונה" forever)
- Clients are configured with the new-style default bucket
  `VITE_FIREBASE_STORAGE_BUCKET=rushpoint-pwa-7daaa.firebasestorage.app` (`apps/*/.env`), so
  `getDownloadURL()` yields `…/v0/b/rushpoint-pwa-7daaa.firebasestorage.app/o/…`.
- `FIREBASE_STORAGE_ORIGIN` (`packages/shared/src/validation.ts:194-195`) pins
  `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/`, so
  `requireStorageUrl` rejects the URL → `submitStationPhoto` fails → the player sees the retake
  message on every attempt, with no way out. Same pinned origin silently **drops creator task media**
  (`isTaskMediaValid`/`normalizeTaskMedia`, validation.ts:252/279) and blocks audio submissions.
- Evidence: in run 3 both players stalled at their photo task with exactly the
  `requireStorageUrl` bilingual error rendered in the card; after the harness rewrote the bucket
  name inside the `submitStationPhoto` payload only, the identical flow passed instantly (2.9 s /
  3.8 s incl. compression+upload). Existing tests never caught it because `e2e-verify`/the old
  browser sim submit hand-crafted `appspot.com` URLs instead of using a client-built one.
- Suggested fix: accept both bucket spellings (or derive the origin from config), and add one test
  that validates a URL shaped like what the real client SDK returns.

### 3. P1 — Station-slot starvation is a dead end for players (and abandoned teams hold slots forever)
- The seeded `SANSANA` run's first task (`home-selfie`, `maxConcurrentTeams: 5`) has all 5 slots
  held by teams abandoned hours ago by earlier sims (`activeTaskId: home-selfie`, no activity). A
  new team that joins and is started sees: routing spinner → **"לא הצלחנו לאחזר את המשימה הבאה. נסו
  שוב"** — and retry can never succeed. Verified live in the starved-run probe (body text sampled
  at t+5 s/t+30 s/t+60 s).
- `requestNextTask` returns `{ taskId: null }` with no reason (`functions/src/runs/index.ts:2497-2498`),
  so the client cannot distinguish "station full — wait a moment" from a real failure.
- Suggested fixes: (a) return a reason (`stationsFull`) and show waiting copy + auto-retry with
  backoff instead of an error; (b) reclaim slots from teams inactive for N minutes (the sweep could
  ride the existing task-expiry/`advanceTeamStateOnPoll` machinery). Also worth an eye:
  `TaskRunner`'s routing `useEffect` depends on `assignedRec` (a fresh object identity every poll),
  so while unassigned it re-fires `requestNextTask` on every poll cycle — with many waiting teams
  that's a thundering herd on the single run-doc lock.

### 4. P2 — `scripts/simulate-browser-run.mjs` is stale vs the camera-capture-only photo UI
- Line 295 fills `data-testid="photo-url"`, which no longer exists — `PhotoEntry` is
  camera-capture-only (`photo-file`/`photo-take`/`photo-submit`, TaskRunner.tsx:814-821) since
  fix-photo-camera-capture. The official browser-fidelity sim therefore can't complete photo tasks
  any more. Port it to `setInputFiles` on `photo-file` (works headless with a generated JPG; this
  harness did exactly that) — but note it will then hit defect 2.

### 5. P2 — Public leaderboard error state leaks a raw error code to players
- When the backend is unreachable/misconfigured the board page renders
  "טבלת הדירוג אינה זמינה **Error (auth/admin-restricted-operation)**" — a raw Firebase error code
  string in the player-facing UI (observed on `?board=PLAY01`, run 1). Map it to friendly localized
  copy; keep the code in console/logs only.

No crashes, no white screens, no uncaught page errors, and no sanitizer leaks were found in any
passing flow — the core participant runtime held up very well once traffic actually reached the
emulators.

## Software improvement suggestions

1. **Guard the playtest deployment**: a startup self-check in `playtest-forever` (or the proxy)
   that fetches the served bundle and asserts emulator wiring is present would have caught defect 1
   the moment the always-on host switched to `vite preview`.
2. **Bucket-agnostic storage validation** (defect 2) + a unit test using a real
   `getDownloadURL`-shaped URL for both bucket spellings.
3. **Routing "why" channel**: `requestNextTask` should say *why* nothing was assigned
   (stations full / all locked / out of bounds already has one) so the UI can wait vs. error
   (defect 3).
4. **Slot reclamation** for inactive teams so one abandoned phone can't starve a station for the
   rest of an event.
5. Update the stock browser sim for camera-capture (defect 4) — it's the only lane that would have
   caught defect 2 end-to-end.
6. Consider shipping a MapTiler key to playtest builds: the served build falls back to keyless
   OpenTopoMap (attribution confirms), and tile fetches showed `ERR_ABORTED` bursts in testing —
   the canvas renders, but tile reliability is at a third party's mercy.

## Perf notes (shared-load context)

Other night-sim agents were hammering the same emulator suite throughout; treat these as
"emulator under multi-agent load on one Windows box", not production numbers.

- Page load → Join form interactive (prod build via :3000 proxy): **1.9 s** quiet, up to **6.5 s**
  while two scenarios + sibling agents ran concurrently.
- Join submit → lobby: **0.19–0.33 s**. `launchRun` 42 ms, `startTeams` 135–976 ms (script-side).
- Task completions through the full UI round-trip (tap → server → state refresh → next card):
  quiz/numeric **0.55–1.3 s**, sequence (3 steps) **1.6–2.1 s**, photo incl. in-browser compression
  + Storage upload + callable **0.6–3.8 s**, field check-ins **2.7–6.2 s** (includes simulated
  walking time, not pure latency).
- Mid-race reload → task card restored: **0.76–0.78 s** (excellent; Firestore persistent cache +
  session restore doing their job).
- Offline banner: appears within its 20 s window, clears within 25 s of reconnect.
- The `?board=` / `?game=` numbers in my logs (~6.2 s) include a fixed 6 s settle sleep — not a
  meaningful measurement; both pages were interactive well before it.

## Environment notes for the next agent

- The seeded `SANSANA` run's first station stays starved (5 abandoned holders) — launch a fresh run
  (`launchRun` as `sansana-creator` via an emulator custom token) rather than fighting it. I left
  runs `iHWKMPi0M2a5WFPjw4QC` (code `Y9SJJU`, completed) and the hidden-probe game
  `FDMgBI9SoyT8WmFdAMMW` behind; `maxParticipants` on the two seeded runs was raised 5→20 via the
  emulator REST bypass so joins wouldn't bounce off the cap other agents had filled.
- To browser-test against this stack you MUST rewrite the prod Firebase hosts to the emulators at
  the Playwright network layer (see `night-sim-02.mjs` in this session's scratchpad) until defect 1
  is fixed — and rewrite the bucket in `submitStationPhoto` payloads until defect 2 is fixed.

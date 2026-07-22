# Wave-G — play-web robustness hunt

Scope: the recently-changed player-facing surfaces (`playRoute` resolver + App boot,
`store.ts`, `sw.js` v3 + lazy chunk retry, arrival latch offline story, `getMyTeamState`
consumers, the `useAsyncAction` double-tap guard). READ-ONLY audit, no source edited.

A live player already hit two dead-ends here (false-locked + GPS-fatal routing, both fixed).
The two headline routing/latch surfaces are now solid; the remaining findings are mostly
about the *edges around* them — chunk loading across deploys, the double-tap guard not being
applied uniformly, and overlay routes stranding an already-joined player.

---

## Confirmed bugs (top = highest severity)

| # | file:line | Scenario | Player experience | Sev | One-line fix |
|---|-----------|----------|-------------------|-----|--------------|
| 1 | `apps/play-web/src/App.tsx` 172-235 (`board`/`recap`/`challenge`/`promo` `!dismissed` blocks) + final ternary 240-246 | A player **with an active session** opens a shared `?board=`/`?recap=`/`?challenge=`/`?game=` link (e.g. someone drops the live leaderboard in team chat), then taps the "I have a code / join" button (`onJoin={() => setDismissed(true)}`). | The overlay is dismissed, but the bottom render only resumes `PlayScreen` when `route.kind === 'play'`. Here `route.kind` is still `board`/etc., so the player lands on a **blank JoinScreen** instead of back in their game. Session is intact in localStorage (reloading the base URL resumes), so progress is not lost — but it looks like they were kicked out. | Medium | When `dismissed` and a `session` exists, fall through to `PlayScreen` (check `session` before `route.kind`), or have `onJoin` clear the offending URL param. |
| 2 | `apps/play-web/src/App.tsx` 13-18, 48; `PlayScreen.tsx` 19-23 | Every lazy screen **except `StaffConsole`** uses plain `React.lazy` (no `lazyWithRetry`): `NavMap`, `GamePromoScreen`, `PublicLeaderboardScreen`, `CeremonyScreen`, `ChallengeTeaser`, `TvLeaderboard`, `RunRecap`, `FeedPanel`, `ChatPanel`, `QrScanner`. After a redeploy, a device on the cached v3 shell references old hashed chunk names that no longer exist on the server. | The dynamic import rejects → `Suspense` hangs on the spinner **forever** — the exact stale-shell trap `lazyWithRetry` was written to fix, but only `StaffConsole` is protected. `NavMap` is opened by **every active player**, so this is the most-exposed chunk. | Medium | Wrap the player-critical lazies (at minimum `NavMap`) in `lazyWithRetry` too, keyed per chunk. |
| 3 | `apps/play-web/src/components/TaskRunner.tsx` 64 (`busy` useState), handlers 255-432, buttons 464/514/658/686/769/969 | The task action handlers (`field`, `checkArrival`, `verify`, `photo`, `audio`, `answer`, `submitOrdered`, `sequenceStep`, `geofenceArrive`) gate only on a local `busy` `useState` — **not** `useAsyncAction`. The hook's own header (`useAsyncAction.ts` 3-16) states this pattern is defeatable: two taps in one React batch (mobile ghost-tap / jittery tap) both read `busy===false` before the disable re-render commits, and both fire. | A double-tapped check-in / photo submit / verify / arrival fires the callable twice. `completeTask` and `reportArrival` are idempotent server-side (duplicate-completion no-op gate; arrival latch), so no corruption there — but **`submitStationPhoto` double-fire** (two uploads → two review submissions, possible double auto-approve/award) is not obviously idempotent. The Join screen IS correctly guarded, making this an inconsistency. | Medium | Route the TaskRunner handlers through `useAsyncAction` (per-task key) like Join/SOS/zones/trackables already do; prioritise `photo`/`audio`. |

---

## Lower severity / needs a runtime check

| # | file:line | Scenario | Player experience | Sev | Note |
|---|-----------|----------|-------------------|-----|------|
| 4 | `apps/play-web/src/App.tsx` 34-44 (`lazyWithRetry`) | The `rushpoint.chunkReload.<key>` sessionStorage flag is set on the first retry and **never cleared on success**. | A long-lived PWA tab that survives *two* deploys: the first stale-chunk event self-heals (reload), but a *second* stale-chunk event for the same key hits the already-set flag → immediate rethrow to the ErrorBoundary with **no reload attempt**. Rare, recoverable by manual reload. | Low | Clear the flag once the import resolves so each distinct staleness event gets its own one-shot retry. |
| 5 | `PlayScreen.tsx` 161-192 (watcher) + `TaskRunner.tsx` 273-287 (`checkArrival`) | Player arrives at a **sealed** hidden-location task while briefly offline. The background `reportArrival` probe fails silently; the manual button is `blockedOffline`. On reconnect, `refresh()` re-fetches state but does **not** re-probe arrival — unseal happens on the *next* `watchPosition` callback. | If the player is **stationary** at the destination when they reconnect, some browsers won't fire a fresh GPS tick, so the card can stay sealed until they move. Not a permanent dead-end: the manual "check arrival" button works the instant they're back online. | Low | On the `online` event, also nudge an arrival re-probe (not just `refresh`) when `pendingArrivalRef.current` is set. |
| 6 | `apps/play-web/src/lib/playRoute.ts` 183-195 | Same-run resume compares the **access code string only** (`normCode(session.code) === linkCode`), never `runId`. | If a run can expose **multiple access codes** for one run, scanning a *sibling* code sets `clearSession: true` → rejoin. For a normal player (uid == teamId) server progress survives the rejoin; but an **attached viewer device** (teamId ≠ uid) rejoining as "create" becomes a founding device of a new team, losing its attachment. | Low | Needs runtime check: confirm whether a run ever has >1 access code. If yes, also treat a same-`runId` session as a no-op resume. |
| 7 | `apps/play-web/public/sw.js` 40-47 | The navigation handler caches `res.clone()` as `/index.html` **unconditionally** — no `res.ok`/status check (unlike the static-asset branch at 56, which requires `status === 200`). | If a deploy/proxy briefly serves a 404/5xx for a navigation, that error page is cached as the offline app shell and served to the player next time they open offline. | Low | Only cache the navigation response when `res.ok`. |
| 8 | `PlayScreen.tsx` 77-95, 319-341 | Hard reload while **fully offline**. `getMyTeamState` is a callable (network), not a Firestore read, so `persistentLocalCache` can't serve it; first-load `hasState.current` is false. | The player sees the full-screen error card ("try again" / "leave") rather than a cached game view — no offline play after a cold reload. Not sealed-task-specific; a general limitation of the callable-driven hot path. | Low | Out of scope to fix here; documented so it isn't re-flagged as a regression. |

---

## Clean bills (verified correct — do not re-flag)

- **`playRoute` precedence table (`playRoute.ts` 142-206).** Traced every combo the brief called
  out: `?staff=`+`?code=` → staff (code never reached); malformed `?staff=broken`/`?staff=` →
  staff manual entry (`ctx: null`), **never** a player route; legacy `?staff&owner&game&run` and the
  partial `?staff&game=g` → staff, and `game` is *consumed* so it can't be re-read as a promo id;
  `?board=`+`?staff` → staff (higher precedence); whitespace/case `?code=` normalised via `normCode`;
  a finished same-run link still resumes (`play`, `clearSession:false`) so the player keeps their
  results; a different code clears the stale session. A staff link never sets `clearSession`, so a
  marshal borrowing a player's phone can't wipe the session. `scripts/test-play-route.ts` covers all
  of these plus the top-to-bottom precedence sweep. No path drops an in-progress session or sends
  staff to the player view.
- **Boot-time stale clearing (`App.tsx` 79-100).** Runs inside `ensureAuth().catch().finally()`,
  which always settles, and `setReady(true)` gates first render — so `clearSession()` + `setSession`
  happen **before** the first real paint. The only in-app URL mutation (staff exit, `exitStaff`
  126-137) re-runs `stripStaffParams` and never needs player-session clearing. Single boot path; no
  entry that renders `PlayScreen` with a stale session.
- **`lazyWithRetry` itself (`App.tsx` 27-46).** Genuine one-shot per tab+key (sessionStorage flag +
  a never-resolving promise so the reload takes over) — no infinite reload loop. (Its *reuse* gap is
  finding #4; the loop-safety is sound.)
- **`getMyTeamState` null-field consumers.** `leaderboard` (nullable when unpublished) is guarded
  everywhere: `LiveOps.tsx` 105 (`!!leaderboard?.published && (leaderboard.rankings?.length ?? 0)`),
  `LeaderboardPeek` only mounts under `hasBoard && leaderboard`, `PlayScreen.tsx` 246/288 use `board?.`,
  `FinalScreen.tsx` 41-43/88/243 gate on `run.leaderboard?.published` and `board?.rankings ?? []`.
  `lockedTaskIds` is `?? []` (`TaskRunner.tsx` 89), `stageNarratives`/`powerUps.log` are `?? []`,
  `activeStageTasks` is a required `SafeTask[]` in the type. `SafeTask.title`/`type` are correctly
  treated as optional for the sealed-task stub (`TaskRunner.tsx` 446-482 renders the clue card
  without them). No unguarded `.length`/`.find(...).x`/`.map` over a nullable array found.
- **`useAsyncAction` wiring where it IS used.** Join (`lookup`/`submit`/`attach`), SOS, share,
  trackables (`pickup`/`drop`, keyed), and zone capture (keyed) are all correctly guarded and
  key-scoped. The gap is TaskRunner (finding #3), not the hook.
- **Arrival latch happy path + self-heal.** `pendingArrivalRef` is re-derived from server state on
  every render (`PlayScreen.tsx` 354), so even if a probe nulls it and the follow-up `refresh` fails,
  the next render re-arms it. `reportArrival` latches server-side, so repeat probes are idempotent.
  The "sealed card can never unseal" state does not exist on the happy/online path.

---

## Highest-severity takeaways for the caller

- **#2 (unwrapped lazy chunks, esp. `NavMap`)** is the closest cousin of the dead-ends a live player
  just hit: after any redeploy, a mid-game player opening the map on a cached shell can get an
  infinite spinner with no retry. Wrap `NavMap` in `lazyWithRetry`.
- **#1 (overlay dismiss → JoinScreen for an already-joined player)** is the most likely to be *seen*
  at an event, since leaderboard/recap links get shared into team chats.
- **#3 (TaskRunner not using `useAsyncAction`)** is the systemic one: the app adopted an in-flight
  guard specifically for double-tap safety, then didn't apply it to the primary player actions;
  `submitStationPhoto` is the piece whose double-fire safety is least certain.

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
`npm run creator:build` · `npm run e2e` — all green. Project context + per-artifact rules that drive
proposals/designs/tasks live in [openspec/config.yaml](openspec/config.yaml).

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

### Required gates (run before declaring anything done)
```bash
npm run typecheck        # all workspaces — must pass
npm test                 # pure-logic lane: scripts/test-*.ts aggregator + vitest in functions/
npm run lint             # creator-web eslint — 0 errors (style warnings ok)
npm run creator:build    # production build of creator-web — must pass
npm run e2e              # node scripts/e2e-verify.mjs — full lifecycle vs the emulator
npm run i18n:check       # ⚠ MANDATORY AFTER ANY UI CHANGE — Hebrew↔English correctness
```
`npm run e2e` exercises createGame → updateGame → launchRun → join → start → play (code + photo +
field) → staff review → live leaderboard → finalize, plus partial stages, locationless routing,
finished-run rejection, and paid hints. Keep it green; extend it when adding callables.

> 🌐 **i18n gate — if you touch ANY UI (text, JSX, components, `i18n.ts`), you MUST run
> `npm run i18n:check` and it MUST come out clean.** It guarantees Hebrew copy is really Hebrew
> and English copy is really English, and that no component hardcodes a UI string that won't switch
> language (the recurring "English text showing while the app is in Hebrew" bug, especially in the
> Builder). **PART A (dictionaries) is a hard gate — never ship with a PART A error.** PART B lists
> hardcoded strings that bypass `t.*`: fix the ones your change touches (route the text through
> `t.*`), or, for a deliberate non-switchable literal (brand mockup, sample data), add a trailing
> `// i18n-ignore` on that line with a reason. New UI must add **zero** new PART B warnings — verify
> with `npm run i18n:check:strict`. See [scripts/check-i18n.ts](scripts/check-i18n.ts).

### What the dev scripts handle (hard-won — don't regress)
- **`scripts/dev-emulator.mjs`** — detects Java and **auto-switches to a JDK ≥ 21** (the emulator
  needs 21+). **Builds Cloud Functions before** the emulator starts (a stale `functions/lib` was a
  past failure). Data persists via `--import`/`--export-on-exit` to `.firebase/emulator-data`.
- **`scripts/free-ports.mjs`** (`predev:all`) — kills stale Vite/emulator processes.
- **`scripts/seed-local.mjs`** — seeds only if empty (idempotent): a demo creator (`demo-creator`),
  the "Old City Treasure Hunt" demo game, a live run + access code. `npm run seed:reset` re-seeds.

> ⚠️ **Stop with Ctrl+C** so `--export-on-exit` persists emulator data.
> ⚠️ Client configs connect over **`127.0.0.1`** (not `localhost`) to avoid the Windows IPv6 mismatch.

---

## Firestore data model ⚠️ (multi-tenant — never deviate)

```
users/{ownerUid}                                              creator profile + wallet ref
users/{ownerUid}/games/{gameId}                              private game template (the Builder edits this)
users/{ownerUid}/games/{gameId}/runs/{runId}                 a live run (CF-written only)
       …/runs/{runId}/teams/{teamId}                         a team/individual's full progress (teamId == participant uid)
       …/runs/{runId}/{announcements|flashMissions}          live-ops broadcasts (read: any authed)
       …/runs/{runId}/{alerts|teamLocations|staffInvites}    SOS, live map pings, staff PINs
publicGames/{gameId}, publicTasks/{taskId}                   denormalized gallery (public read)
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
| `games/index.ts` | createGame · updateGame · deleteGame · duplicateGame · publishGame · getGame · listGames |
| `runs/index.ts` | launchRun · joinRun · getJoinInfo · startTeams · skipStage · finalizeRun · **refreshLeaderboard** · **getPublicLeaderboard** · listRunTeams · completeTask · requestNextTask · **requestTaskHint** · getRecommendedTasks · checkOutTask · getMyTeamState |
| `gallery/index.ts` | searchGallery · searchTaskLibrary · incrementTaskCopyCount |
| `payments/index.ts` | getWallet · **getWalletStatus** · **purchaseCredits** · **subscribePro** · **claimReferral** · stripeWebhook (onRequest) |
| `index.ts` (root) | inviteStaff · staffSignIn · updateLocation · triggerSOS · acknowledgeAlert · pushAnnouncement · deactivateAnnouncement · pushFlashMission · verifyStationCode · submitStationPhoto · reviewStationSubmission · adjustTeamScore · listAuditLogs |
| `routing/assignNextTask.ts` | (internal) `assignTask` · `buildRecommendations` · `computeSkillRatio` · `releaseTask` |
| `scoring/` | `taskScore.ts`, `calculateScore.ts`, `scoringPresets.ts` (in shared), `stationVerification.ts` |

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
- **Creator UI** → `apps/creator-web/src/pages/*` (Dashboard, Builder, Gallery, Wallet, RunConsole);
  shared kit in `components/ui.tsx`; data layer `services/api.ts` (`callable()`) + `services/calls.ts`.
  Builder is tile + modal (`BuilderPage` `TaskEditor`); quick-start templates in `templates.ts`;
  whole-route `RoutePreviewMap` on the Preview step. New-game flow seeds a template via updateGame.
- **Participant UI** → `apps/play-web/src/screens/*` (Join, Play, Final, StaffConsole,
  GamePromo, PublicLeaderboard) + `components/*` (TaskRunner, NavMap, LiveOps, ConnectionBanner).
  Session in `store.ts`. **Public marketing routes** (no router; `App.tsx` reads query params):
  `?game=<id>` → game promo/teaser (public `publicGames` read), `?board=<accessCode>` → public
  shareable leaderboard (`getPublicLeaderboard`, published-only). Shareable "story" images are
  canvas-drawn in `lib/storyCard.ts` (`shareStoryCard()` — finish + in-run brag cards).
- **Marketing & virality** — branded OG images at `apps/*/public/og.jpg` (see
  [scripts/og-cards.README.md](scripts/og-cards.README.md)); creator landing page is the
  logged-out `AuthGate`; `ShareSheet` (QR + copy + native share) powers game-promo and referral
  invites; referral program = `claimReferral` + `?ref=<uid>` capture in `AuthGate` (grants a free run to
  both sides, `REFERRAL_BONUS_FREE_RUNS`). The play-web finish screen also carries a `?ref=<ownerUid>`
  "Powered by RushPoint" footer on non-Pro runs.
- **Types / paths / scoring / geo** → `packages/shared/src` (`types/index.ts`, `scoringPresets.ts`,
  `geo.ts`, `mapStyle.ts`, `validation.ts`).
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
- **Bundle:** keep heavy deps (MapLibre) behind `React.lazy`.

## Environment files (all gitignored; emulator-safe defaults baked into client configs)
```
apps/creator-web/.env   # VITE_FIREBASE_* (+ VITE_MAPTILER_KEY)
apps/play-web/.env      # VITE_FIREBASE_* (+ VITE_MAPTILER_KEY)
functions/.env          # STRIPE_*, QR_SECRET (server-only)
```

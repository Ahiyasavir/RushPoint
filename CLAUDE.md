# RushPoint – "Race to Tzion" (המירוץ לציון)

> Developer persona, coding guidelines, and Firestore path rules: see [INSTRUCTIONS.md](INSTRUCTIONS.md)
> Full architecture reference: see [TECH_SPEC.md](TECH_SPEC.md) · Directory map: see [STRUCTURE.md](STRUCTURE.md)

Gamified real-time team management app powering the Race to Tzion adventure event in Jerusalem.

---

## Current Status (Phases 1–3 ✅ complete — feature-complete on the local emulator)

> Live status & next steps: **[STATUS.md](STATUS.md)**. All Phase 2 blueprint math + Phase 3
> gamification are implemented and verified e2e (`node scripts/e2e-verify.mjs` → 44/44 PASS).

The full game lifecycle runs against the Firebase Emulator Suite:

1. **Access code → Register** — server-side `registerTeam` validates/claims the code and seeds
   the team profile + initial `gameState` (slot 0 active).
2. **Dashboard** — live `gameState` mirror: 6 stages, score (effective = score − penalty), gate
   card, crafting countdown, matchmaking, flash-mission overlay, SOS + clue-hint buttons.
3. **Smart routing** — `requestNextTask` / `getRecommendedTasks` rank stations by load (Φ),
   transit (haversine) and skill match (Ω); Teams admin page reflects live registrations.
4. **Judge flow** — pending check-ins → check-in (freezes clock) → grade Tene basket + team
   cohesion → finalize. Score = **sigmoid task score** + basket grade − cohesion penalty.
5. **Phase 3 gamification** — gate matchmaking (1v1 duels), 3 basket zones, 20-min crafting +
   90-sec sprint with exponential penalties, leaderboard freeze + Z-Score finalize + sequential
   reveal, flash missions, SOS alerts, clue-hint penalties, Final Run celebration.
6. **Bilingual UI** — every screen in both apps toggles English ⇄ Hebrew (RTL); dark neon theme.

The whole stack boots with a single command (`npm run dev:all`). See **Local Development** below.
**Remaining:** Wrapped/summary cards (deferred) + production deploy. See STATUS.md.

---

## Architecture Overview

**Monorepo** managed with npm workspaces:

| Package | Tech | Purpose |
|---|---|---|
| `apps/mobile` | Expo (React Native SDK 52) | Team app — runs on iOS/Android **and web** (used for the demo) |
| `apps/admin` | React + Vite | Web dashboard for judges & admins (Vite dev server on **:5180**) |
| `functions/` | Node 20 + Firebase Functions (v1 `onCall`) | Registration, judging, routing, scoring |
| `packages/shared` | TypeScript | Canonical types + Firestore path helpers (`@rushpoint/shared`) |
| `scripts/` | Node (tsx / .mjs) | Emulator launcher, seeding, port cleanup |

**Backend**: Firebase (Firestore, Auth (anonymous), Cloud Functions, Storage) — local Emulator Suite.
**State (mobile)**: Zustand. **Styling**: NativeWind v4 (mobile) / Tailwind (admin).

**Project ID** (`race-to-tzion-2026`) is used consistently as **both** the Firebase project id
(`.firebaserc`, client configs, seed) **and** the Firestore `appId` path segment. Keep them aligned.

---

## Local Development — one command

```bash
npm install          # once
npm run dev:all      # boots EVERYTHING in one terminal
```

`dev:all` runs (via `concurrently`, after a `predev:all` port cleanup):

| Pane | What | URL |
|---|---|---|
| **EMU** | `scripts/dev-emulator.mjs` → builds functions, then Emulator Suite | UI: http://127.0.0.1:4000 |
| **SEED** | `wait-on` ports, then `scripts/seed-local.mjs` (seed-if-empty) | — |
| **MOBILE** | `expo start --web` | http://localhost:8081 |
| **ADMIN** | `vite --port 5180` | **http://localhost:5180** |

**Emulator ports:** UI 4000 · Auth 9099 · Functions 5001 · Firestore 8080 · Storage 9199 · Hosting 5002.

### What the dev scripts handle for you (hard-won; don't regress these)
- **`scripts/dev-emulator.mjs`** — detects the Java *version* and **auto-switches to a JDK ≥ 21**
  (the emulator requires 21+; an older Java first on PATH would otherwise break it). It **builds
  Cloud Functions before** the emulator starts (mandatory — a stale/missing `functions/lib` was a
  past failure). Data **persists** via `--import`/`--export-on-exit` to `.firebase/emulator-data`.
- **`scripts/free-ports.mjs`** (runs as `predev:all`) — kills stale Metro/Vite/emulator processes so
  a leftover server can't block startup. Includes 8081, 5173/5174/**5180**, and emulator ports.
- **`scripts/seed-local.mjs`** — seeds **only if the DB is empty** (idempotent): tasks, access codes
  (incl. `1234`), a test user, and a complete demo team **"The Lions" (LION1)** with a *pending
  check-in* so the Judge/Check-in panel has data on first boot. For the full multi-team dataset run
  `npm run seed:reset`.

### Other commands
```bash
npm run emulator       # just the emulator (same launcher)
npm run mobile         # expo start (native)        npm run mobile:web  # expo start --web
npm run admin          # vite on :5180
npm run functions:serve / functions:deploy
npm run seed           # comprehensive seed (merge)  npm run seed:reset  # wipe + comprehensive seed
npm run typecheck / lint / format
```

> ⚠️ **Stop with Ctrl+C** (not by closing the window) so `--export-on-exit` saves emulator data.
> ⚠️ Client configs connect to the emulator over **`127.0.0.1`** (not `localhost`) to avoid the
> Windows IPv6 (`::1`) mismatch — keep it that way.

---

## Project Structure (current)

```
rushpoint/
├── apps/
│   ├── mobile/                 # Expo (web + native)
│   │   ├── app/                # expo-router screens
│   │   │   ├── _layout.tsx     # providers incl. <ToastProvider>
│   │   │   ├── index.tsx       # anonymous auth gate
│   │   │   ├── access-code.tsx # enter Access Code (validates against accessCodes)
│   │   │   ├── register.tsx    # team form → calls registerTeam callable
│   │   │   ├── dashboard.tsx   # 6 stages, score, gate/crafting/match, flash overlay, SOS+hint
│   │   │   ├── map.tsx         # MapTiler static topo mission map (Motza→Gan HaKipod route)
│   │   │   ├── basket-zone.tsx # riddle + interactive Tene-fill menu + 20-min/sprint countdown
│   │   │   ├── sos.tsx         # emergency alert (two-step confirm + GPS → triggerSOS)
│   │   │   └── final-run.tsx   # race-complete celebration (animated trophy + synth fanfare)
│   │   └── src/
│   │       ├── components/      # Tier 1 kit: Text, Button, Card, Badge, Input, Toast, tokens.ts
│   │       │                    # + LanguageToggle, FlashMissionBanner, AnnouncementBanner,
│   │       │                    # ErrorBoundary, TopoMap (keyless OpenTopoMap mission map)
│   │       ├── hooks/           # useGameSync, useOfflineToast, useFlashMissions, useSlotSound,
│   │       │                    # useAnnouncements, useAdaptiveLocation (geo pings), useWakeLock,
│   │       │                    # useDeviceLocation(.web), useRaceConfig
│   │       ├── data/            # teneProducts.ts (crafting-menu mirror of the catalog)
│   │       ├── services/        # firebase.config.ts (emulator-wired, 127.0.0.1, AsyncStorage auth)
│   │       └── store/           # gameStore (Zustand mirror of gameState)
│   └── admin/
│       └── src/
│           ├── pages/           # JudgePage (grading + cohesion + timeout warning), CheckInsPage,
│           │                    # TeamsPage, LeaderboardPage (freeze/Z-Score/reveal),
│           │                    # MatchmakingPage, HeatmapPage (+ live team markers),
│           │                    # ManagerPage (stations + evacuate, broadcast, audit log)
│           ├── data/            # teneProducts.ts (UI mirror of the scoring catalog)
│           └── services/        # firebase.ts (emulator-wired + ensureAuth anonymous)
├── functions/
│   └── src/
│       ├── index.ts            # 33 callables — see the Cloud Functions table below
│       ├── firebase.ts          # Admin SDK init (ignoreUndefinedProperties enabled)
│       ├── routing/assignNextTask.ts   # Phase 2 — priority routing (load/transit/skill) ✅
│       └── scoring/
│           ├── taskScore.ts            # Phase 2 — sigmoid per-task time multiplier ✅
│           ├── calculateScore.ts       # transit/sprint penalties + Z-Score + completion bonus ✅
│           └── teneProducts.ts         # authoritative Tene basket scoring catalog
├── packages/shared/src/types/index.ts  # FIRESTORE_PATHS, COLLECTIONS, all interfaces (locked)
└── scripts/
    ├── dev-emulator.mjs        # Java-21-aware emulator launcher + persistence
    ├── free-ports.mjs          # predev port cleanup
    ├── seed-local.mjs          # seed-if-empty (minimal demo set)
    ├── seed-emulator.ts        # comprehensive seed (npm run seed / seed:reset)
    ├── e2e-verify.mjs          # end-to-end callable check vs emulator (44/44)
    └── test-tiebreaker.ts      # tie-breaker unit test (npx tsx)
```

---

## Firestore Data Model ⚠️ (paths — never deviate)

```
PUBLIC  →  artifacts/{appId}/public/data/{collection}/{docId}     # tasks, events, leaderboard, …
PRIVATE →  artifacts/{appId}/users/{userId}/{collection}/{docId}  # profile, gameState, checkIns, …
CODES   →  artifacts/{appId}/accessCodes/{code}                   # pre-generated event codes
```

`{appId}` = `race-to-tzion-2026`. Always use the `FIRESTORE_PATHS` helpers from `@rushpoint/shared`
— never hardcode path strings. (The old flat `teams/` `tasks/` model in earlier docs is obsolete.)

Key documents:
- `…/users/{uid}/profile/team` — `Team` (name, code, captainPhone, participants, memberNames, status…).
- `…/users/{uid}/gameState/current` — `GameState` (8 `slots`, `score`, `judging` freeze state…).
  **Server-write-only** — clients are blocked by `firestore.rules`; only Cloud Functions write it.
- `…/users/{uid}/checkIns/{id}` — `CheckIn` (`status: 'pending' | 'approved' | 'rejected'`, judge fields).
- `…/accessCodes/{code}` — `{ code, claimed, teamId }`. Readable by any authed client; the **claim**
  (`claimed: true`) is written only by `registerTeam` (Admin SDK).

---

## Auth & Registration (access-code system)

1. App signs in **anonymously** (each browser/device gets its own uid).
2. User enters an **Access Code**; the client reads `accessCodes/{code}` to validate it.
3. Submitting the registration form calls the **`registerTeam`** Cloud Function, which (atomically,
   Admin SDK) validates+claims the code, writes `profile/team`, and seeds `gameState/current` with
   **slot 0 active and a task assigned** (so the dashboard skips the "stand by" screen).

> Identity note: the mobile team is tied to the **anonymous browser uid**. Pre-seeded teams (e.g.
> "The Lions") show in the Admin panel (which reads across all teams) but are a *different identity*
> than whatever you register on the phone — that's expected, not a bug.

## Cloud Functions (v1 `https.onCall`) — 33 callables

| Function | Role |
|---|---|
| `registerTeam` | Claim access code + create profile + seed gameState |
| `joinTeam` | Second device joins an already-claimed code → mints a custom token for the original team uid (same account, two devices) |
| `listPendingArrivals` | Admin: list teams with `status:'pending'` check-ins (collectionGroup) |
| `checkInArrival` | Judge: record arrival, freeze the team's mobile clock (`gameState.judging`) |
| `finalizeJudgeEvaluation` | Judge: basket score **+ sigmoid task score − cohesion penalty**, complete slot, advance |
| `requestNextTask` | Assign the best next task via priority routing (server reads completed slots + skill) |
| `getRecommendedTasks` | Return a ranked task list (load/transit/skill) **without** committing an assignment |
| `checkOutTask` | Release a station slot (`currentTeamCount` decrement) when a team leaves |
| `listTeams` | Admin: all registered teams + live score/progress (collectionGroup, score-sorted) |
| `skipTask` | Admin: skip the active slot, awarding the task average |
| `checkInGate` | Arrive at the park (transit penalty) — kept for backend/e2e; not on the active mobile path |
| `getBasketZone` | Mobile: assign the least-crowded basket zone + riddle |
| `startCraftingTimer` | Mobile: start the 20-min crafting countdown (+ 90-sec sprint window) |
| `joinMatchQueue` / `resolveMatch` / `bypassMatchmaking` | Gate 1v1 matchmaking. `resolveMatch`: **only the winner advances** (+150 + gate slot completes); the loser is re-queued (`waiting`). `joinMatchQueue` is idempotent (no double matches) |
| `saveTeneSelection` | Mobile: persist the crafting-menu product picks to `gameState.teneSelection` (pre-fills the judge checklist) |
| `triggerLeaderboardFreeze` | Admin: freeze/unfreeze the leaderboard |
| `finalizeLeaderboard` | Admin: final ranking — completion bonus − bonusPenalty, then **Z-Score** normalization |
| `pushFlashMission` | Admin: broadcast a time-limited bonus mission (canonical public path) |
| `triggerSOS` / `acknowledgeAlert` | Mobile raises an emergency alert; admin clears it |
| `requestClueHint` | Mobile: trade 50 pts (→ `bonusPenalty`) for a hint |
| `setStationStatus` / `evacuateStation` | Manager: pause/close a station (excluded from routing) / release teams off a closed station without penalty (audited) |
| `pushAnnouncement` / `deactivateAnnouncement` | Manager: global operational broadcast (persists until deactivated) — distinct from gamified flash missions |
| `adjustTeamScore` | Manager: apply a fine (delta) or score override — writes an audit entry with prev/new |
| `listAuditLogs` | Manager: read the immutable action log (admin-only path `artifacts/{appId}/auditLogs`) |
| `updateLocation` | Mobile: lean per-team location ping (foreground geo-throttling) → `public/data/teamLocations` for the live heatmap |
| `getStationTeams` | Station operator: teams currently at a station (active slot taskId match) + roster/phone |
| `stationReleaseTeam` | Station operator: pass/fail a team's mission, apply missing-member cohesion penalty, advance + release the counter |
| `stationCallHelp` | Station operator: summon roaming staff (writes a 'technical' admin alert tagged with the station) |

> Note: `bypassMatchmaking` is retained but now **rejects** — teams must win a duel (no skip).
> Role gating in the admin app is **client-side** (simple role selection, demo-grade); for
> production swap for Firebase custom claims.

Judge/admin callables require an authenticated caller; the admin-claim check (`assertJudge`) is
**relaxed on the emulator** (`FUNCTIONS_EMULATOR`) so the demo runs with a plain anonymous sign-in.
The full set is exercised by `node scripts/e2e-verify.mjs` against the emulator.

## UI Component Kit (mobile, Tier 1)

`Text · Button · Card · Badge · Input · Toast · LanguageToggle · FlashMissionBanner ·
AnnouncementBanner · ErrorBoundary · TopoMap` + `tokens.ts` (GLOW, GLASS, GRADIENTS, BG —
dark neon theme; **see "Theming / reskin surface" below** before the UI overhaul).
`<ToastProvider>` is mounted in `app/_layout.tsx`; use `useToast()` for non-blocking messages.
Follow NativeWind rules: static class strings only (no dynamic `bg-${x}`), native shadows via `style`.

### Theming / reskin surface (where the visual language lives)
A reskin (e.g. the planned light "Topographic Expedition" theme — see
[DESIGN_IMPORT_NOTES.md](DESIGN_IMPORT_NOTES.md)) is almost entirely a **config-level** edit,
because screens use semantic class names (`bg-app-bg`, `text-neon-green`, `border-glass-border`)
rather than inline colors. Change the palette in these four places:
1. `apps/mobile/tailwind.config.js` — color tokens (`app-bg/surface/card/raised`, `neon-*`, `glass-*`).
2. `apps/admin/tailwind.config.js`  — the same token names (keep them in sync).
3. `apps/mobile/src/components/tokens.ts` — `GLOW/GLASS/GRADIENTS/BG` (soften shadows for a light theme).
4. `apps/admin/src/index.css` — admin global styles.
Remaining inline hex is small and localized: `TopoMap.tsx` (map marker/route colors),
`ErrorBoundary.tsx` (both apps), and a few `style`-prop values (Switch/ActivityIndicator) in
`register/sos/dashboard/basket-zone/final-run`. Grep `#[0-9a-fA-F]\{6\}` to find them.

## Internationalisation (English / Hebrew) 🌐

Both apps ship a full **EN/HE** toggle with RTL support. No heavy i18n dependency — a small typed
dictionary + a `t(key, vars)` interpolator per app.

| App | Module | State | Toggle |
|---|---|---|---|
| `apps/admin` | `src/i18n/index.tsx` | React Context (`LanguageProvider` / `useI18n`) | button in the top nav |
| `apps/mobile` | `src/i18n/index.ts` | Zustand store (`useTranslation`) | `<LanguageToggle>` on access-code + dashboard |

- Choice persists to `localStorage`; on web both set `document.documentElement.dir` so Tailwind
  **logical** utilities (`ms-`/`me-`/`text-start`/`text-end`) mirror automatically. Prefer logical
  classes over `ml-`/`text-left` in new UI so RTL keeps working.
- Task content is already bilingual in Firestore (`title`/`titleHe`, `description`/`descriptionHe`).

---

## Core Concepts

### Slot System (6 stages)
- Slots 0–2 (🟢 green): open-field missions, judge-advanced — slot 0 active on start.
- Slot 3 (🔵 gate): matchmaking duel (זיווג). **Only the winner advances**; the loser is
  sent back to the queue (`matchStatus:'lost'` → re-paired) until they win.
- Slot 4 (🟠 orange): find the Tene basket + scan its QR (starts the 20-min crafting clock).
- Slot 5 (🥇 gold): fill the Tene from the menu (20 min) + 90-sec sprint to the judges + judging.
- Unlock rules: linear chain — each completed slot activates the next; all 6 done → Final Run.

### Scoring
Per-slot score = **task score + basket grade**, computed **authoritatively in the Cloud Function**:
- **Task score** (`scoring/taskScore.ts`): `100·difficulty · M(x)` where `x = actual/target` minutes and
  `M(x) = 0.2 + 1.3/(1+e^(3(x−1)))` — a sigmoid that rewards speed (~1.43×) but caps exploit-grade times.
- **Basket grade** (`scoring/teneProducts.ts`): product checklist (weighted Tene catalog) + design (0–20)
  + presentation (0–20).
- **Penalties → `gameState.bonusPenalty`** (subtracted from the final score): clue hints (50 each),
  team cohesion (100 per missing member at judging), exponential gate/sprint late penalties.
- **Final ranking** (`finalizeLeaderboard`): `max(0, Σ earned + 500·allDone − bonusPenalty)`, then a
  **Z-Score** time bonus/penalty (±200 pts per σ vs the field's completion times).

### Smart routing (`routing/assignNextTask.ts`)
`Priority = 0.5·load − 0.3·transit + 0.2·skillMatch`, higher is better. Load uses `currentTeamCount`
vs `maxConcurrentTeams`; transit is haversine at ~5 km/h; skillMatch aligns the team's measured pace
(`S_i ∈ [−1,1]`) to task difficulty. `requestNextTask` claims the top task with an atomic increment;
`getRecommendedTasks` returns the ranked list without writing.

### Operational features (Phase 3 advanced)
- **Station control:** `Task.status` (`active`/`paused`/`closed`) — paused/closed stations are
  excluded from routing. `evacuateStation` releases teams off a closed station (no penalty), clears
  their slot, decrements the counter, and flags `gameState.evacuatedFrom` (mobile toasts once).
- **Broadcast:** `announcements` (public) drive a persistent marquee on the mobile dashboard
  (per-device dismissal), separate from gamified flash missions.
- **Geo-throttling:** mobile `useAdaptiveLocation` pings `updateLocation` fast (~20 s) in transit,
  slow (~4 min) when checked-in/crafting → `public/data/teamLocations` feeds the live heatmap.
- **Audit trail:** every admin mutation writes to `artifacts/{appId}/auditLogs` (admin-read-only);
  the Event Manager page (`/manager`) reads it via `listAuditLogs` and can fine/override scores.
- **Timeout safety net:** `Task.maxDurationMinutes` drives a flashing warning on the Judge page once
  a checked-in team exceeds it — the judge then extends or force-skips (judge decides).
- **Tie-breaker:** `finalizeLeaderboard` breaks score ties via `compareForRanking`
  (penalties → combined green time → transit time), a pure unit-tested comparator.

---

## Phase Roadmap (see STATUS.md for the live tracker)

| Phase | Status | Scope |
|---|---|---|
| **Phase 1 — MVP** | ✅ done | Access-code auth, dashboard, judge scoring slice, component kit |
| **Phase 2 — Core Math & Routing** | ✅ done | Sigmoid task scoring, priority routing (load/transit/skill), `getRecommendedTasks`, real Teams list, **bilingual EN/HE UI**, admin skip-task |
| **Phase 2 — Live & Maps** | ✅ done | Live Firestore sync (`useGameSync`), offline persistence + toast, slot audio cues (Web Audio). **Topographic maps via MapLibre + MapTiler `outdoor`** (free, no card; keyless OpenTopoMap fallback): admin live heatmap + route line + start/finish, mobile static topo mission map. Canonical route/station geo in `@rushpoint/shared` (`geo.ts`) — Motza → Arazim Valley → Gan HaKipod (Ramot Bet) |
| **Phase 3 — Gamification** | ✅ done | Gate matchmaking, basket zones, crafting/sprint penalties, leaderboard freeze + Z-Score + reveal, flash missions, SOS, clue-hints, team cohesion, Final Run |
| **UI Overhaul** | ✅ done | Dark neon theme + glassmorphism (Inter/Outfit/JetBrains Mono) across both apps |
| **Remaining** | ⬜ | Wrapped/summary cards (deferred) + **production deploy** (see STATUS.md → "הכנה לפרישה") |

## Key Decisions & Caveats (things we already hit)

- **gameState/score are server-only.** Never write them from a client; rules block it. Use Cloud Functions.
- **Emulator needs Java ≥ 21** — the launcher auto-detects and switches; don't revert that logic.
- **Admin dev server is on `:5180`** (moved off 5173 after a `--strictPort` collision left users on a
  stale tab). Open whatever the `[ADMIN]` pane prints.
- **Connect to emulators via `127.0.0.1`**, not `localhost` (Windows IPv6).
- **Stop with Ctrl+C** to persist emulator data (`--export-on-exit`).
- Expo prints version-mismatch warnings (expo-camera/image-picker/network, react-native) — non-fatal;
  align later with `npx expo install --fix`.
- `firestore.rules`: `accessCodes` is readable by authed users; `gameState` writes are closed to clients.

## Key Constraints
- Max concurrency per station: 3 teams (configurable per event).
- Target devices: iOS 15+, Android 10+; judge UI must work in a phone browser, no install.
- Leaderboard freezes 30 min before event end OR on first "Final Run" trigger (Phase 3).

## Environment Files
```
apps/mobile/.env   # EXPO_PUBLIC_FIREBASE_* (+ EXPO_PUBLIC_EMULATOR_HOST, EXPO_PUBLIC_MAPTILER_KEY)
apps/admin/.env    # VITE_FIREBASE_* (+ VITE_RUSHPOINT_APP_ID, VITE_MAPTILER_KEY)
functions/.env     # RUSHPOINT_APP_ID, QR_SECRET (server-side only)
```
All `.env` files are gitignored; emulator-safe defaults are baked into the client configs, so the
stack boots without any `.env` present. See `*.env.example` in each package.

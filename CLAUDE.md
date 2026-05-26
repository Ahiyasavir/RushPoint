# RushPoint – "Race to Tzion" (המירוץ לציון)

> Developer persona, coding guidelines, and Firestore path rules: see [INSTRUCTIONS.md](INSTRUCTIONS.md)
> Full architecture reference: see [TECH_SPEC.md](TECH_SPEC.md) · Directory map: see [STRUCTURE.md](STRUCTURE.md)

Gamified real-time team management app powering the Race to Tzion adventure event in Jerusalem.

---

## Current Status (Phase 1 — Tracer Bullet: ✅ working on the local emulator)

The end-to-end Phase 1 slice runs against the Firebase Emulator Suite:

1. **Access code → Register** — user enters an event Access Code; a server-side `registerTeam`
   Cloud Function validates/claims the code and creates the team profile + initial `gameState`.
2. **Dashboard** — mobile (web) lands on **Mission 01 active** with a live elapsed timer.
3. **Judge flow** — the Admin panel lists pending check-ins, the judge checks a team in
   (freezing their mobile clock), grades the Tene basket, and finalizes — score updates server-side.

This was validated by calling the callables with a real anonymous token end-to-end. The whole stack
boots with a single command (`npm run dev:all`). See **Local Development** below.

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
│   │   │   └── dashboard.tsx   # active mission + live/frozen elapsed timer
│   │   └── src/
│   │       ├── components/      # Tier 1 kit: Text, Button, Card, Badge, Input, Toast, tokens.ts
│   │       │                    # + SlotCard, ProgressBar
│   │       ├── hooks/           # useSlotSound
│   │       ├── services/        # firebase.config.ts (emulator-wired, 127.0.0.1)
│   │       └── store/           # gameStore (Zustand)
│   └── admin/
│       └── src/
│           ├── pages/           # JudgePage (grading flow), CheckInsPage (pending list),
│           │                    # TeamsPage, LeaderboardPage, HeatmapPage
│           ├── data/            # teneProducts.ts (UI mirror of the scoring catalog)
│           └── services/        # firebase.ts (emulator-wired + ensureAuth anonymous)
├── functions/
│   └── src/
│       ├── index.ts            # registerTeam, listPendingArrivals, checkInArrival,
│       │                       # finalizeJudgeEvaluation, requestNextTask, checkOutTask,
│       │                       # triggerLeaderboardFreeze, pushFlashMission
│       ├── firebase.ts
│       ├── routing/assignNextTask.ts   # Phase 2 — DO NOT edit yet
│       └── scoring/
│           ├── calculateScore.ts       # Phase 2 — DO NOT edit yet
│           └── teneProducts.ts         # authoritative Tene basket scoring catalog
├── packages/shared/src/types/index.ts  # FIRESTORE_PATHS, COLLECTIONS, all interfaces (locked)
└── scripts/
    ├── dev-emulator.mjs        # Java-21-aware emulator launcher + persistence
    ├── free-ports.mjs          # predev port cleanup
    ├── seed-local.mjs          # seed-if-empty (minimal demo set)
    └── seed-emulator.ts        # comprehensive seed (npm run seed / seed:reset)
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

## Cloud Functions (v1 `https.onCall`)

| Function | Role |
|---|---|
| `registerTeam` | Claim access code + create profile + seed gameState |
| `listPendingArrivals` | Admin: list teams with `status:'pending'` check-ins (collectionGroup) |
| `checkInArrival` | Judge: record arrival, freeze the team's mobile clock (`gameState.judging`) |
| `finalizeJudgeEvaluation` | Judge: score the basket, complete slot, unfreeze, advance team |
| `requestNextTask` / `checkOutTask` | Routing (Phase 2) |
| `triggerLeaderboardFreeze` / `pushFlashMission` | Phase 3 |

Judge callables require an authenticated caller; the admin-claim check is **relaxed on the emulator**
(`FUNCTIONS_EMULATOR`) so the demo runs with a plain anonymous sign-in.

## UI Component Kit (mobile, Tier 1)

`Text · Button · Card · Badge · Input · Toast` + `tokens.ts` (GLOW shadows). `<ToastProvider>` is
mounted in `app/_layout.tsx`; use `useToast()` for non-blocking messages. Follow NativeWind rules:
static class strings only (no dynamic `bg-${x}`), native shadows via `style`.

---

## Core Concepts

### Slot System (8 slots)
- Slots 0–3 (🟢 green): open-field missions — slot 0 active on start.
- Slot 4 (🟠 orange): navigate to Bible Park, find the Tene basket.
- Slots 5–7 (🥇 gold): basket-filling crafts; judge-graded.
- Unlock rules: green[n]→green[n+1]; green[3]→orange; orange→all three gold; all 8 done → Final Run.

### Scoring
Basket grade = product checklist (weighted, Tene catalog) + design (0–20) + presentation (0–20),
computed **authoritatively in the Cloud Function** (`functions/src/scoring/teneProducts.ts`).

---

## Phase Roadmap

| Phase | Status | Scope |
|---|---|---|
| **Phase 1 — MVP** | ✅ tracer bullet working on emulator | Access-code auth, dashboard, judge scoring slice, component kit |
| **Phase 2 — Backend** | ⬜ planned | Live routing algorithm, offline queue, admin heatmap, map screen, audio |
| **Phase 3 — Gamification** | ⬜ planned | Leaderboard freeze, SOS, flash missions, Wrapped cards |

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
apps/mobile/.env   # EXPO_PUBLIC_FIREBASE_* (+ EXPO_PUBLIC_EMULATOR_HOST, EXPO_PUBLIC_MAPBOX_TOKEN)
apps/admin/.env    # VITE_FIREBASE_* (+ VITE_RUSHPOINT_APP_ID, VITE_MAPBOX_TOKEN)
functions/.env     # RUSHPOINT_APP_ID, QR_SECRET (server-side only)
```
All `.env` files are gitignored; emulator-safe defaults are baked into the client configs, so the
stack boots without any `.env` present. See `*.env.example` in each package.

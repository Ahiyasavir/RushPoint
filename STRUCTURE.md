# RushPoint — Complete Monorepo Directory Map

Legend:  ✅ exists   🔲 planned (Phase 2)   ⬜ planned (Phase 3)

> Updated for Phase 1 tracer-bullet completion: access-code auth, the Tier 1 component kit, the
> judge Cloud Functions, admin Firebase wiring, and the one-command dev tooling all exist now.

```
rushpoint/
│
├── CLAUDE.md               ✅  Claude Code project context & architecture notes
├── INSTRUCTIONS.md         ✅  Developer persona, coding guidelines, Firestore rules
├── STRUCTURE.md            ✅  This file
├── package.json            ✅  npm workspaces root
├── .gitignore              ✅
│
├── firebase.json           ✅  Firebase project config (hosting, functions, emulators)
├── firestore.rules         ✅  Security rules (artifacts/{appId}/public + /users paths)
├── firestore.indexes.json  ✅  Composite index definitions
├── storage.rules           ✅  Firebase Storage access rules
│
│
├── apps/
│   │
│   ├── mobile/                         React Native (Expo SDK 52)
│   │   ├── app.json                ✅  Expo config (permissions, bundle ID, splash)
│   │   ├── babel.config.js         ✅  NativeWind JSX transform + Reanimated plugin
│   │   ├── metro.config.js         ✅  withNativeWind wrapper
│   │   ├── tailwind.config.js      ✅  NativeWind preset + slot colour tokens
│   │   ├── global.css              ✅  @tailwind directives (imported in _layout)
│   │   ├── nativewind-env.d.ts     ✅  NativeWind className type augmentation
│   │   ├── tsconfig.json           ✅  Strict TS + path alias for @rushpoint/shared
│   │   ├── package.json            ✅
│   │   ├── .env.example            ✅
│   │   ├── .env                    —   (gitignored — copy from .env.example)
│   │   │
│   │   ├── assets/
│   │   │   ├── icon.png            —   (add before first build)
│   │   │   ├── splash.png          —
│   │   │   ├── adaptive-icon.png   —
│   │   │   └── sounds/
│   │   │       ├── README.md       ✅  Instructions for adding MP3 files
│   │   │       ├── unlock_green.mp3    —   (add from Freesound / Zapsplat)
│   │   │       ├── unlock_orange.mp3   —
│   │   │       ├── unlock_gold.mp3     —
│   │   │       └── final_run.mp3       ⬜  (Phase 3 climax soundtrack)
│   │   │
│   │   ├── app/                        expo-router screens
│   │   │   ├── _layout.tsx         ✅  Root stack, CSS import, gesture/safe-area + <ToastProvider>
│   │   │   ├── index.tsx           ✅  Anonymous auth gate → access-code / dashboard
│   │   │   ├── access-code.tsx     ✅  Enter Access Code; validates against accessCodes
│   │   │   ├── register.tsx        ✅  Team form (name, captain phone, participants, waiver)
│   │   │   │                           → calls the registerTeam Cloud Function
│   │   │   ├── dashboard.tsx       ✅  Active mission + live/frozen elapsed timer
│   │   │   ├── map.tsx             🔲  In-app map with clue overlays (Phase 2)
│   │   │   └── sos.tsx             ⬜  Emergency SOS screen (Phase 3)
│   │   │
│   │   └── src/
│   │       ├── components/
│   │       │   ├── tokens.ts           ✅  GLOW shadow design tokens
│   │       │   ├── Text.tsx            ✅  Tier 1 — typography variants
│   │       │   ├── Button.tsx          ✅  Tier 1 — variants + async loading state
│   │       │   ├── Card.tsx            ✅  Tier 1 — surface + optional glow
│   │       │   ├── Badge.tsx           ✅  Tier 1 — pill badge
│   │       │   ├── Input.tsx           ✅  Tier 1 — labelled input + inline error
│   │       │   ├── Toast.tsx           ✅  Tier 1 — ToastProvider + useToast()
│   │       │   ├── SlotCard.tsx        ✅  Animated slot tile (Reanimated + NativeWind)
│   │       │   ├── ProgressBar.tsx     ✅  Spring-animated 8-pip progress bar
│   │       │   ├── MapView.tsx         🔲  Mapbox/Google map with team pin + clues
│   │       │   └── FlashMissionBanner.tsx  ⬜  Popup for admin-pushed flash missions
│   │       │
│   │       ├── hooks/
│   │       │   ├── useSlotSound.ts     ✅  expo-av unlock sound, battery-safe, silent fallback
│   │       │   ├── useNetworkSync.ts   🔲  Online/offline detection + sync-queue drain
│   │       │   └── useAdaptiveGPS.ts   🔲  Speed-based GPS update frequency (battery opt.)
│   │       │
│   │       ├── services/
│   │       │   ├── firebase.config.ts  ✅  Firebase init + emulator wiring (db/auth/functions/
│   │       │   │                           storage; 127.0.0.1; __DEV__ guard)
│   │       │   ├── firestoreService.ts 🔲  Typed read/write helpers using FIRESTORE_PATHS
│   │       │   └── offlineQueue.ts     🔲  expo-sqlite queue for offline action buffering
│   │       │
│   │       └── store/
│   │           ├── gameStore.ts        ✅  Zustand: 8 slots, unlock rules, score, team info
│   │           └── teamStore.ts        ✅  Zustand: online status, flash missions
│   │
│   │
│   └── admin/                          React + Vite + Tailwind (web dashboard)
│       ├── index.html              ✅
│       ├── vite.config.ts          ✅  Path alias for @rushpoint/shared
│       ├── tailwind.config.js      ✅
│       ├── postcss.config.js       ✅
│       ├── tsconfig.json           ✅
│       ├── package.json            ✅
│       ├── .env.example            ✅
│       ├── .env                    —   (gitignored)
│       │
│       └── src/
│           ├── main.tsx            ✅  React root + QueryClientProvider + BrowserRouter
│           ├── App.tsx             ✅  Top nav + route definitions
│           ├── index.css           ✅  Tailwind base styles (dark theme)
│           │
│           ├── pages/
│           │   ├── JudgePage.tsx       ✅  Full judge flow: pending list → check-in → grade Tene
│           │   │                           → finalize (calls the judge callables)
│           │   ├── CheckInsPage.tsx    ✅  Live pending check-ins (listPendingArrivals)
│           │   ├── TeamsPage.tsx       ✅  Team list table (mock data → real in Phase 2)
│           │   ├── LeaderboardPage.tsx ✅  Rankings + freeze toggle (Phase 3 logic)
│           │   └── HeatmapPage.tsx     🔲  Live GPS map of all teams (Phase 2)
│           │
│           ├── data/
│           │   └── teneProducts.ts     ✅  UI mirror of the Tene scoring catalog (display only)
│           │
│           ├── vite-env.d.ts       ✅  Vite client type augmentation (import.meta.env)
│           │
│           └── services/
│               └── firebase.ts         ✅  Firebase init + emulator wiring + ensureAuth (anonymous)
│
│
├── functions/                          Firebase Cloud Functions (Node 20)
│   ├── package.json            ✅
│   ├── tsconfig.json           ✅
│   ├── .env.example            ✅
│   ├── .env                    —   (gitignored)
│   ├── serviceAccount.json     —   (gitignored — for local emulator only)
│   │
│   └── src/
│       ├── index.ts            ✅  Exports: registerTeam, listPendingArrivals, checkInArrival,
│       │                           finalizeJudgeEvaluation, requestNextTask, checkOutTask,
│       │                           triggerLeaderboardFreeze, pushFlashMission
│       │                           (the old stale submitJudgeScore was removed)
│       ├── firebase.ts         ✅  Admin SDK initialisation
│       ├── routing/
│       │   └── assignNextTask.ts   ✅  Haversine + congestion load-balancing (Phase 2 — do not edit)
│       └── scoring/
│           ├── calculateScore.ts   ✅  Final score formula (Phase 2 — do not edit)
│           └── teneProducts.ts     ✅  Authoritative Tene basket scoring catalog (judge flow)
│
│
└── packages/
    └── shared/                         Published as @rushpoint/shared (npm workspace)
        ├── package.json            ✅
        ├── tsconfig.json           ✅
        └── src/
            ├── index.ts            ✅  Re-exports everything from types/
            └── types/
                └── index.ts        ✅  Canonical interfaces:
                                        FIRESTORE_PATHS, COLLECTIONS,
                                        Team, GameState, Task,
                                        SlotRecord, Assignment, CheckIn,
                                        Leaderboard, LeaderboardEntry,
                                        Event, FlashMission, AdminAlert,
                                        SosEvent, API payload types
│
└── scripts/                            Dev tooling (run from repo root)
    ├── dev-emulator.mjs        ✅  Emulator launcher: Java-21 auto-detect, builds functions,
    │                               data persistence (--import/--export-on-exit)
    ├── free-ports.mjs          ✅  predev:all — kills stale dev ports (Metro/Vite/emulator)
    ├── seed-local.mjs          ✅  Seed-if-empty: tasks, access codes (incl. 1234), test user,
    │                               demo team "The Lions" + pending check-in, leaderboard
    ├── seed-emulator.ts        ✅  Comprehensive seed (npm run seed / seed:reset) — Teams A–D
    ├── package.json            ✅
    └── tsconfig.json           ✅
```

## Root npm scripts (key)

| Script | Purpose |
|---|---|
| `npm run dev:all` | **One command** — boots emulator + seed + mobile (web) + admin via `concurrently` |
| `npm run emulator` | Emulator only (same Java-21-aware launcher) |
| `npm run mobile` / `mobile:web` | Expo native / web (http://localhost:8081) |
| `npm run admin` | Vite dev server on **http://localhost:5180** |
| `npm run seed` / `seed:reset` | Comprehensive multi-team seed (merge / wipe+reseed) |
| `npm run functions:serve` / `functions:deploy` | Functions emulator / deploy |

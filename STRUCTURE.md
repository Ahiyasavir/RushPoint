# RushPoint — Complete Monorepo Directory Map

Legend:  ✅ exists   🔲 planned (Phase 2)   ⬜ planned (Phase 3)

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
│   │   │   ├── _layout.tsx         ✅  Root stack, CSS import, gesture + safe area providers
│   │   │   ├── index.tsx           ✅  Anonymous auth gate → redirects to register or dashboard
│   │   │   ├── register.tsx        ✅  Team name + member name entry
│   │   │   ├── dashboard.tsx       ✅  8-slot task board (main screen)
│   │   │   ├── map.tsx             🔲  In-app map with clue overlays (Phase 2)
│   │   │   └── sos.tsx             ⬜  Emergency SOS screen (Phase 3)
│   │   │
│   │   └── src/
│   │       ├── components/
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
│   │       │   ├── firebase.config.ts  ✅  Firebase app init (reads EXPO_PUBLIC_* vars)
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
│           │   ├── JudgePage.tsx       ✅  Phase 1 — basket score entry form (next to wire up)
│           │   ├── TeamsPage.tsx       ✅  Team list table (mock data → real in Phase 2)
│           │   ├── CheckInsPage.tsx    ✅  Photo approval queue (Phase 2)
│           │   ├── LeaderboardPage.tsx ✅  Rankings + freeze toggle (Phase 3 logic)
│           │   └── HeatmapPage.tsx     🔲  Live GPS map of all teams (Phase 2)
│           │
│           ├── components/
│           │   └── (shared admin UI — buttons, tables, modals)  🔲
│           │
│           └── services/
│               ├── firebase.config.ts  🔲  Admin Firebase init (VITE_* vars)
│               └── firestoreService.ts 🔲  Typed Firestore helpers (same pattern as mobile)
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
│       ├── index.ts            ✅  All function exports (requestNextTask, submitJudgeScore…)
│       ├── firebase.ts         ✅  Admin SDK initialisation
│       ├── routing/
│       │   └── assignNextTask.ts   ✅  Haversine + congestion load-balancing algorithm
│       └── scoring/
│           └── calculateScore.ts   ✅  Final score formula (slots + judge + speed bonus)
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
```

# RushPoint — Complete Monorepo Directory Map

Legend:  ✅ exists   🔲 planned (Phase 2)   ⬜ planned (later / deferred)

> **Updated 2026-05-29 — Phases 1–3 are feature-complete** (verified e2e: 44/44 + tie-breaker unit
> test). Access-code auth with **multi-device join** (custom token), the **6-stage** game flow
> (3 green → gate/matchmaking → find-Tene → craft+judge), smart routing + sigmoid scoring, the
> interactive **Tene-filling menu**, gate matchmaking (winner-only), basket zones, crafting/sprint
> penalties, leaderboard freeze + Z-Score + reveal + **tie-breaker**, flash missions, SOS, clue-hints,
> team cohesion, Final Run, and the **advanced operational suite** (station status + evacuation,
> operational broadcast, geo-throttled location → live heatmap, audit log + Event Manager page,
> task-timeout safety net) all exist. Remaining: Wrapped/summary cards (deferred) + production
> deploy. See STATUS.md for the live tracker.
>
> ⚠️ Known gap: mobile never calls `requestNextTask`, so green slots 1–2 don't receive a `taskId`
> in the real play flow; and the new admin/mobile UI hasn't been driven in a browser yet.

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
│   │   │       └── (mp3s optional — useSlotSound synthesises chimes + fanfare via Web Audio)
│   │   │
│   │   ├── app/                        expo-router screens
│   │   │   ├── _layout.tsx         ✅  Root stack, CSS import, gesture/safe-area + <ToastProvider>
│   │   │   ├── index.tsx           ✅  Anonymous auth gate → access-code / dashboard
│   │   │   ├── access-code.tsx     ✅  Enter Access Code; validates against accessCodes
│   │   │   ├── register.tsx        ✅  Team form (name, captain phone, participants, waiver)
│   │   │   │                           → calls the registerTeam Cloud Function
│   │   │   ├── dashboard.tsx       ✅  6 stages, score, gate/crafting/match, flash + announcement
│   │   │   │                           banners, SOS+hint, "I've arrived" check-in, geo-throttling
│   │   │   ├── map.tsx             ✅  Mapbox static mission map
│   │   │   ├── basket-zone.tsx     ✅  Riddle + interactive Tene-fill menu + 20-min/sprint countdown
│   │   │   ├── sos.tsx             ✅  Emergency SOS screen (two-step confirm + GPS → triggerSOS)
│   │   │   └── final-run.tsx       ✅  Race-complete celebration (animated trophy + synth fanfare)
│   │   │
│   │   └── src/
│   │       ├── components/
│   │       │   ├── tokens.ts           ✅  GLOW / GLASS / GRADIENTS / BG design tokens (dark neon)
│   │       │   ├── Text.tsx            ✅  Tier 1 — typography variants
│   │       │   ├── Button.tsx          ✅  Tier 1 — variants + async loading state
│   │       │   ├── Card.tsx            ✅  Tier 1 — glass surface + optional glow + style override
│   │       │   ├── Badge.tsx           ✅  Tier 1 — pill badge
│   │       │   ├── Input.tsx           ✅  Tier 1 — labelled input + inline error
│   │       │   ├── Toast.tsx           ✅  Tier 1 — ToastProvider + useToast()
│   │       │   ├── LanguageToggle.tsx  ✅  EN/HE toggle pill
│   │       │   ├── SlotCard.tsx        ✅  Animated slot tile (Reanimated + NativeWind)
│   │       │   ├── ProgressBar.tsx     ✅  Spring-animated progress bar
│   │       │   ├── FlashMissionBanner.tsx  ✅  Neon overlay for admin-pushed flash missions
│   │       │   └── AnnouncementBanner.tsx  ✅  Persistent operational marquee (per-device dismiss)
│   │       │
│   │       ├── hooks/
│   │       │   ├── useSlotSound.ts        ✅  Web Audio synth chimes + playFanfare (no mp3 assets)
│   │       │   ├── useGameSync.ts         ✅  onSnapshot gameState → Zustand mirror + unlock chime
│   │       │   ├── useOfflineToast.ts     ✅  Online/offline connectivity toasts
│   │       │   ├── useFlashMissions.ts    ✅  Live flash-mission listener (active + non-expired)
│   │       │   ├── useAnnouncements.ts    ✅  Live operational announcements (active only)
│   │       │   └── useAdaptiveLocation.ts ✅  Geo-throttled location pings → updateLocation
│   │       │
│   │       ├── data/
│   │       │   └── teneProducts.ts     ✅  Display mirror of the Tene catalog (crafting menu)
│   │       │
│   │       ├── services/
│   │       │   └── firebase.config.ts  ✅  Firebase init + emulator wiring; native Auth persistence
│   │       │                               via AsyncStorage; 127.0.0.1; __DEV__ guard
│   │       │
│   │       └── store/
│   │           ├── gameStore.ts        ✅  Zustand: live gameState mirror (slots, score, penalty)
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
│           │   ├── JudgePage.tsx       ✅  Pending list → check-in → grade Tene + team cohesion
│           │   │                           → finalize (sigmoid task score + basket − cohesion)
│           │   ├── CheckInsPage.tsx    ✅  Live pending check-ins + live SOS/emergency alerts
│           │   ├── TeamsPage.tsx       ✅  Live team table (listTeams) + skip-task action
│           │   ├── LeaderboardPage.tsx ✅  Freeze/unfreeze + Z-Score finalize + sequential reveal
│           │   ├── MatchmakingPage.tsx ✅  Gate queue + 1v1 duels (winner-only) + flash broadcast
│           │   ├── HeatmapPage.tsx     ✅  Mapbox station map + legend + LIVE team markers
│           │   └── ManagerPage.tsx     ✅  Event Manager: station status + evacuate, broadcast,
│           │                               audit log + fine/override
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
│       ├── index.ts            ✅  30 callables (registration + joinTeam, routing, judging,
│       │                           gate/match, basket/crafting, Tene selection, leaderboard,
│       │                           flash, SOS, clue-hint, station mgmt + evacuate, announcements,
│       │                           audit log, score-adjust, location) — full list in CLAUDE.md
│       ├── firebase.ts         ✅  Admin SDK initialisation
│       ├── routing/
│       │   └── assignNextTask.ts   ✅  Haversine + congestion load-balancing + skill match (Φ/transit/Ω)
│       └── scoring/
│           ├── taskScore.ts        ✅  Sigmoid per-task time multiplier (100·D·M(x))
│           ├── calculateScore.ts   ✅  Transit/sprint penalties + Z-Score + completion bonus
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
                                        Team, GameState, Task (+status/maxDuration),
                                        SlotRecord, Assignment, CheckIn,
                                        Leaderboard, LeaderboardEntry,
                                        Event, FlashMission, AdminAlert, SosEvent,
                                        Announcement, AuditLogEntry, TeamLocation,
                                        API payload types
│
└── scripts/                            Dev tooling (run from repo root)
    ├── dev-emulator.mjs        ✅  Emulator launcher: Java-21 auto-detect, builds functions,
    │                               data persistence (--import/--export-on-exit)
    ├── free-ports.mjs          ✅  predev:all — kills stale dev ports (Metro/Vite/emulator)
    ├── seed-local.mjs          ✅  Seed-if-empty: tasks, access codes (incl. 1234), test user,
    │                               demo team "The Lions" + pending check-in, leaderboard
    ├── seed-emulator.ts        ✅  Comprehensive seed (npm run seed / seed:reset) — Teams A–D,
    │                               6-slot states, task status/maxDuration, reset clears transient cols
    ├── e2e-verify.mjs          ✅  End-to-end check of the callables vs the emulator (44/44)
    ├── test-tiebreaker.ts      ✅  Unit test for the leaderboard tie-breaker (npx tsx)
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

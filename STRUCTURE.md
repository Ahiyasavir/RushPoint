# RushPoint — Monorepo Directory Map (v2 platform)

> The generic multi-tenant **creator + play** web platform. `apps/mobile` is the **archived v1**
> Expo app (not in the npm workspaces) — ignore it. See [CLAUDE.md](CLAUDE.md) for architecture.

```
rushpoint/
├── apps/
│   ├── creator-web/                 # React + Vite — creator console (dark theme). Vite :5180
│   │   └── src/
│   │       ├── main.tsx             # entry; wraps <App> in ErrorBoundary
│   │       ├── App.tsx              # router + AuthGate
│   │       ├── pages/
│   │       │   ├── DashboardPage.tsx   # game list, new game, launch/publish/delete
│   │       │   ├── BuilderPage.tsx     # 3-step wizard: Details · Stages&Tasks (tile grid + modal) · Preview
│   │       │   ├── GalleryPage.tsx     # public games + task library (list / map toggle)
│   │       │   ├── WalletPage.tsx      # credit balance + Stripe top-up
│   │       │   └── RunConsolePage.tsx  # LIVE: teams, map, standings, broadcast, finalize
│   │       ├── components/
│   │       │   ├── ui.tsx              # kit: Button, Card, Input, Textarea, Select, Label, Badge, Modal-less primitives
│   │       │   ├── AuthGate.tsx        # Firebase Auth gate (email/Google)
│   │       │   ├── LocationPicker.tsx  # MapLibre click-to-drop pin (Builder)
│   │       │   ├── GalleryMap.tsx      # gallery games plotted on a map
│   │       │   ├── LiveTeamMap.tsx     # RunConsole live team positions
│   │       │   ├── MapModeToggle.tsx   # topo ⇄ satellite
│   │       │   ├── TaskLibrary.tsx     # insert a reusable task from the public library
│   │       │   ├── dialog.tsx          # confirm/alert/prompt host
│   │       │   └── ErrorBoundary.tsx
│   │       └── services/
│   │           ├── firebase.ts        # app init + emulator wiring (127.0.0.1)
│   │           ├── api.ts             # callable() factory (+ ensureAuth) — use this
│   │           ├── calls.ts           # typed wrappers for every creator callable
│   │           └── telemetry.ts       # crash-report seam (Sentry slots in)
│   │
│   ├── play-web/                     # React + Vite PWA — participant + staff (light theme). Vite :5181
│   │   └── src/
│   │       ├── main.tsx             # entry; ErrorBoundary + prod service-worker registration
│   │       ├── App.tsx              # auth gate → Join / Play / Staff; ConnectionBanner
│   │       ├── screens/
│   │       │   ├── JoinScreen.tsx      # access code → registration form (+ "I'm staff")
│   │       │   ├── PlayScreen.tsx      # live state, map, task runner, live-ops, SOS, wake-lock
│   │       │   ├── FinalScreen.tsx     # finish + final leaderboard
│   │       │   └── StaffConsole.tsx    # PIN sign-in → photo review, SOS ack, announcements
│   │       ├── components/
│   │       │   ├── ui.tsx              # kit: Button, Card, Input, Progress, Screen
│   │       │   ├── TaskRunner.tsx      # per-type task UI (field/code/photo/…) + hints
│   │       │   ├── NavMap.tsx          # MapLibre nav map (lazy-loaded)
│   │       │   ├── LiveOps.tsx         # announcement + flash banners + leaderboard peek
│   │       │   ├── ConnectionBanner.tsx# offline indicator
│   │       │   ├── MapModeToggle.tsx · dialog.tsx · ErrorBoundary.tsx
│   │       ├── hooks/useWakeLock.ts    # keep screen awake while racing
│   │       ├── services/{firebase.ts, calls.ts}   # offline cache, Storage upload, typed calls
│   │       └── store.ts                # session + staff-session persistence
│   │
│   └── mobile/                       # ⚠️ ARCHIVED v1 Expo app — not in workspaces, not maintained
│
├── functions/
│   └── src/
│       ├── index.ts                 # re-exports all callables + staff/live-ops/station callables
│       ├── firebase.ts              # Admin SDK init (ignoreUndefinedProperties)
│       ├── validation.ts            # shared payload guards
│       ├── games/index.ts           # game CRUD + publish + gallery duplicate
│       ├── runs/index.ts            # run lifecycle, join, routing entry, scoring, hints, leaderboard
│       ├── gallery/index.ts         # public game/task search
│       ├── payments/index.ts        # wallet + Stripe
│       ├── routing/assignNextTask.ts# preset-aware smart routing (internal helpers)
│       └── scoring/                 # taskScore.ts, calculateScore.ts, stationVerification.ts
│
├── packages/shared/src/
│   ├── types/index.ts               # ⭐ canonical types + FIRESTORE_PATHS (single source of truth)
│   ├── scoringPresets.ts            # the 3 scoring presets
│   ├── geo.ts                       # haversine, coord validation, route geo
│   ├── mapStyle.ts                  # resolveMapStyle() — MapTiler + OpenTopoMap fallback
│   └── validation.ts
│
├── scripts/
│   ├── dev-emulator.mjs             # Java-21-aware emulator launcher + persistence
│   ├── free-ports.mjs              # predev port cleanup
│   ├── seed-local.mjs             # seed-if-empty (demo creator + Old City game + run)
│   ├── seed-emulator.ts           # comprehensive seed (npm run seed / seed:reset)
│   ├── e2e-verify.mjs             # ⭐ full-lifecycle e2e vs emulator (npm run e2e)
│   └── test-*.ts                   # unit tests (tiebreaker, geo, projection, idempotency, …)
│
├── firestore.rules · storage.rules · firestore.indexes.json · firebase.json
├── turbo.json · package.json (npm workspaces)
└── CLAUDE.md · INSTRUCTIONS.md · TECH_SPEC.md · STATUS.md · STRUCTURE.md
```

**Quick map — "where do I change X?"**
- A new backend mutation → `functions/src/<domain>/index.ts` + re-export in `functions/src/index.ts` + wrapper in the app's `services/calls.ts`.
- A new type/field → `packages/shared/src/types/index.ts` (then it flows everywhere).
- Creator screens → `apps/creator-web/src/pages`. Participant screens → `apps/play-web/src/screens`.
- Per-task participant UI → `apps/play-web/src/components/TaskRunner.tsx`. Task authoring → `apps/creator-web/src/pages/BuilderPage.tsx` (`TaskEditor`).

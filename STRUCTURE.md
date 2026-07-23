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
│   │       ├── lib/
│   │       │   ├── runConsoleLayout.ts  # console layout as DATA: section rail, pinned panels, columns
│   │       │   ├── teamAttention.ts     # "who is in trouble right now?" — pure, clock injected, never throws
│   │       │   ├── photoReviewQueue.ts  # photo-review triage: wait tiers, legal decisions, focus moves
│   │       │   └── savePayload.ts       # BUILDER_EDITABLE_FIELDS — the save payload IS the dirty check
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
│   │       │   ├── StaffConsole.tsx    # PIN sign-in → photo review, SOS ack, announcements
│   │       │   └── LegalScreen.tsx     # /terms + /privacy on the PARTICIPANT origin (lazy chunk)
│   │       ├── components/
│   │       │   ├── ui.tsx              # kit: Button, Card, Input, Progress, Screen
│   │       │   ├── TaskRunner.tsx      # per-type task UI (field/code/photo/…) + hints
│   │       │   ├── NavMap.tsx          # MapLibre nav map (lazy-loaded)
│   │       │   ├── LiveOps.tsx         # announcement + flash banners + leaderboard peek
│   │       │   ├── ConnectionBanner.tsx# offline indicator
│   │       │   ├── MapModeToggle.tsx · dialog.tsx · ErrorBoundary.tsx
│   │       ├── hooks/useWakeLock.ts    # keep screen awake while racing
│   │       ├── lib/
│   │       │   ├── playRoute.ts        # URL → route union (staff/promo/board/legal); resolveLegalPath
│   │       │   ├── stuckGuards.ts      # fail-OPEN submit gate, retry lockout, GPS watch backoff
│   │       │   ├── holdNotice.ts       # why a team held back by startTeams is still waiting
│   │       │   └── joinCode.ts         # join-code normalize + join-error → message key
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
│       ├── batchUtil.ts             # chunk() / deleteDocsInChunks() — Firestore's 500-op batch cap
│       ├── games/index.ts           # game CRUD + soft delete/trash + publish + export/import + duplicate
│       ├── games/gameArea.ts        # derives a publicGames coarse `approxLocation` from the tasks
│       ├── runs/index.ts            # run lifecycle, join, routing entry, scoring, hints, leaderboard
│       ├── gallery/index.ts         # public game/task search + likes
│       ├── payments/index.ts        # wallet + Stripe
│       ├── users/index.ts           # profile, data export, account deletion
│       ├── maintenance/index.ts     # retention prune, trash purge, publicTasks coordinate backfill
│       ├── obs/                     # log.ts (loggedCallable wrapper) + audit.ts (auditLogs writer)
│       ├── routing/assignNextTask.ts# preset-aware smart routing (internal helpers)
│       └── scoring/                 # taskScore.ts, calculateScore.ts, stationVerification.ts
│
├── packages/shared/src/
│   ├── types/index.ts               # ⭐ canonical types + FIRESTORE_PATHS (single source of truth)
│   ├── scoringPresets.ts            # the 3 scoring presets
│   ├── geo.ts                       # haversine, coord validation, route geo
│   ├── mapStyle.ts                  # resolveMapStyle() — MapTiler + OpenTopoMap fallback
│   ├── publicTaskLocation.ts        # ⭐ what a WORLD-READABLE task may say about where it is (1 km grid snap)
│   ├── safeZone.ts                  # isOutsideSafeZone + evaluateSafeZoneStatus (total, fail-open)
│   ├── pausedClock.ts               # Task.pausesTimer → RunTaskRecord.excludedMs (server-stamped)
│   ├── liveTaskStatus.ts            # per-RUN task pause/close: effectiveTaskStatus, planTaskStatusChange
│   ├── mutualExclusion.ts           # exclusive groups + maxCompletableTasks (the stage ceiling)
│   ├── taskDuration.ts              # per-type default expectedDurationMinutes (authoring time only)
│   ├── legalContent.ts · legalMarkdown.ts  # ToS/Privacy text + parser, shared by BOTH apps —
│   │                                # NOT in the barrel; deep-import from a lazy chunk only
│   ├── chat.ts                      # team↔HQ chat sanitize/append helpers
│   ├── tags.ts                      # normalizeTags — the one definition of a tag list (client + server)
│   ├── wrongAnswerPenalty.ts        # wrong-answer cost + retry lockout (server decides, ships a DURATION)
│   ├── gameFile.ts                  # game export/import file format + import hardening
│   └── validation.ts
│
├── scripts/
│   ├── dev-emulator.mjs             # Java-21-aware emulator launcher + persistence
│   ├── free-ports.mjs              # predev port cleanup
│   ├── seed-local.mjs             # seed-if-empty (demo creator + Old City game + run)
│   ├── seed-emulator.ts           # comprehensive seed (npm run seed / seed:reset)
│   ├── e2e-verify.mjs             # ⭐ full-lifecycle e2e vs emulator (npm run e2e)
│   ├── check-i18n.ts              # HE/EN dictionary + hardcoded-string gate (npm run i18n:check[:strict])
│   ├── check-bundle-budget.mjs    # play-web first-load budget + "heavy dep stays lazy" (npm run bundle:budget)
│   ├── backfill-public-tasks.mjs  # operator sweep for legacy publicTasks coordinates (DEPLOY.md §11)
│   ├── test-rules.mjs · test-storage-rules.mjs   # emulator-bound Firestore / Storage rules suites
│   ├── lib/emulatorReap.mjs · lib/reapEmulatorExec.mjs  # reap orphaned emulators:exec processes (fails closed)
│   ├── lib/{bundleBudget,publicTaskBackfill,callableHardening}.mjs  # pure logic behind the above
│   ├── lib/playA11yScan.ts        # pure a11y source scan of play-web .tsx (RTL classes, icon buttons)
│   ├── lib/i18nLeak.ts            # ⭐ the ONE HE/EN leak predicate — imported by check-i18n.ts AND
│   │                              #   test-i18n-parity.ts; never re-implement it in a checker
│   └── test-*.ts                   # unit tests — AUTO-DISCOVERED by run-unit-tests.mjs, so a new
│                                   #   scripts/test-*.ts is in `npm test` with no registration
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

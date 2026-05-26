# RushPoint — START HERE
> TECH_SPEC.md is the full reference. This file was the original tracer-bullet briefing.
> For the **current** state, dev workflow, and data model, read **CLAUDE.md** first.

---

## ✅ STATUS — Tracer Bullet is BUILT and running on the emulator

The 6-step flow below is implemented and was verified end-to-end against the Firebase Emulator
(anonymous token → callables return live data). Two intentional divergences from the original plan:

- **Auth is an Access-Code system** (not generic registration). Enter a code → `registerTeam`
  Cloud Function claims it and seeds the team. Local demo code: **`1234`**.
- **Writes go through Cloud Functions** (registration + judging), since `gameState`/score are
  server-only. The judge step uses `listPendingArrivals` / `checkInArrival` / `finalizeJudgeEvaluation`.

**Boot it:** `npm run dev:all` → Mobile http://localhost:8081 · Admin **http://localhost:5180** ·
Emulator UI http://127.0.0.1:4000. (Details + caveats in CLAUDE.md.)

---

## 1. Tomorrow's Goal

Build one complete vertical slice — Login → Load ONE task → Mark as Done → Open Admin Panel → Judge scores it → Score reflects live on mobile — working end-to-end against the local Firebase emulator. Nothing else.

---

## 2. The Exact 6-Step Tracer Bullet Flow

Build in this order. Stop and fix before moving to the next step.

```
[Mobile] 1. Login
              Anonymous Firebase Auth → emulator
              ↓
[Mobile] 2. Register
              Enter team name + members → write profile doc to Firestore
              artifacts/race-to-tzion-2026/users/{uid}/profile/team
              ↓
[Mobile] 3. Dashboard
              onSnapshot listener on gameState/current
              Slot 0 renders as "active" from seeded Team A data
              ↓
[Mobile] 4. Mark as Done
              Tap slot 0 → Cloud Function writes gameState
              Slot 0 → completed | Slot 1 → active
              ↓
[Admin]  5. Judge Panel (browser)
              Reads Team C pending check-in → judge enters 0–100 score → submits
              Firestore: checkIn status → 'approved', judgeScore written
              ↓
[Mobile] 6. Live Score Update
              Team C score updates on dashboard within 3 seconds via onSnapshot
              No manual refresh. No full reload.
```

**Before writing any screen:** build only the Tier 1 atomic components the flow above requires:
`Text` · `Button` · `Card` · `Badge` · `Input` · `Toast`

---

## 3. Strict DO NOT BUILD List

If it is not on the 6-step critical path above, it does not get built tomorrow.

| Do NOT build | Reason |
|---|---|
| Full 8-slot animated dashboard | Tracer bullet only needs slot 0 and slot 1 |
| Slot unlock animations (Reanimated) | Phase 3 |
| Load-balancing routing algorithm | Phase 2 |
| Map screen | Phase 2 |
| Leaderboard screen | Phase 3 |
| Offline SQLite write queue | Phase 2 — use Firestore SDK persistence |
| SOS button | Phase 3 |
| Flash missions | Phase 3 |
| Wrapped / social sharing | Phase 3 |
| Any UI component not required by steps 1–6 | Deferred — no speculative building |

**The rule:** If you are about to build something and cannot point to the exact step number above that requires it, stop.

---

## 4. Monorepo — What Exists Now vs What We Build Tomorrow

```
rushpoint/
│
├── TECH_SPEC.md          ✅ Full architecture reference — read this
├── START_HERE.md         ✅ This file
├── INSTRUCTIONS.md       ✅ Developer persona & coding rules
├── STRUCTURE.md          ✅ Full expected directory map
│
├── apps/
│   ├── mobile/
│   │   ├── [config]      ✅ babel, metro, tailwind, global.css, app.json
│   │   ├── app/
│   │   │   ├── _layout.tsx     ✅ exists (needs Firestore persistence init)
│   │   │   ├── index.tsx       ✅ exists (auth gate — wire to emulator)
│   │   │   ├── register.tsx    ✅ exists (wire Firestore write)        🔨 tomorrow
│   │   │   └── dashboard.tsx   ✅ exists (replace mock state w/ onSnapshot) 🔨 tomorrow
│   │   └── src/
│   │       ├── components/
│   │       │   ├── SlotCard.tsx    ✅ exists
│   │       │   ├── ProgressBar.tsx ✅ exists
│   │       │   ├── Text.tsx        ⬜ build tomorrow (Tier 1)
│   │       │   ├── Button.tsx      ⬜ build tomorrow (Tier 1)
│   │       │   ├── Card.tsx        ⬜ build tomorrow (Tier 1)
│   │       │   ├── Badge.tsx       ⬜ build tomorrow (Tier 1)
│   │       │   ├── Input.tsx       ⬜ build tomorrow (Tier 1)
│   │       │   └── Toast.tsx       ⬜ build tomorrow (Tier 1)
│   │       ├── services/
│   │       │   └── firebase.config.ts  ✅ exists
│   │       └── store/
│   │           └── gameStore.ts        ✅ exists (keep for offline cache)
│   │
│   └── admin/
│       └── src/pages/
│           └── JudgePage.tsx   ✅ exists (wire Firestore read/write)  🔨 tomorrow
│
├── functions/
│   └── src/
│       ├── index.ts            ✅ exists (wire completeSlot + submitJudgeScore)  🔨 tomorrow
│       ├── routing/assignNextTask.ts   ✅ exists (DO NOT touch — Phase 2)
│       └── scoring/calculateScore.ts  ✅ exists (DO NOT touch — Phase 2)
│
├── packages/shared/
│   └── src/types/index.ts      ✅ locked — do not modify
│
└── scripts/
    └── seed-emulator.ts        ✅ run this first:  npm run seed:reset
```

---

**Start command sequence (current — one terminal):**
```bash
npm run dev:all         # emulator + seed (if empty) + mobile (web) + admin
# optional, for the full multi-team dataset (Teams A–D, judge scenarios):
npm run seed:reset
```
Admin → http://localhost:5180 · Mobile → http://localhost:8081 · Emulator UI → http://127.0.0.1:4000.
Stop with **Ctrl+C** so emulator data is exported. (The legacy 4-terminal flow still works if preferred.)

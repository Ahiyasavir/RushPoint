# RushPoint — Master Technical Specification
> Upload this file at the start of every coding session to restore full project context.
> Last updated: 2026-05-24 | Phase: 1 (MVP) — UI coding starts next session.

---

## 1. Project Overview

**RushPoint** powers "Race to Tzion" (המירוץ לציון) — a gamified outdoor team-race event in Jerusalem. Teams navigate physical locations, solve riddles, and fill a wicker basket (Tene). A real-time load-balancing algorithm prevents station bottlenecks. A judge panel scores the physical basket at the finish line.

**Core mechanic:** An 8-slot task board drives the full game flow:
| Slots | Type | Color | Unlocks when |
|-------|------|-------|--------------|
| 0–3 | Open-field missions | 🟢 Green | Immediate (slot 0 active on start) |
| 4 | Find the Tene basket | 🟠 Orange | All 4 green slots completed |
| 5–7 | Basket-filling crafts | 🥇 Gold | Orange slot completed |
| — | Final Run reveal | — | All 8 slots completed → music + location |

---

## 2. Tech Stack (locked — do not deviate)

| Layer | Technology | Version |
|-------|-----------|---------|
| Mobile app | Expo (React Native) | SDK ~52 |
| Mobile styling | NativeWind v4 + Tailwind CSS 3 | ^4.0.1 |
| Mobile animations | react-native-reanimated | ~3.16 |
| Mobile audio | expo-av | ~15 |
| Mobile state | Zustand | ^5 |
| Admin dashboard | React + Vite + Tailwind CSS | React 18, Vite 5 |
| Backend | Firebase Cloud Functions | Node 20 |
| Database | Firebase Firestore | ^10.12 |
| Auth | Firebase Auth (anonymous → custom token) | ^10.12 |
| Storage | Firebase Storage | ^10.12 |
| Maps | Mapbox GL (Phase 2) | ^3.5 |
| Monorepo | npm workspaces + Turborepo | Turbo ^2 |
| Language | TypeScript (strict) everywhere | ~5.4 |

---

## 3. Monorepo Structure

```
rushpoint/
├── apps/
│   ├── mobile/          # Expo RN — team-facing app
│   └── admin/           # React/Vite — judge & admin web dashboard
├── functions/           # Firebase Cloud Functions
├── packages/
│   └── shared/          # @rushpoint/shared — canonical types + path helpers
└── scripts/             # Seed script (tsx seed-emulator.ts)
```

**Key root files:**
- `turbo.json` — build/typecheck/lint/seed pipeline
- `firebase.json` — emulator config (`singleProjectMode: true`, ports below)
- `.firebaserc` — project aliases (committed, no secrets)
- `.eslintrc.js` — root ESLint (extended by each app)
- `.prettierrc` — unified formatter (singleQuote, trailingComma: all, printWidth: 100)

---

## 4. Firestore Path Convention ⚠️ CRITICAL — NEVER DEVIATE

```
PUBLIC shared data   →  artifacts/{appId}/public/data/{collection}/{docId}
PRIVATE user data    →  artifacts/{appId}/users/{userId}/{collection}/{docId}
```

**`appId`** = env var `RUSHPOINT_APP_ID` (default: `"race-to-tzion-2026"`)  
Must match across mobile (`.env` `EXPO_PUBLIC_RUSHPOINT_APP_ID`), admin (`VITE_RUSHPOINT_APP_ID`), and functions (`RUSHPOINT_APP_ID`).

**Path builder helpers** (from `@rushpoint/shared`):
```ts
import { FIRESTORE_PATHS } from '@rushpoint/shared';

FIRESTORE_PATHS.public('race-to-tzion-2026', 'tasks')
// → "artifacts/race-to-tzion-2026/public/data/tasks"

FIRESTORE_PATHS.private('race-to-tzion-2026', userId, 'gameState')
// → "artifacts/race-to-tzion-2026/users/{userId}/gameState"
```

**Collection name constants** (`COLLECTIONS` from `@rushpoint/shared`):
```ts
// Public
COLLECTIONS.TASKS          // 'tasks'
COLLECTIONS.EVENTS         // 'events'
COLLECTIONS.LEADERBOARD    // 'leaderboard'
COLLECTIONS.FLASH_MISSIONS // 'flashMissions'
COLLECTIONS.ADMIN_ALERTS   // 'adminAlerts'

// Private (per-user)
COLLECTIONS.PROFILE        // 'profile'
COLLECTIONS.GAME_STATE     // 'gameState'
COLLECTIONS.CHECK_INS      // 'checkIns'
COLLECTIONS.ASSIGNMENTS    // 'assignments'
```

**Firestore query rule:** No compound queries with multiple `where` + `orderBy`. Filter/sort in memory. Avoids custom index maintenance.

---

## 5. Canonical Data Types (`@rushpoint/shared`)

### Team — `artifacts/{appId}/users/{userId}/profile/team`
```ts
interface Team {
  id: string;            // = Firebase Auth UID
  name: string;          // "The Lions"
  code: string;          // "LION1" — judge lookup code
  memberNames: string[]; // 2–8 members
  status: 'registered' | 'active' | 'park' | 'finished';
  createdAt: string;     // ISO 8601
  startedAt?: string;
  finishedAt?: string;
}
```

### GameState — `artifacts/{appId}/users/{userId}/gameState/current`
```ts
interface GameState {
  teamId: string;
  slots: SlotRecord[];   // ALWAYS exactly 8
  score: number;
  bonusPenalty: number;  // clue-hint deductions
  currentTaskId?: string;
  updatedAt: string;
}

interface SlotRecord {
  index: number;         // 0–7
  type: 'green' | 'orange' | 'gold';
  status: 'locked' | 'active' | 'completed';
  taskId?: string;
  taskTitle?: string;    // denormalised for display
  completedAt?: string;
}
```
> ⚠️ `gameState` is **read-only on the client**. Only Cloud Functions write it.
> Firestore rules block all client writes to this collection.

### Task — `artifacts/{appId}/public/data/tasks/{taskId}`
```ts
interface Task {
  id: string;
  title: string;
  titleHe?: string;
  description: string;
  type: 'green' | 'orange' | 'gold';
  coordinates?: { lat: number; lng: number };
  locationHint?: string;
  qrCode: string;
  maxConcurrentTeams: number;   // default 3
  currentTeamCount: number;     // ⚠️ counter, NOT array (avoids 1MB Firestore limit)
  photoRequired: boolean;
  pointValue: number;
  estimatedMinutes: number;
  isActive: boolean;
}
```

### CheckIn — `artifacts/{appId}/users/{userId}/checkIns/{checkInId}`
```ts
interface CheckIn {
  id: string;
  teamId: string;
  taskId: string;
  timestamp: string;
  photoUrl?: string;
  status: 'pending' | 'approved' | 'rejected';
  location?: { lat: number; lng: number };
  judgeId?: string;
  judgeNote?: string;
  judgeScore?: number;  // 0–100, gold tasks only
}
```

---

## 6. Firestore Security Rules (summary)

Full rules in `firestore.rules`. Key decisions:

| Path | Read | Write |
|------|------|-------|
| `…/public/data/**` | Any authenticated user | Admin custom claim only |
| `…/users/{userId}/**` | Owner OR admin | Owner (restricted) OR admin |
| `…/users/{userId}/gameState/**` | Owner OR admin | **Admin only** (blocks score manipulation) |
| `…/users/{userId}/profile` | Owner OR admin | Owner on `create` only (shape-validated) |

**Admin identity:** Firebase Auth custom claim `{ role: "admin" }`.  
Set via Admin SDK: `admin.auth().setCustomUserClaims(uid, { role: 'admin' })`  
Never stored in a Firestore document — zero reads-per-request overhead.

---

## 7. Scoring Formula (Cloud Functions)

```
finalScore = slotPoints + completionBonus + speedBonus + basketBonus - bonusPenalty

slotPoints      = completed slots × pointValue (green=100, orange=150, gold=200)
completionBonus = 500  (all 8 slots filled)
speedBonus      = max(0, 1000 × (1 - durationMinutes / 120))  ← decays to 0 after 2 hrs
basketBonus     = judgeScore × 3  (0–300 pts, from judge's 0–100 rating)
bonusPenalty    = accumulated clue-hint deductions (50 pts each, Phase 3)
```

---

## 8. Load-Balancing Routing Algorithm (Cloud Functions)

File: `functions/src/routing/assignNextTask.ts`

When a team completes a task and requests the next one:
1. Query all tasks of the required type that are not completed by this team.
2. Filter out tasks where `currentTeamCount >= maxConcurrentTeams`.
3. Score each candidate: `distanceKm × 1.0 + currentTeamCount × 15.0 + estimatedMinutes / 10`
4. Assign the lowest-scoring task (closest + least crowded + fastest).
5. If targeting `gold` (park) and **zero** candidates remain → return `{ injectRiddle: true }` to delay park entry.
6. Atomically increment `currentTeamCount` on the chosen task.

---

## 9. Mobile App — Key Patterns

### NativeWind usage
- All styles via `className` prop. **No inline `StyleSheet.create`** except for native shadow/glow (Tailwind can't do `shadowColor` on RN).
- Dynamic classes: use fully-spelled-out class maps (static strings), never build class strings via concatenation. NativeWind's babel transform can't pick up dynamic strings.

```ts
// ✅ Correct
const classes = { active: 'bg-emerald-950 border-emerald-500', locked: 'bg-zinc-900' };
<View className={classes[status]} />

// ❌ Wrong — NativeWind won't pick this up at build time
<View className={`bg-${color}-950`} />
```

### Slot unlock animation pattern (Reanimated)
```ts
// Entry: scale 0.94→1, opacity 0.45→1 when status becomes 'active'
// Pulse: withRepeat(withSequence(1→0.35→1), -1) on border while active
// Sound: useSlotSound().playUnlock(type) before completing the slot
// Haptic: Haptics.impactAsync(ImpactFeedbackStyle.Medium)
```

### Zustand game store
File: `apps/mobile/src/store/gameStore.ts`  
- `completeSlot(index, taskTitle)` → marks slot completed + triggers unlock rules
- Unlock rules: green[n] → green[n+1]; green[3] → orange; orange → all 3 gold simultaneously
- `gameStore` is **local UI state only** in Phase 1. Phase 2 syncs it from Firestore `gameState`.

### Offline safety rules
- All Firebase calls wrapped in `try/catch` — never let network errors crash the UI.
- `no-floating-promises: error` in ESLint — every `async` call must be `await`ed or `.catch()`ed.
- `no-alert: error` — use proper error UI components, never `alert()`.

---

## 10. Firebase Emulator Ports

| Service | Port | URL |
|---------|------|-----|
| Emulator UI | 4000 | http://localhost:4000 |
| Auth | 9099 | — |
| Firestore | 8080 | — |
| Functions | 5001 | — |
| Storage | 9199 | — |
| Admin hosting | 5002 | http://localhost:5002 |

---

## 11. Development Commands

```bash
# Install all workspaces
npm install

# Start Firebase emulators (always run first during dev)
npm run emulator

# Seed mock data into emulator (in a second terminal)
npm run seed          # merge / non-destructive
npm run seed:reset    # wipe + re-seed

# Start apps
npm run mobile        # Expo dev server
npm run admin         # Vite admin dashboard (http://localhost:5173)

# Code quality
npm run typecheck     # all packages via Turbo
npm run lint          # all packages via Turbo
npm run format        # Prettier write
npm run format:check  # Prettier CI check
```

---

## 12. Environment Variables (one-line summary per app)

**`apps/mobile/.env`** — `EXPO_PUBLIC_FIREBASE_*` (6 keys) + `EXPO_PUBLIC_RUSHPOINT_APP_ID` + `EXPO_PUBLIC_MAPBOX_TOKEN`  
**`apps/admin/.env`** — `VITE_FIREBASE_*` (6 keys) + `VITE_RUSHPOINT_APP_ID` + `VITE_MAPBOX_TOKEN`  
**`functions/.env`** — `RUSHPOINT_APP_ID` + `QR_SECRET` (server-side only — never in client bundles)

Copy from `*.env.example` files in each directory.

---

## 13. Phase Roadmap

| Phase | Status | Scope |
|-------|--------|-------|
| **Phase 1 — MVP** | 🔨 In progress | Auth gate, 8-slot dashboard UI, local state, judge scoring panel, mock map |
| **Phase 2 — Backend** | ⬜ Planned | Firestore sync, routing algorithm live, offline queue, admin heatmap, audio |
| **Phase 3 — Gamification** | ⬜ Planned | Leaderboard freeze, SOS, flash missions, Wrapped cards, social sharing |

### Phase 1 remaining tasks
- [ ] Atomic UI component kit (Button, Card, Typography, Badge, Input, Toast)
- [ ] Wire `DashboardScreen` to Firestore `gameState` (read-only listener)
- [ ] Judge scoring panel (`apps/admin` — `JudgePage.tsx` → real Firestore write)
- [ ] Basic map screen with mock coordinates (`app/map.tsx`)
- [ ] Firebase Auth anonymous sign-in tested end-to-end against emulator

---

## 14. Strict Rules — Quick Reference

1. **Firestore paths**: Always use `FIRESTORE_PATHS` helpers. Never hardcode path strings.
2. **No compound queries**: Use `where` alone or filter in memory.
3. **No client writes to `gameState`**: Score lives on the server.
4. **No `alert()`**: Use proper UI error components.
5. **No inline styles** in RN (except native shadows): Use NativeWind `className`.
6. **No floating promises**: Every async call awaited or `.catch()`ed.
7. **No dynamic NativeWind class strings**: All class strings must be statically analyzable.
8. **Admin = custom claim**: Never check admin role by reading a Firestore document.
9. **`currentTeamCount` is a number**: Never use an array of team IDs on a Task document.
10. **Offline first**: All Firestore reads use `.get()` with cache fallback; writes queue locally.

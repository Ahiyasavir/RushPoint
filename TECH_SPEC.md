# RushPoint — Master Technical Specification
> Upload this file at the start of every coding session to restore full project context.
> Last updated: 2026-05-29 | **Phases 1–3 feature-complete** on the emulator (e2e 44/44 + tie-breaker unit test).
> This file is the architecture reference; for the live build status read **STATUS.md**.
> Note: sections below describe the original plan — some figures evolved during build (e.g. scoring
> moved to the sigmoid/Z-Score model in §"Scoring", routing to the Φ/transit/Ω model). Code wins.

---

## 1. Project Overview

**RushPoint** powers "Race to Tzion" (המירוץ לציון) — a gamified outdoor team-race event in Jerusalem. Teams navigate physical locations, solve riddles, and fill a wicker basket (Tene). A real-time load-balancing algorithm prevents station bottlenecks. A judge panel scores the physical basket at the finish line.

**Core mechanic:** A 6-stage task board drives the full game flow:
| Slot | Type | Color | Unlocks when |
|------|------|-------|--------------|
| 0–2 | Open-field missions (judge-advanced) | 🟢 Green | Immediate (slot 0 active on start) |
| 3 | Matchmaking duel (זיווג) | 🔵 Gate | All 3 green slots completed — **only the winner advances**; the loser re-queues |
| 4 | Find the Tene basket + scan QR | 🟠 Orange | Gate won |
| 5 | Fill the Tene (20-min menu) + 90-s sprint + judging | 🥇 Gold | Tene QR scanned |
| — | Final Run reveal | — | All 6 stages completed → music + location |

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
  index: number;         // 0–5 (0-2 green, 3 gate, 4 orange, 5 gold)
  type: 'green' | 'gate' | 'orange' | 'gold';
  status: 'locked' | 'active' | 'completed' | 'skipped';
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
completionBonus = 500  (all 6 stages terminal)
speedBonus      = max(0, 1000 × (1 - durationMinutes / 120))  ← decays to 0 after 2 hrs
basketBonus     = judgeScore × 3  (0–300 pts, from judge's 0–100 rating)
bonusPenalty    = clue-hints (50 ea) + cohesion (100/missing member) + transit/sprint + fines
tie-breaker     = on equal finalScore: penalties ↑, then combined green-task time ↑, then transit ↑
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
| **Phase 1 — MVP** | ✅ Done | Auth gate, 6-stage dashboard, judge scoring, atomic UI kit |
| **Phase 2 — Core Math & Backend** | ✅ Done | Sigmoid scoring, Φ/transit/Ω routing, live Firestore sync, offline, heatmap, audio, EN/HE |
| **Phase 3 — Gamification** | ✅ Done | Gate matchmaking, basket zones, crafting/sprint penalties, leaderboard freeze + Z-Score + reveal, flash missions, SOS, clue-hints, team cohesion, Final Run |
| **6-Stage Flow Rework** | ✅ Done | 8→6 stages, multi-device join (custom token), AsyncStorage auth persistence, interactive Tene-fill menu, winner-only matchmaking |
| **Phase 3 — Advanced Operational** | ✅ Done | Station status + evacuation, operational broadcast, geo-throttled location → live heatmap, audit log + Event Manager page, task-timeout safety net, score tie-breaker |
| **Remaining** | ⬜ | Wrapped/summary cards (deferred) + **production deploy** + fix green-slot `requestNextTask` assignment + browser UI pass |

### Next steps (production readiness — see STATUS.md → "הכנה לפרישה")
- [ ] Firebase production project: `deploy` functions + firestore:rules + storage + indexes
- [ ] Admin auth via custom claim `{ role: 'admin' }` (replace emulator-relaxed anonymous gate)
- [ ] Real event content: station coordinates, bilingual task copy, basket zones, access codes
- [ ] Mobile EAS build (iOS + Android) + app icons/splash; device testing
- [ ] Load + offline e2e with 10+ concurrent teams

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

---

## 15. Source of Truth

**Firestore is the ultimate transactional source of truth for all game data.**

**Zustand is a local client-side cache designed for rapid UI updates and offline read/write persistence.** It caches local mutations during offline states and syncs them once connection recovers. It is not a replica — it is a working buffer.

Operational rules that follow from this:
- **Scores are server-only.** Never compute or trust a score derived locally. Scores are written exclusively by Cloud Functions.
- **Slot status comes from Firestore.** Never derive slot unlock state from local logic alone in production. The authoritative record is `gameState/current`.
- **Reconnect always wins.** On network recovery, re-fetch `gameState/current` from Firestore and overwrite Zustand state. Local mutations that were queued are replayed, not merged blindly.
- **Phase 1 exception.** In Phase 1 (emulator dev), Zustand is pre-seeded locally for speed. In Phase 2 it is replaced by a live `onSnapshot` listener — the store becomes a mirror, not the source.

```
[Offline]  User action ──▶ Zustand (local mutation queued) ──▶ UI updates instantly
                                    │
                          [connection restored]
                                    ↓
           Zustand queue ──▶ Firestore write ──▶ Cloud Function ──▶ gameState updated
                                                                          │
                                    ←──── onSnapshot re-syncs Zustand ───┘
```

---

## 16. Out of Scope — Phase 1 MVP

These are explicitly deferred. Do not build them during Phase 1, even if they seem easy.

| Feature | Deferred to | Reason |
|---------|-------------|--------|
| Slot unlock animations (Reanimated pulse, particles) | Phase 3 | Needs field testing on low-end Android devices first |
| Load-balancing routing algorithm | Phase 2 | Requires real concurrent team data to tune weights |
| Congestion detection / injected riddles | Phase 2 | Depends on routing algorithm |
| Leaderboard freeze mechanism | Phase 3 | No leaderboard competition yet in MVP |
| Clue-hint penalty system | Phase 3 | Game balance not finalised |
| Social media sharing / Wrapped cards | Phase 3 | Post-MVP engagement feature |
| SOS emergency button | Phase 3 | Requires safety manager integration |
| Flash missions | Phase 3 | Requires admin broadcast infrastructure |
| Adaptive GPS tracking | Phase 2 | Battery optimisation pass after core flow works |
| Offline write queue (SQLite buffer) | Phase 2 | Phase 1 assumes emulator connectivity |
| 3D Tene inventory UI | Phase 3 | Cosmetic — doesn't affect game logic |

**Phase 1 MVP definition of done:**
- [ ] Anonymous Firebase Auth sign-in works against emulator
- [ ] Team can register (name + members) and land on the dashboard
- [ ] Dashboard reads `gameState` from Firestore and renders the 6 stages correctly
- [ ] Tapping a slot (dev shortcut) completes it and the next slot activates
- [ ] Admin opens Judge Panel, finds Team C's pending check-in, submits a score
- [ ] Score is written to Firestore and reflected on the team's dashboard

---

## 17. Tomorrow's Build Plan — Tracer Bullet (Demo Flow)

### ⚠️ Definition of Success — Non-Negotiable

**Tomorrow has ONE goal and ONE goal only:**

> `Login → Load ONE task → Mark as Done → Open Admin Panel → Judge Scores it → Score reflects live on Mobile.`

This demo flow must work end-to-end against the local Firebase emulator before any other work is considered. Nothing else counts as progress until this chain completes without errors.

**Strict scope boundary:**
> **No new screens or components are to be built unless they are explicitly required to achieve this specific demo flow.**

If a UI element, hook, service, or screen is not on the critical path of the six steps above, it is deferred. No exceptions.

---

### Order of work

**Step 1 — Atomic UI Kit** (Tier 1, build in parallel)
Build these first — they are building blocks the tracer bullet screens depend on:
`Text`, `Button`, `Card`, `Badge`, `Input`, `Toast`, `Skeleton`, `SectionHeader`, `EmptyState`, `FullScreenLoader`.

Only build the component if a tracer bullet screen needs it. Do not build speculatively.

**Step 2 — Tracer Bullet** (build in this exact order — stop and fix if any step breaks before continuing)

```
[Mobile] Login screen
    ↓  Anonymous Firebase Auth → emulator
[Mobile] Register screen
    ↓  Write team profile to Firestore private path
[Mobile] Dashboard screen
    ↓  onSnapshot listener on gameState/current
    ↓  Renders slot 0 as "active" (from Team A seed data)
[Mobile] User taps slot 0 (DEV shortcut → calls Cloud Function stub)
    ↓  Cloud Function writes gameState: slot 0 completed, slot 1 active
[Mobile] Dashboard re-renders via onSnapshot — slot 1 activates
    ↓
[Admin]  Judge Panel opens in browser
    ↓  Reads Team C's pending check-in from Firestore
    ↓  Judge enters score (0–100) and submits
[Admin]  Firestore write: checkIn status → 'approved', judgeScore set
    ↓  Cloud Function triggered → updates team score
[Mobile] Team C's score updates in real time on dashboard
```

**Step 3 — Validate with seed data**
Run `npm run seed:reset` and walk through the demo flow using the 4 pre-seeded teams. All 4 UI states (fresh / mid-race / pending judge / finished) must render correctly before Phase 1 is declared done.

---

## 18. Tracer Bullet — Required Failure Mode Handling

The tracer bullet is not complete until these three edge cases are handled. They are not optional polish — they are **part of the definition of done for tomorrow**.

---

### Failure Mode 1 — Network Drop During "Mark as Done"

**Scenario:** The user taps "Mark as Done" for a task while the device has no internet connection (or drops mid-request).

**Required behaviour:**
- The UI must **not freeze, hang, or show a blank error screen.**
- The action is immediately applied to the local Zustand store (optimistic update) — the slot visually completes.
- The Firestore write is queued in the local offline cache (Firestore SDK offline persistence handles this automatically when enabled).
- A non-blocking `Toast` notification appears: *"You're offline. Progress saved locally and will sync when connection returns."*
- When connectivity is restored, Firestore SDK drains the queue silently. The `onSnapshot` listener confirms the write and the UI remains consistent.

**Implementation note:** Enable Firestore offline persistence via `enableIndexedDbPersistence(db)` (web) or it is on by default in the mobile SDK. Do not implement a manual queue in Phase 1 — rely on the SDK.

**What must NOT happen:** A loading spinner that never resolves. A crash. A silent data loss. Disabling the button permanently.

---

### Failure Mode 2 — Invalid Judge Score Input

**Scenario:** A judge enters a score outside the valid range (e.g. `-5`, `150`, `"abc"`, or an empty field) in the Admin Panel and clicks Submit.

**Required behaviour:**
- The submit button must be **disabled** until the input passes client-side validation.
- Validation rules (enforced before any Firestore write):
  - Input must be a whole number (integer).
  - Value must be between `0` and `100` inclusive.
  - Field must not be empty.
- If the user bypasses the disabled button (e.g. direct API call), the Cloud Function must also reject the input server-side and return a `400`-equivalent `HttpsError`.
- The UI displays an inline error message under the input field — not an `alert()`, not a console log.

**Implementation note:** Use a controlled `Input` component with an `error` prop. The `Button` component receives `disabled={!isValid}`. Server-side: validate in `submitJudgeScore` Cloud Function before writing.

**What must NOT happen:** A score of `150` written to Firestore. A raw `alert()`. A silent failure.

---

### Failure Mode 3 — Double Submission ("Mark as Done" tapped twice)

**Scenario:** A user taps "Mark as Done" quickly twice (network lag, excitement, accidental double-tap).

**Required behaviour:**
- The **first tap** triggers the action and immediately sets the slot status to `'completed'` in Zustand.
- The **second tap is ignored** — because the slot is no longer `'active'`, the `onPress` handler is a no-op.
- The `SlotCard` component's `onPress` must be guarded: `if (slot.status !== 'active') return;`
- The Cloud Function must also be idempotent: if `gameState/current` already shows the slot as `'completed'`, the function returns success without re-writing.
- No duplicate `checkIn` documents are created.

**Implementation note:** The state guard in `SlotCard.tsx` already exists (`disabled={status === 'locked'}`). Extend it to also disable when `status === 'completed'`. Add an idempotency check at the top of the Cloud Function handler.

**What must NOT happen:** Two `checkIn` documents for the same task. A score counted twice. A Firestore write race condition that corrupts `gameState`.

---

## 19. Tactical Annex — Locked Specifications for Phase 1

> This annex is the zero-ambiguity reference for tomorrow's build.
> No token, name, or prop shape below is a suggestion — they are decisions.

---

### 19.1 UI Design Tokens

All values are NativeWind/Tailwind class names unless marked `[native]` (native shadow — cannot be expressed in Tailwind on React Native).

#### Colours

| Role | Tailwind class | Hex | Used on |
|------|---------------|-----|---------|
| App background | `bg-zinc-950` | `#09090b` | All screen roots |
| Surface (cards) | `bg-zinc-900` | `#18181b` | Card, Input, Sheet backgrounds |
| Surface raised | `bg-zinc-800` | `#27272a` | Hover states, secondary surfaces |
| Border default | `border-zinc-800` | `#27272a` | Inactive cards, dividers |
| Border subtle | `border-zinc-700` | `#3f3f46` | Input fields |
| Text primary | `text-white` | `#ffffff` | Headings, important values |
| Text secondary | `text-zinc-400` | `#a1a1aa` | Labels, metadata |
| Text muted | `text-zinc-600` | `#52525b` | Placeholders, locked state |
| **Slot: Green active** | `text-emerald-400` / `border-emerald-500` / `bg-emerald-950` | `#34d399` / `#10b981` / `#022c22` | Green slot active/completed |
| **Slot: Orange active** | `text-orange-400` / `border-orange-500` / `bg-orange-950` | `#fb923c` / `#f97316` / `#1c0a00` | Orange Tene slot |
| **Slot: Gold active** | `text-amber-400` / `border-amber-400` / `bg-amber-950` | `#fbbf24` / `#fbbf24` / `#1c1100` | Gold basket slots |
| Primary CTA | `bg-emerald-500` active:`bg-emerald-600` | `#10b981` | Primary buttons |
| Danger | `bg-red-600` | `#dc2626` | Destructive actions, error states |

#### Glow shadows `[native]` — applied via `style` prop alongside `className`

```ts
// Use these exact objects — do not modify values
export const GLOW = {
  green:  { shadowColor: '#10b981', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  orange: { shadowColor: '#f97316', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  gold:   { shadowColor: '#fbbf24', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  cta:    { shadowColor: '#10b981', shadowOpacity: 0.40, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
} as const;
```

#### Border radius

| Element | Class | Do not use |
|---------|-------|-----------|
| Cards (SlotCard, info panels) | `rounded-2xl` | `rounded-xl` or `rounded-3xl` on cards |
| Buttons (primary, secondary) | `rounded-xl` | `rounded-full` except pill badges |
| Inputs | `rounded-xl` | `rounded-lg` |
| Badges / pills | `rounded-full` | — |
| Bottom sheets / modals | `rounded-t-3xl` | — |

#### Typography scale

| Variant | Classes | Usage |
|---------|---------|-------|
| `display` | `text-4xl font-black tracking-tight` | App title, team name on hero |
| `heading` | `text-2xl font-bold` | Screen headings |
| `subheading` | `text-lg font-semibold` | Section titles, card titles |
| `body` | `text-base font-normal leading-relaxed` | Descriptions, paragraphs |
| `bodySmall` | `text-sm font-normal` | Secondary body copy |
| `label` | `text-xs font-semibold uppercase tracking-widest` | Section headers, field labels |
| `caption` | `text-[10px] font-medium` | Timestamps, tertiary info |
| `mono` | `text-sm font-mono` | Team codes, slot numbers, QR tokens |

**RTL rule:** Any string that may contain Hebrew must use `writingDirection: 'rtl'` in the style prop. NativeWind does not handle this automatically.

#### Spacing rhythm

Use only multiples of the 4px base unit. Prefer: `p-3` (12px), `p-4` (16px), `p-5` (20px), `p-6` (24px), `gap-3`, `gap-4`. Do not use `p-2.5`, `p-3.5`, or other half-steps except `py-1.5` for compact pill badges.

---

### 19.2 Firestore Document Schema — Field-Level Specification

All timestamps use **Firestore `serverTimestamp()`** — never `new Date()` or `Date.now()` in client writes.
`?` = optional field. No field = required.

#### `Team` — `artifacts/{appId}/users/{userId}/profile/team`

| Field | TypeScript type | Firestore type | Required | Notes |
|-------|----------------|----------------|----------|-------|
| `id` | `string` | `string` | ✅ | Equals Firebase Auth UID |
| `name` | `string` | `string` | ✅ | 1–40 chars, validated in Firestore rules |
| `code` | `string` | `string` | ✅ | 4–6 chars uppercase, judge lookup key |
| `memberNames` | `string[]` | `array` | ✅ | 2–8 items, each 1–30 chars |
| `status` | `'registered' \| 'active' \| 'park' \| 'finished'` | `string` | ✅ | Written by Cloud Functions only |
| `createdAt` | `Timestamp` | `timestamp` | ✅ | `serverTimestamp()` on creation |
| `startedAt` | `Timestamp?` | `timestamp` | ❌ | Set when team taps first slot |
| `finishedAt` | `Timestamp?` | `timestamp` | ❌ | Set when all 6 stages complete |

#### `Task` — `artifacts/{appId}/public/data/tasks/{taskId}`

| Field | TypeScript type | Firestore type | Required | Notes |
|-------|----------------|----------------|----------|-------|
| `id` | `string` | `string` | ✅ | Semantic: `task-green-001` |
| `title` | `string` | `string` | ✅ | English display title |
| `titleHe` | `string?` | `string` | ❌ | Hebrew title |
| `description` | `string` | `string` | ✅ | Full task instructions |
| `type` | `'green' \| 'orange' \| 'gold'` | `string` | ✅ | Determines slot colour |
| `coordinates` | `{ lat: number; lng: number }?` | `map` | ❌ | GPS location of station |
| `locationHint` | `string?` | `string` | ❌ | Human-readable navigation hint |
| `qrCode` | `string` | `string` | ✅ | Unique token on physical QR sticker |
| `maxConcurrentTeams` | `number` | `number` | ✅ | Default `3` |
| `currentTeamCount` | `number` | `number` | ✅ | Incremented via `FieldValue.increment(1)` — never set directly |
| `photoRequired` | `boolean` | `boolean` | ✅ | — |
| `pointValue` | `number` | `number` | ✅ | `100` / `150` / `200` |
| `estimatedMinutes` | `number` | `number` | ✅ | Routing weight input |
| `isActive` | `boolean` | `boolean` | ✅ | `false` = hidden from routing |

#### `GameState` — `artifacts/{appId}/users/{userId}/gameState/current`

| Field | TypeScript type | Firestore type | Required | Notes |
|-------|----------------|----------------|----------|-------|
| `teamId` | `string` | `string` | ✅ | Equals Firebase Auth UID |
| `slots` | `SlotRecord[]` | `array` | ✅ | Always exactly 8 items, ordered by `index` |
| `slots[n].index` | `number` | `number` | ✅ | `0`–`7` |
| `slots[n].type` | `'green' \| 'orange' \| 'gold'` | `string` | ✅ | Fixed by position |
| `slots[n].status` | `'locked' \| 'active' \| 'completed'` | `string` | ✅ | Written by Cloud Functions |
| `slots[n].taskId` | `string?` | `string` | ❌ | Populated when assigned |
| `slots[n].taskTitle` | `string?` | `string` | ❌ | Denormalised for display |
| `slots[n].completedAt` | `Timestamp?` | `timestamp` | ❌ | `serverTimestamp()` on completion |
| `score` | `number` | `number` | ✅ | Written by Cloud Functions — never client |
| `bonusPenalty` | `number` | `number` | ✅ | Starts `0`, incremented by clue hints |
| `currentTaskId` | `string?` | `string` | ❌ | Active task being worked on |
| `updatedAt` | `Timestamp` | `timestamp` | ✅ | `serverTimestamp()` on every write |

---

### 19.3 Naming Conventions

These are enforced by ESLint and code review. No exceptions.

#### Casing

| Construct | Rule | Example |
|-----------|------|---------|
| TypeScript variables & functions | `camelCase` | `gameState`, `completeSlot()` |
| TypeScript types & interfaces | `PascalCase` | `GameState`, `SlotRecord` |
| React components | `PascalCase` | `SlotCard`, `PrimaryButton` |
| Component files | `PascalCase.tsx` | `SlotCard.tsx` |
| Non-component files | `camelCase.ts` | `gameStore.ts`, `firestoreService.ts` |
| Firestore document fields | `camelCase` | `memberNames`, `pointValue` |
| Env variables | `SCREAMING_SNAKE_CASE` | `RUSHPOINT_APP_ID` |
| Constants (module-level) | `SCREAMING_SNAKE_CASE` | `GLOW`, `COLLECTIONS` |

#### Firestore collection names

| Rule | Correct | Wrong |
|------|---------|-------|
| Always plural | `tasks`, `checkIns` | `task`, `checkIn` |
| camelCase for multi-word | `checkIns`, `flashMissions` | `check_ins`, `CheckIns` |
| Consistent with `COLLECTIONS` constants | `COLLECTIONS.CHECK_INS` → `'checkIns'` | hardcoded string `'check-ins'` |

#### Timestamps — strict rule

```ts
// ✅ Always — Firestore server timestamp for any write
import { serverTimestamp } from 'firebase/firestore';
{ updatedAt: serverTimestamp() }

// ❌ Never — client clock is unreliable in the field
{ updatedAt: new Date().toISOString() }
{ updatedAt: Date.now() }
```
Exception: the seed script uses `new Date().toISOString()` only because it runs against the emulator outside the client SDK. Never in app code.

#### Document IDs

| Data type | ID format | Example |
|-----------|-----------|---------|
| Team | Firebase Auth UID (auto) | `XyZ123abc...` |
| Task | Semantic slug | `task-green-001` |
| Event | Semantic constant | `current` |
| GameState | Semantic constant | `current` |
| CheckIn | `checkin-{teamId}-{taskId}` | `checkin-XyZ123-task-gold-001` |
| Leaderboard | Semantic constant | `current` |

Do not use `doc()` with no arguments (auto-ID) for documents where the ID is meaningful or needs to be looked up by a known key.

---

### 19.4 Core Component Prop Contracts

These are the exact TypeScript interfaces to implement tomorrow. Do not add props not listed here. Props can be added in Phase 2 when a real need is identified.

```typescript
// ─── Button ───────────────────────────────────────────────────────────────────
export interface ButtonProps {
  /** Button label or icon node */
  children: React.ReactNode;
  /** Called on press — may be async; component handles loading state */
  onPress: () => void | Promise<void>;
  /** Visual style variant (default: 'primary') */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Size (default: 'md') */
  size?: 'sm' | 'md' | 'lg';
  /** Disables interaction and dims the button */
  disabled?: boolean;
  /** Shows ActivityIndicator and blocks further presses */
  loading?: boolean;
  /** Stretches button to full container width */
  fullWidth?: boolean;
}

// Size → class map (static, for NativeWind)
// sm  → 'px-3 py-2 text-sm rounded-xl'
// md  → 'px-5 py-3 text-base rounded-xl'       ← default
// lg  → 'px-6 py-4 text-lg rounded-xl'

// Variant → class map
// primary   → 'bg-emerald-500 active:bg-emerald-600 text-white'  + GLOW.cta shadow
// secondary → 'bg-transparent border border-zinc-600 text-zinc-300 active:bg-zinc-800'
// ghost     → 'bg-transparent text-emerald-400 active:bg-zinc-900'
// danger    → 'bg-red-600 active:bg-red-700 text-white'


// ─── Card ─────────────────────────────────────────────────────────────────────
export interface CardProps {
  /** Card contents */
  children: React.ReactNode;
  /** Applies a coloured native shadow glow (default: 'none') */
  glowColor?: 'green' | 'orange' | 'gold' | 'none';
  /** Extra NativeWind classes for layout overrides (padding, margin, width) */
  className?: string;
  /** Makes the card pressable — renders as Pressable instead of View */
  onPress?: () => void;
}

// Base card class (always applied):
// 'bg-zinc-900 rounded-2xl border border-zinc-800'
// + GLOW[glowColor] native shadow when glowColor !== 'none'


// ─── Badge ────────────────────────────────────────────────────────────────────
export interface BadgeProps {
  /** Text displayed inside the badge */
  label: string;
  /** Colour variant */
  variant: 'green' | 'orange' | 'gold' | 'neutral' | 'error' | 'info';
  /** Size (default: 'md') */
  size?: 'sm' | 'md';
}

// Variant → class map
// green   → 'bg-emerald-950 text-emerald-400 border border-emerald-800'
// orange  → 'bg-orange-950 text-orange-400 border border-orange-800'
// gold    → 'bg-amber-950 text-amber-400 border border-amber-800'
// neutral → 'bg-zinc-800 text-zinc-400 border border-zinc-700'
// error   → 'bg-red-950 text-red-400 border border-red-800'
// info    → 'bg-blue-950 text-blue-400 border border-blue-800'

// Size → class map
// sm → 'px-2 py-0.5 text-[10px] rounded-full'
// md → 'px-2.5 py-1 text-xs rounded-full'      ← default
```

---

### 19.5 Tracer Bullet QA Checklist

Copy this checklist into a comment block or notepad tomorrow. Every item must pass before Phase 1 is declared done.

```
RUSHPOINT — TRACER BULLET QA CHECKLIST
Phase 1 / Demo Flow
Run: npm run emulator (terminal 1) | npm run seed:reset (terminal 2)
─────────────────────────────────────────────────────────────────────

□ 1. AUTH
     Action:  Launch mobile app. App lands on index.tsx.
     Verify:  Anonymous sign-in completes against emulator (Auth emulator
              shows a new anonymous user at http://localhost:9099).
     Verify:  With no team in Zustand, app redirects to /register.
     Fail if: Spinner hangs > 5 seconds. Any console error. Redirect to
              dashboard before registration.

□ 2. REGISTRATION
     Action:  Enter team name "Test Team" + 2 member names. Tap Start.
     Verify:  Firestore emulator contains a new doc at:
              artifacts/race-to-tzion-2026/users/{uid}/profile/team
              with correct name, memberNames, status: 'registered'.
     Verify:  App navigates to /dashboard.
     Fail if: Doc written to wrong path. Missing fields. No navigation.

□ 3. DASHBOARD LOADS FROM FIRESTORE
     Action:  On /dashboard, manually set uid to ROOK1 team (mock-team-a-uid)
              OR sign in as that seeded user.
     Verify:  Slot 0 renders as "active" (emerald border, non-dim).
     Verify:  Slots 1–7 render as "locked" (dim, non-interactive).
     Verify:  Score shows 0. Team name "The Rookies" visible in header.
     Fail if: All slots locked. Slots read from Zustand seed instead of
              Firestore. Score shows stale value.

□ 4. MARK AS DONE — HAPPY PATH + DOUBLE-TAP
     Action:  Tap slot 0 (active).
     Verify:  Slot 0 immediately shows "completed" in UI (optimistic update).
     Verify:  Slot 1 activates within 3 seconds (Firestore onSnapshot fires).
     Verify:  Score increments by 100 on dashboard.
     Action:  Tap slot 0 again immediately after first tap.
     Verify:  Second tap is silently ignored — no duplicate checkIn in Firestore.
     Fail if: UI freezes. onSnapshot doesn't fire. Slot 1 stays locked after
              3 seconds. Duplicate checkIn document created.

□ 5. JUDGE PANEL — VALIDATION + SUBMISSION
     Action:  Open Admin at http://localhost:5173. Navigate to Judge page.
     Verify:  Team C ("The Basket Finders", BSKT3) pending check-in appears.
     Action:  Enter score "150" in the score field.
     Verify:  Submit button is DISABLED. Inline error: "Score must be 0–100."
     Action:  Clear field and enter score "82". Add note "Good grape press."
     Verify:  Submit button enables.
     Action:  Click Submit.
     Verify:  checkIn doc status → 'approved', judgeScore: 82 in Firestore.
     Fail if: Score 150 is accepted. alert() fires. Submit button always enabled.
              No inline validation message.

□ 6. LIVE SCORE REFLECTION ON MOBILE
     Action:  Keep Team C's dashboard open on mobile while judge submits.
     Verify:  Score updates from 550 to new value (550 + 82×3 = 796) within
              3 seconds of judge submission — no manual refresh required.
     Verify:  No full page reload. Only the score counter re-renders.
     Fail if: Score doesn't update within 3 seconds. Page requires refresh.
              Score updates to wrong value.

─────────────────────────────────────────────────────────────────────
ALL 6 CHECKS PASSING = PHASE 1 COMPLETE ✅
```

# RushPoint – "Race to Tzion" (המירוץ לציון)

> Developer persona, coding guidelines, and Firestore path rules: see [INSTRUCTIONS.md](INSTRUCTIONS.md)

Gamified real-time team management app powering the Race to Tzion adventure event in Jerusalem.

## Architecture Overview

**Monorepo** managed with npm workspaces:

| Package | Tech | Purpose |
|---|---|---|
| `apps/mobile` | Expo (React Native) | iOS + Android team app |
| `apps/admin` | React + Vite | Web dashboard for judges & admins |
| `functions/` | Node 20 + Firebase Functions | Backend logic + routing algorithm |
| `packages/shared` | TypeScript | Shared types and constants across all packages |

**Backend**: Firebase (Firestore, Auth, Cloud Functions, Storage)
**Maps**: Mapbox GL or Google Maps SDK
**State (mobile)**: Zustand
**Offline**: expo-sqlite + background sync queue

## Project Structure

```
rushpoint/
├── apps/
│   ├── mobile/           # Expo React Native app
│   │   └── src/
│   │       ├── screens/
│   │       ├── components/
│   │       ├── navigation/
│   │       ├── services/   # Firebase, maps, location, audio
│   │       └── store/      # Zustand slices
│   └── admin/            # Vite React web dashboard
│       └── src/
│           ├── pages/
│           ├── components/
│           └── services/
├── functions/            # Firebase Cloud Functions
│   └── src/
│       ├── routing/      # Load-balancing algorithm
│       ├── scoring/
│       └── flash/        # Flash missions
└── packages/
    └── shared/           # Types, constants, utils
        └── src/
            └── types/
```

## Development Commands

```bash
# Install all workspaces
npm install

# Mobile (requires Expo CLI)
npm run mobile              # Start Expo dev server
npm run mobile:ios          # Run on iOS simulator
npm run mobile:android      # Run on Android emulator

# Admin dashboard
npm run admin               # Dev server on http://localhost:5173
npm run admin:build         # Production build

# Firebase Functions
npm run functions:serve     # Local emulator
npm run functions:deploy    # Deploy to Firebase

# Type check all packages
npm run typecheck

# Lint all packages
npm run lint
```

## Firebase Setup

1. Create a Firebase project at https://console.firebase.google.com
2. Enable: **Firestore**, **Authentication** (Phone/Anonymous), **Storage**, **Cloud Functions**
3. Copy config to `apps/mobile/src/services/firebase.config.ts` and `apps/admin/src/services/firebase.config.ts`
4. Service account key → `functions/serviceAccount.json` (gitignored)

```bash
firebase login
firebase use --add   # select your project
```

## Firestore Data Model

### Collections

```
teams/{teamId}
  name, code, memberNames[], status, score, slots[8], createdAt, finishedAt

tasks/{taskId}
  title, description, type (green|orange|gold), locationHint, qrCode,
  maxConcurrentTeams, currentTeams[], coordinates

assignments/{teamId}
  taskQueue[], currentTask, completedTasks[], injectedRiddle?

checkIns/{checkInId}
  teamId, taskId, timestamp, photoUrl, approved, judgeId

leaderboard/{eventId}
  rankings[], frozen, frozenAt

events/{eventId}
  status (pre|live|frozen|ended), startedAt, endedAt
  settings: { freezeMinutesBeforeEnd, maxTeamsPerStation }
```

## Core Concepts

### Slot System
Each team has 8 slots:
- Slots 1–4 (green): Open-field team-building missions
- Slot 5 (orange): Navigate to Bible Park, find the Tene basket
- Slots 6–8 (gold): Basket-filling craft activities

### Load-Balancing Routing Algorithm
- Lives in `functions/src/routing/`
- Triggered when a team completes a task and requests the next one
- Scores each available task by: `distance_weight + congestion_penalty + time_estimate`
- If all Bible Park slots are full (≥ 3 teams), injects an off-site riddle to delay park entry
- Never sends two teams to the same task if `currentTeams >= maxConcurrentTeams`

### Offline Mode
- All task data, QR codes, and pending check-ins stored in expo-sqlite
- Background sync retries every 30s when connectivity restored
- Queued actions: checkIn, photoUpload, scoreSubmit

## Phase Roadmap

| Phase | Scope |
|---|---|
| **MVP** | Auth, 8-slot dashboard, static map, basic judge scoring |
| **Phase 2** | Real-time routing algorithm, offline mode, admin heatmap, audio climax |
| **Phase 3** | Leaderboard freeze, SOS, flash missions, social tagging, Wrapped cards |

## Key Constraints

- Must work in GPS dead zones (offline mode is non-negotiable for Phase 2)
- Max concurrency per station: 3 teams (configurable per event)
- Target devices: iOS 15+, Android 10+
- Leaderboard freezes 30 min before event end OR on first "Final Run" trigger
- Judge interface must work on a phone browser, no app install required

## Environment Files

```
apps/mobile/.env          # EXPO_PUBLIC_FIREBASE_*, EXPO_PUBLIC_MAPBOX_TOKEN
apps/admin/.env           # VITE_FIREBASE_*, VITE_MAPBOX_TOKEN
functions/.env            # FIREBASE_SERVICE_ACCOUNT (or use ADC)
```

All `.env` files are gitignored. See `.env.example` files in each package.

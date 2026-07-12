# Proposal: fix-play-offline-continuity

## Why

Playtest feedback: when connectivity drops, the play screen "freezes or breaks" instead of staying
stable until it reconnects, so the game stops feeling alive. Two concrete gaps in
`apps/play-web/src/screens/PlayScreen.tsx`:

1. A poll (`getMyTeamState`) failure mid-game sets an error but the running play UI never surfaces any
   "reconnecting" affordance — the screen silently shows stale data, and a first-load transient error
   drops the participant onto a full-screen ⚠️ error even for a momentary blip.
2. Reconnection is passive: recovery waits up to 12 s for the next fallback poll (or a Firestore
   snapshot). There is no reaction to the browser's `online` event, so coming back from a dead zone
   feels slow/stuck.

(The 20 s server hangs that made this worse are fixed separately in
`fix-getmyteamstate-hotpath-writes`.)

## What Changes

- Keep the last-known state on screen through a transient failure (already the case) and add a
  **non-blocking "reconnecting…" pill** so the participant sees the game is alive and syncing rather
  than frozen. The full-screen error is **reserved for fatal errors** (team not found / permission /
  unauthenticated); transient/offline failures on first load keep the connecting spinner and retry.
- **Resume instantly on reconnect:** subscribe to the browser `online` event and trigger an immediate
  refresh; while offline/reconnecting, retry on a short backoff instead of only the 12 s fallback.

## Non-goals

- No change to offline submit blocking (`TaskRunner` already guards writes) or to the top
  `ConnectionBanner`.
- No new caching layer (Firestore `persistentLocalCache` already serves cached reads).
- No server change.

## Capabilities

### New Capabilities
- `participant-offline-continuity`: the play screen stays populated and visibly "reconnecting" through
  a connectivity drop, and resumes immediately when the network returns; only a fatal error replaces
  the screen.

## Impact

- **Surfaces touched:** play-web (`screens/PlayScreen.tsx`, `i18n.ts` new `play.reconnecting` key).
- **Tests:** a pure classifier `isFatalSyncError(code)` unit-tested (fatal vs. transient); UI verified
  via the preview tools (offline → reconnecting pill + last state retained → online → instant resume);
  `npm run i18n:check` for the new string.

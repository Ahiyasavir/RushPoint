## Why

Geocaching's Trackables — a physical/virtual item picked up at one spot and dropped at
another, carrying a travel log — create durable, shareable stories and a reason to keep
playing. RushPoint has no object that moves between tasks/teams. A within-run trackable is
a small, high-delight addition on top of the existing task-completion flow.

## What Changes

- A run gains **trackables** (`…/runs/{runId}/trackables/{trackableId}`):
  `{ name, description, imageUrl, currentHolderTeamId, homeTaskId }`, authored by the owner.
- A team **picks up** a trackable when it completes/visits the task the trackable currently
  sits at, and **drops** it at a later task — via `pickUpTrackable` / `dropTrackable`
  callables (controller-only, server-validated). Each move appends to an append-only
  **travel log** subcollection.
- The play-web shows a **"Carrying"** chip and a pickup/drop affordance at the relevant
  task; the creator RunConsole shows a live "where is each trackable" tracker reading the log.

## Capabilities

### New Capabilities
- `trackable-collectibles`: run-scoped trackables with server-validated pickup/drop, an
  append-only travel log, and play + creator surfaces.

## Non-goals
- **No cross-run / cross-game persistence in v1** — that requires a durable player-identity
  concept that does not exist (play-web is anonymous, `uid == teamId`, single-run). Within-run
  first; QR-portable and player-owned trackables are explicitly deferred (see player-profile).
- No scoring effect (carrying is for story/fun; a "deliver for points" variant is a later change).

## Surfaces touched
- **shared:** `trackable.ts` (`Trackable` type + pickup/drop/hold state + log-append order —
  pure, unit-tested); `FIRESTORE_PATHS` entries.
- **functions:** `pickUpTrackable` / `dropTrackable` / `getTrackableLog` + owner
  `createTrackable` in `runs/index.ts` (+ re-exports); transactional holder transfer.
- **rules:** `match /trackables/{id}` (+ nested `/log/`) — `read: if isAuthenticated()`,
  `write: if false`. Travel log covered by the 90-day PII prune (it names teams).
- **play-web / creator-web:** carrying chip + pickup/drop affordance + console tracker;
  `calls.ts` wrappers; i18n.
- **Tests:** `scripts/test-trackable.ts` (pickup/drop/transfer + log ordering); e2e chain
  (A picks up → drops → B picks up → log reflects the chain); authz matrix entry.

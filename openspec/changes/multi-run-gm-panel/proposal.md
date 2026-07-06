## Why

An organizer running several concurrent runs (multiple groups, back-to-back sessions) has
no cross-run view — they must open each run's console separately to spot an SOS or a
stalled team. A single "all my live runs" overview that drills into the existing per-run
console is the missing operations surface. Escape-room GM software treats this as core.

## What Changes

- A new owner-scoped **`listLiveRuns`** callable returns a summary row per live run of the
  caller's games — `{ ownerUid, gameId, runId, gameTitle, accessCode, participantCount,
  launchedAt, unackedAlerts }` — via a `collectionGroup('runs')` query filtered to the
  owner + `status == 'live'`.
- A new creator **Runs Overview** page lists those runs with live badges (participants,
  unacknowledged alerts) and links each card into the existing `/run/:gameId/:runId`
  console — every per-run control (start, finalize, hint, skip, adjust) is reused, zero
  duplication.

## Capabilities

### New Capabilities
- `multi-run-gm-panel`: `listLiveRuns` owner aggregate + a cross-run overview page that
  deep-links into the existing single-run console.

## Non-goals
- No cross-run STAFF oversight (staff tokens are single-run by design); v1 is owner-only.
- No new mutation — the overview only reads + links to existing mutation callables.
- No embedded per-run controls on the overview itself (deep-link, don't duplicate).

## Surfaces touched
- **functions:** `listLiveRuns` in `runs/index.ts` + re-export. Needs a `collectionGroup`
  composite index (`ownerUid` + `status`) in `firestore.indexes.json`.
- **shared types:** `LiveRunSummary` row type.
- **creator-web:** `RunsOverviewPage.tsx` + route + nav entry; `calls.ts` wrapper; i18n.
- **Tests:** e2e — launch 2 runs, assert `listLiveRuns` returns exactly the live ones (not a
  finished one, not another owner's); add to the authz denial matrix (stranger → denied).

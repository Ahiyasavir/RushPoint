# Proposal: fix-getmyteamstate-hotpath-writes

## Why

In the 2026-07-11 family playtest, `getMyTeamState` — the most frequently polled callable (every
attached device, every few seconds) — failed **73×** with `10 ABORTED: Transaction lock timeout` and
ran **17–21 seconds** per call (`.firebase/playtest-forever.log`). This is the core "the screen
freezes / the app feels unstable" symptom: a poll that hangs 20s and then errors makes the running
game look dead.

Root cause: `getMyTeamState` performs two Firestore writes on this hot read path — a scheduled-release
stage unlock and a task-expiry sweep (`functions/src/runs/index.ts`). Both are plain `.update()`s on
the team doc. When multiple devices of the same team poll simultaneously (teams run up to 3 phones),
they all compute the same advance and race to write the SAME team doc, and they also contend with the
team's own `completeTask`/`requestNextTask` transactions — producing lock-timeout aborts. Because the
write is awaited inline, a contended write both slows the response to ~20s AND, on abort, fails the
entire read.

These writes are only an optimization: `requestNextTask` (`assignNextInActiveStage`) already applies
and persists the exact same unlock + sweep transactionally, and play-web always calls
`requestNextTask` after seeing an active stage with no assigned task. So the read does not need to own
persistence.

## What Changes

- Extract the poll-time advance orchestration into a testable helper
  `advanceTeamStateOnPoll(...)` that:
  - **always** advances the in-memory `team` (stages/status/activeTaskId) so the response reflects the
    unlock/sweep immediately (unchanged UI behavior);
  - persists the advance **best-effort** — a failed write is caught and logged via `logBestEffort`,
    never thrown, so a contended write can no longer fail the read;
  - persists **only when the caller is the team controller**, so the ≤3 devices of a team no longer
    stampede the same write (contention, and thus latency, drops to at most one writer per team). The
    controller's write plus `requestNextTask`'s transactional write keep persistence correct.
- `getMyTeamState` calls the helper instead of writing inline.

## Non-goals

- No change to the participant response shape or to `computeStageUnlock`/`sweepExpiredInFlight`.
- Not making `getMyTeamState` fully read-only: the controller still persists so the existing
  "poll unlocks a stage, then complete without an intervening requestNextTask" flow keeps working.
- No client change (play-web already re-requests a task after polling).

## Capabilities

### New Capabilities
- `participant-poll-resilience`: a `getMyTeamState` poll never fails or stalls because of a contended
  advance write; the advance is persisted best-effort by the controller only.

## Impact

- **Surfaces touched:** functions (`runs/index.ts`: new `advanceTeamStateOnPoll`, `getMyTeamState`).
  No shared/client change.
- **Callables affected (behavior, not signature):** `getMyTeamState` (no longer throws on a contended
  advance; non-controller polls do not write).
- **Tests:** unit (`advanceTeamStateOnPoll.test.ts`) for controller-only + best-effort + always-advance;
  the existing scheduled-release e2e is the persistence regression; a new e2e assertion that a viewer
  device's poll does not advance the persisted team doc while the controller's does.

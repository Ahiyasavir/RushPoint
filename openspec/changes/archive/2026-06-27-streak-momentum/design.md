# Design — Streak & momentum counter

## Current behavior

- `TaskState[]` on the team doc has `completedAt` per task and `status: 'completed' | 'skipped' | ...`.
- Play-web `store.ts` holds the team's live state, including all task states.
- No consecutive-completion tracking exists.

## Approach

### Pure helper (the TDD lever) → `packages/shared/src`

```ts
computeStreak(
  taskStates: TaskState[],  // all task states for the current stage, ordered by completedAt
  nowMs:      number,
  medianMs:   number,       // median task completion time for this run (or fallback default)
  breakMultiplier?: number  // default 2 — streak breaks if gap > breakMultiplier × medianMs
): { streak: number; milestone: 3 | 5 | 10 | null }
```

Logic:
1. Walk `taskStates` in reverse completion order (most recent first).
2. Count consecutive `status === 'completed'` (not skipped, not timed-out) tasks.
3. Break if a gap between consecutive `completedAt` timestamps exceeds `breakMultiplier × medianMs`.
4. Return the count and the latest milestone threshold crossed (3, 5, 10 or null).

`computeMedianTaskMs(taskStates)` — a companion pure helper for the fallback median estimate.

### Play-web UI

`useStreak` hook in play-web: calls `computeStreak` with the live task states from the store;
memoized on task states list. Renders in `PlayScreen.tsx` (or `TaskRunner.tsx`) as a small chip
above the task card: `🔥 3 in a row!` → hidden when streak < 2; escalating animation class at
milestones (CSS `@keyframes` shake/pulse baked into the Tailwind config).

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-streak.ts`:
  - `computeStreak` returns 0 for no completions; counts consecutive completions; resets on skip;
    resets when gap > breakMultiplier × median; milestone returned at 3, 5, 10.
  - `computeMedianTaskMs` returns correct median for odd/even-length arrays; returns a default for
    an empty list.
- **UI (preview):** play screen with mock task states showing a 3-streak → chip renders; swap to a
  skipped task → chip disappears.

## Conventions

- Pure math only, no Firestore write, no callable. Derives from existing state.
- `prefers-reduced-motion`: milestone animation skipped if the media query matches.

# Tasks — Streak & momentum counter (RED → GREEN → REFACTOR)

- [ ] **1. RED (pure):** new `scripts/test-streak.ts` — assert `computeStreak` (consecutive
  completions increment; skip resets; gap > 2×median resets; milestones 3/5/10 returned) and
  `computeMedianTaskMs` (correct median; default for empty list). Run `npm test` → fails RED.
- [ ] **2. GREEN:** add `computeStreak` + `computeMedianTaskMs` to `packages/shared/src/`, export
  from `index.ts`. Re-run → green.
- [ ] **3. GREEN (UI):** `useStreak` hook in play-web; render streak chip in `PlayScreen.tsx` /
  `TaskRunner.tsx` (hidden < 2, milestone animation at 3/5/10, `prefers-reduced-motion` guard).
  Verify via preview: mock 3-streak → chip; add a skip → chip disappears.
- [ ] **4. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build`.

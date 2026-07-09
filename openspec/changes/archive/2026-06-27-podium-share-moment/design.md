# Design — Podium moment

## Current behavior

- `screens/FinalScreen.tsx` shows the team's final score + a story-card share (`shareStoryCard`).
- `run.rankings[]` holds the ordered final standings.

## Approach

### Pure helper → `packages/shared/src`

```ts
selectPodium(rankings): { gold?, silver?, bronze?, myPlacement: number }
  // maps the top 3 rankings to podium slots; myPlacement = caller's rank (for the "#N" path)
computePodiumLayout(count, W, H): { slots: {x,y,w,h,height}[] }  // 1-2-3 heights, centered
```

Tested in `scripts/test-podium.ts` (no DOM): top-3 mapping with 1/2/3+ teams; podium heights
ordered gold > silver > bronze; layout centered and in-bounds.

### UI

- `FinalScreen` plays a podium reveal (CSS transform rise + existing confetti). `prefers-reduced-motion`
  → render the final podium with no animation.
- "Share podium" → build a podium canvas with `computePodiumLayout`, `stampBrand` (share-branding),
  share via the existing ladder.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-podium.ts`: `selectPodium` + `computePodiumLayout` cases above.
- **UI (preview):** Final screen shows podium reveal; reduced-motion shows instant podium; "Share
  podium" produces a branded image.

## Conventions

- Reads `rankings[]` only; no scoring write. Branding via the single `share-branding` stamp.
- `prefers-reduced-motion` respected (Appendix A rule 19).

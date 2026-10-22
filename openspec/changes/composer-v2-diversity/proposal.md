# Composer v2, phase 2: diversity by mechanic tags

## Why
Plan: docs/composer-v2-plan-2026-10-22.md, phase 2. "מאוד חשוב לי שיהיה מגוון ומקוריות במשימות". Families
stopped near-identical missions from meeting, but nothing stopped a stage of three stranger missions.

## What changes
- `MECHANIC_TAG_IDS` in bankTags.ts (the 20 mechanic tags every bank mission now carries).
- `fitScore` subtracts a diversity penalty (up to 0.12 for mechanics already in the stage, up to 0.06
  for mechanics used in the game), outside TERM_WEIGHTS like the recency penalty.
- Hard caps: at most 2 stranger missions per stage, at most 1 ongoing mission per game. A cap that would
  empty a slot is lifted for that slot rather than dropping it.
- The rng draw sequence is unchanged (one draw per slot); `composeGame(..., { diversity: false })` exists
  so a test can measure the effect.

## Measured (scripts/test-composer-diversity.ts, 15 answer sets x 12 seeds)
Same-mechanic pairs inside a stage: 1448 without, 564 with (-61%). Distinct mechanics per mission: 0.84
without, 0.94 with. Zero stages over the strangers cap, zero games over the ongoing cap.

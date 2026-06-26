## 1. RED — Failing pure-logic test

- [x] 1.1 Create `scripts/test-promo-copy.ts` importing `describeGameRequirements` (and a
  `selectDescription`-style blank helper) from `@rushpoint/shared` (not yet implemented). Encode:
  - game with a `radius`/`exact` task → `'gps'`
  - game with only `instant`/`locationless` tasks → `'anywhere'`
  - helper never returns the demo placeholder string (returns only enum keys)
  - blank description → empty/null (UI shows neutral empty state, not demo copy)
- [x] 1.2 Run `npm test`; confirm failure (not exported) (RED).

## 2. GREEN — Shared helper

- [x] 2.1 Add `describeGameRequirements(game)` + blank-description helper to
  `packages/shared/src/geo.ts` (reads `triggerMode`, falling back to `locationless`); re-export from
  `index.ts`.
- [x] 2.2 Run `npm test`; confirm `test-promo-copy.ts` passes (GREEN).

## 3. GREEN — Welcome/promo + join render real data

- [x] 3.1 In `GamePromoScreen.tsx`, render `game.description` (`dir="auto"`) with a neutral i18n empty
  state when blank; add a requirement badge from `describeGameRequirements(game)` (i18n
  `promo.reqGps`/`promo.reqAnywhere`).
- [x] 3.2 In `JoinScreen.tsx` step 2 hero, same treatment for `info.description` + requirement line.
- [x] 3.3 Add the i18n keys (`promo.noDescription`, `promo.reqGps`, `promo.reqAnywhere`) to the
  play-web i18n maps (he + en).

## 4. GREEN — Seed copy cleanup

- [x] 4.1 Rewrite `scripts/seed-local.mjs` demo `description` to be clearly demo-scoped, no em-dash
  (per `ui-no-dashes`), not a generic default.

## 5. Verify

- [x] 5.1 `npm run typecheck` — 0 errors.
- [x] 5.2 `npm test` — promo-copy test green.
- [x] 5.3 `npm run e2e` — join/launch lifecycle still green.
- [x] 5.4 Preview play-web `?game=<id>` + join step 2: real description (or neutral empty state) +
  accurate requirement badge; no "דמו" on a non-demo game.

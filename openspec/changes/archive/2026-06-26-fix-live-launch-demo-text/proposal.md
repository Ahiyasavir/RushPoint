# Proposal — Live launch welcome shows real game data, not demo placeholder text

## Why

On a game's entry/welcome screen, demo placeholder copy can appear for what should be a real, live
game: `"…דמו קצר שאפשר לשחק מכל מקום — בלי GPS ובלי מפעיל. רק תלחצו ותתחילו!"`. Investigation
confirms this exact string exists **only** in the seeded demo game's `description`
(`scripts/seed-local.mjs:92`); `GamePromoScreen.tsx` and `JoinScreen.tsx` step 2 render
`game.description` / `info.description` **verbatim** with no dynamic, accurate requirement line. So
(a) the welcome screen has no separate, trustworthy "does this need GPS" indicator — the GPS claim is
baked into free-text demo copy — and (b) the demo wording is presented as if it were real game data.

## What Changes

> Observable behavior. The welcome/entry screen reflects the real game's configuration: the actual
> description (or a neutral non-demo empty state) plus an accurate, dynamically-derived
> GPS-requirement line. No "demo" wording leaks onto a live game.

- The welcome/promo and join hero render the real `game.description` via `dir="auto"`; when absent,
  a neutral non-demo empty state is shown (never demo placeholder copy).
- A **dynamic GPS-requirement line** is derived from the game's task trigger modes (any located
  `radius`/`exact` task ⇒ "requires GPS / move to locations"; all `instant`/`locationless` ⇒
  "playable anywhere") instead of trusting free-text claims like "בלי GPS".
- The demo description is scoped to the actual demo seed game only, and its copy is cleaned of demo
  framing where it would otherwise read as a generic default.

## Capabilities

### New Capabilities
- `accurate-launch-welcome`: the entry screen presents real, dynamic game data and a derived
  GPS-requirement indicator, with no demo placeholder leakage on live games.

## Surfaces touched

- **shared:** new pure helper `describeGameRequirements(game)` in `packages/shared/src/geo.ts` (or
  `gameSummary.ts`), re-exported from `index.ts`. Consumes `triggerMode` from the `task-trigger-modes`
  change.
- **play-web:** `src/screens/GamePromoScreen.tsx` and `src/screens/JoinScreen.tsx` show the derived
  requirement line + neutral empty state (strings via the play-web i18n layer).
- **seed:** `scripts/seed-local.mjs` demo description cleaned (demo-scoped, no dash, see `ui-no-dashes`).
- **Tests:** `scripts/test-promo-copy.ts` (pure).
- **No callable change.**

## Non-goals

- No change to how a creator authors a game description (free text is still allowed and shown).
- No removal of the demo seed game itself (it stays as the demo, just clearly scoped).
- No change to run launch mechanics (`launchRun`/`getJoinInfo` contracts unchanged).

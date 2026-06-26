## Context

`GamePromoScreen.tsx` loads a `PublicGame` and renders `game.description` directly (line ~76);
`JoinScreen.tsx` step 2 renders `info.description` directly (line ~171). Neither derives a
GPS-requirement indicator — any such claim is whatever the creator (or the seed) typed into the
free-text description. The reported placeholder string is the seed demo game's description
(`scripts/seed-local.mjs:92`), which also contains an em-dash and "demo" framing.

`PublicGame`/`getJoinInfo` carry stage/task counts; with the `task-trigger-modes` change, tasks carry
`triggerMode`, enabling a trustworthy derived requirement line.

## Goals / Non-Goals

**Goals:** real description rendering with a neutral empty state; a pure `describeGameRequirements`
helper driving an accurate GPS-requirement line; cleaned, demo-scoped seed copy.

**Non-Goals:** changing creator authoring; removing the demo game; launch-mechanics changes.

## Decisions

### D1 — Pure helper `describeGameRequirements(game)`
Input: a game-like object with stages→tasks (or a `PublicGame` summary that includes per-task
`triggerMode`/`locationless`). Output: a small enum/string key, not localized text:
- `'anywhere'` when every task is `instant` or `locationless` (no located task).
- `'gps'` when at least one task is `radius` or `exact` (located).
The play-web i18n layer maps the key to copy (`promo.reqAnywhere` / `promo.reqGps`). The helper is
pure and never returns demo placeholder text.

### D2 — Welcome/promo + join render real data
- Description: render `game.description` with `dir="auto"`. When empty/whitespace, render a neutral
  i18n empty state (`promo.noDescription`, e.g. "פרטים נוספים יגיעו מהמארגן") — never demo copy.
- Requirement line: render the localized string for `describeGameRequirements(game)` as a small badge
  near the stats, replacing reliance on free-text GPS claims.

### D3 — Seed copy cleanup
Rewrite `scripts/seed-local.mjs` demo `description` to be clearly the demo game's copy, with no
em-dash (per `ui-no-dashes`) and no implication it is a generic default. The `task-4` description em
dash + "סיימתם את הדמו" framing is left as demo-scoped (it is the demo game).

## Test strategy

**Pure logic** — `scripts/test-promo-copy.ts` (aggregator-picked):
- `describeGameRequirements` returns `'gps'` for a game with a `radius`/`exact` task.
- returns `'anywhere'` for a game whose tasks are all `instant`/`locationless`.
- never returns the demo placeholder string for any input (it returns only the enum keys).
- empty-description handling: a `selectDescription(game)`-style helper returns `''`/null for blank so
  the UI shows the neutral empty state (no demo fallback).

**UI verification:** preview play-web `?game=<liveGameId>` and the join step-2 hero — real
description (or neutral empty state) + accurate requirement badge; confirm no "דמו" on a non-demo game.

## Risks / Trade-offs

- [Dependency: requires `task-trigger-modes`] → `describeGameRequirements` reads `triggerMode`; until
  that lands it falls back to `locationless` (all-locationless ⇒ `'anywhere'`, else `'gps'`).
- [Risk: `PublicGame` summary lacks per-task trigger data] → if only counts are denormalized, extend
  the public projection minimally to include a `requirement` flag computed server-side at publish, or
  compute from the full game on the join path (which has task data). Pin via the helper's input shape.

## Why

Every team in a run currently sees the same task pool with the same weighting,
and a stage hands out **all** of its tasks by default. Two things follow that we
want to change:

1. Creators who drop several tasks into one stage almost always mean "each team
   does **one** of these" (a branching / choose-your-path level), yet the default
   is "do them all" — so the common case needs manual tweaking every time.
2. The routing already measures each team's pace (`skillRatio`) and each task
   carries a `difficulty` (1–10), but that signal is used **backwards** and only
   under one scoring preset: today a fast team is nudged toward *easier* tasks,
   and only when the game uses `smart_weighted`. The intended feel of a "field
   game" is the opposite — stronger teams should be stretched with the harder
   tasks in the pool, weaker teams eased with the simpler ones, and this should
   hold for **every** game regardless of how it scores.

Together these turn a flat, uniform pool into a per-team adaptive experience with
a sensible one-of-N default.

## What Changes

- **Default "missions required per stage" = 1.** A newly-authored stage (Builder
  "add stage", and template-seeded games) is created with `requiredTaskCount: 1`
  instead of undefined. So the moment a creator adds a second task to a stage,
  the level means "do the best-suited **one**", not "do both". The existing
  in-Builder control that adjusts this count stays — it's the "comfortable place"
  to raise it (e.g. "do 3 of 5") or set it to all.
- **Backward compatible:** already-saved games keep whatever they had
  (undefined = all tasks). The change is only to what *new* stages default to;
  the server-side clamp and the "undefined = all" semantics are untouched.
- **Adaptive difficulty routing is always on, for every preset.** The routing
  skill term is re-derived so a team's measured strength targets a **matching**
  difficulty in the direction creators expect:
  - a **fast** team (negative `skillRatio`) is routed toward **harder** tasks;
  - a **slow** team (positive `skillRatio`) toward **easier** tasks;
  - a team with **no history yet** (`skillRatio == 0`, e.g. the first stage) has
    **no** difficulty preference — pure load/distance, as today.
  This flips the current `smart_weighted`-only "match pace to difficulty" term
  (which pulled fast teams to easy tasks) and applies it under **all** scoring
  presets, using the existing per-task `difficulty`.

Observable effect: in a multi-task stage, different teams are handed different
tasks, and which task a team gets shifts with how well it's playing — the strong
get the hard ones, the struggling get the gentle ones — while each stage defaults
to "complete one of them to advance".

## Non-goals

- **No new field, callable, or stored flag.** Adaptive difficulty is a behavior
  of the existing routing math; it is not a per-game toggle (the user asked for
  it to apply to everyone). `requiredTaskCount` already exists — we only change
  its *default at authoring time*.
- **No change to scoring or the completion bonus.** Skipped-because-unneeded
  tasks still earn nothing, exactly as `requiredTaskCount` auto-skip does today.
- **No change to `requiredTaskCount` server semantics** (undefined still = all;
  the [1, tasks.length] launch clamp is unchanged).
- **No difficulty *targeting UI*** — creators still set each task's `difficulty`
  in the task editor as they do now; we just consume it in routing.
- **No re-ordering of tasks a team already has assigned/completed** — adaptation
  only affects the *next* assignment.

## Surfaces touched

- **functions (routing):** `functions/src/routing/assignNextTask.ts` — the skill
  sub-formula direction + always-on (drop the `skillAware` preset gate);
  `functions/src/runs/index.ts` — the two call sites that pass the preset gate to
  `assignTask` / `buildRecommendations`.
- **creator-web:** `apps/creator-web/src/pages/BuilderPage.tsx` `blankStage` and
  `apps/creator-web/src/templates.ts` `stage()` default `requiredTaskCount: 1`;
  the existing completion-rule control copy (i18n) as needed.
- **shared:** none (no new type/field).
- **rules / indexes / env:** none.
- **Tests:** `functions/src/routing/assignNextTask.test.ts` (vitest) — new
  adaptive-direction cases + updates to existing hot-zone calls; optionally a
  routing property test. No new callable, so the e2e coverage guard is unaffected
  (existing partial-stage scenario already exercises `requiredTaskCount`).

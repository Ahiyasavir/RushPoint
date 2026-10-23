# composer-variety

## Why
Ahiya, 23.10: "improve the composer so it builds better games: more missions in a stage, so not every
team does the same missions, and use more interesting elements". A composed game gave every team the
same missions in the same stages (`requiredTaskCount` was always the stage's size), so teams queued
at the same stops and compared identical stories at the end.

## What
- **Choice stages.** With two or more teams (6+ people), every middle stage holds one mission beyond
  what a team must do (two from about six teams, 24+ people), never past six. Routing already gives
  each team the subset that suits it and skips the rest (`Stage.requiredTaskCount`). The opener and
  the finale stay shared.
- **One hidden mission** in a placed game whose creator accepts authoring work (prep level 3+): a
  mission the composer pinned itself, in the stage nearest the centre, with `hideLocation` and a
  required clue step. Skipped when the bank already gave the game a hidden mission, or when the copy
  has no clue prompt.
- The time estimate counts what ONE team plays; the questionnaire's preview and shape describe one
  team's game, and `ComposerResult.extraTaskIds` names the choice missions on top.
- The setup walk explains both: a hidden-mission line on its ticket, and a line on the plan when a
  stage gives teams their own routes.

## Not changed
Draw order: the new draws come after every existing one (module header rule), so the first ten
steps of any seed are what they were. No exclusive groups: a routed game gives players no choice,
so a group would be invisible.

## Also (23.10, same request)
- **Countdowns follow the difficulty.** `lib/missionTime.ts`: a mission with `timeLimitMinutes` whose
  text states that same number gets easy ×1.5, hard ×0.75 (never below a minute), balanced unchanged,
  timer and text together. A length that is content ("a 30 second video") is never scaled. All 18
  countdowns in the bank qualify.
- **No locations means none.** Asserted, not changed: at prep level 1 (the questionnaire's "no
  locations") 60 of 60 sampled games held only missions played from anywhere and asked for no pin.

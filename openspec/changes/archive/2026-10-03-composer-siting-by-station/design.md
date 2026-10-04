## Context

`composeGame` step 8 sites every `siteableInPlacedGame` mission (`fromAnywhere` and not
`locationBased`) in a placed game: it flips it to a radius trigger and pushes a required
`coordinates` Quick Setup step. Research §4.1 proposes `siting` + `spot` and stations.

## Decisions

### D1. `bankSiting(entry)` is the one resolver
Explicit `entry.siting` wins. Otherwise: `locationBased` ⇒ `must`, `fromAnywhere` ⇒
`possible`, anything else ⇒ `never`. That derivation reproduces today's
`siteableInPlacedGame` exactly, so an unannotated bank behaves as before and an
annotation can only REMOVE a pin, never add one. `siteableInPlacedGame` becomes
`bankSiting(entry) === 'possible'`.

### D2. One invented pin per stage
For each stage of a placed game, after the stage's missions are chosen: if any mission
is `must`, the stage invents no pin. Otherwise the anchor is the first `possible`
mission with a `spot`, else the first `possible` one; only the anchor is sited and
gets a step. Choosing the anchor AFTER the fill step means the rng sequence, and so
the chosen missions, are unchanged by this change: only which of them carry a pin.

### D3. Annotations (ברירת מחדל, ניתן לשינוי)
`never` on missions whose substance is talk, a riddle or an agreement, and on home
chores (the chore happens where the chore is). `spot` on missions that need room or
a feature: open grass for pyramids, letters, airborne photos, races and podiums; a
big tree for "everyone hidden"; a sign for the broken sign; an entrance for the
escape missions; any corner for statues and cairns. The list is in `taskBank.ts`,
next to each mission, and `scripts/test-composer-siting.ts` pins that every
annotation names a real key and a known spot.

### D4. The cost line is predictable without composing
Under the shared seed the stage count is known (`previewShape`), and with stations
the invented pins are at most one per stage. So the preview says
"about N points" with N = the planned stage count, and "about M minutes" with
M = ceil(N × 1.5). It is a plan like the rest of the shape panel: missions sited by
nature can add a pin, and a stage that holds one invents none.

## Risks

- More teams per spot: capacity on composed missions is already high (open spaces);
  the load sim in `verify:emulator` covers routing under contention.
- A creator who wanted a pin per mission: they can still drag any mission onto the map
  in the Builder; the composer simply stops asking for it.

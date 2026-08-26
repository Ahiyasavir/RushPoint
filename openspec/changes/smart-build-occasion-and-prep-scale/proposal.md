## Why

Two pieces of creator feedback on the smart-build questionnaire (the `smart_build` path of the
new-game flow):

1. **The prep question offers three chips where the real answer is a dial.** "בלי הכנה בכלל /
   מוכנים להכין לבד / מוכנים גם לתאם מראש" hides a genuine middle step the creator named out
   loud: *simply placing the missions on real spots*. That effort already exists in the flow — as
   an unrelated yes/no chip buried inside the "where does it happen" question — so the creator is
   asked about their own effort twice, in two places, on two different scales, and neither
   question admits the in-between.
2. **The questionnaire never asks what the event IS.** A birthday party, a bar/bat mitzvah, a
   wedding, a company team-building day and a youth-movement activity are five different games,
   and today they all compose identically. The composer knows who is playing and for how long,
   but not what the occasion is — so it cannot vary what the stages are called, how many missions
   sit in each, or which kinds of mission it favours.

## What Changes

- **The prep question becomes a cumulative 1–5 scale.** Each level includes everything below it:
  1 = no prep at all · 2 = I will pin missions to real spots on the map · 3 = + prepare things
  myself at home · 4 = + go to the site beforehand and set it up there · 5 = + coordinate with an
  outside party. One question, one axis, monotone by construction.
- **BREAKING (creator-facing, not data): the "should missions be pinned to real spots?" yes/no
  chip is removed from the "where" question.** Pinning is no longer asked separately — it is
  DERIVED from the prep level (level ≥ 2). A creator can no longer say "no prep at all, but do
  place every mission", because that combination was never coherent.
- **A new FIRST question: what is the occasion.** Birthday · bar/bat mitzvah · wedding ·
  team-building day · youth-movement activity · "something else / not sure" (the default).
  The audience question stays and is still answered separately — the occasion never overwrites it.
- **The occasion changes what gets composed**, three ways: it biases mission fit toward the
  activity kinds that suit the event, it selects the stage blueprint (how many stages, how many
  missions in each, the difficulty curve), and it supplies occasion-specific stage titles instead
  of the generic ones.
- **"בית" (a home) joins the kinds of place the "where" question offers**, classified indoor. Most
  birthday parties and youth-movement activities happen in one, and the list had no way to say so.
- Question count goes from 7 to 8.

### Non-goals

- **The mission bank is NOT re-tagged.** The three prep tags (`noPrep` / `needsSetup` /
  `needsPartner`) stay exactly as they are, and no `occasion` tag is added to any bank entry. The
  5-point scale maps onto the existing three tiers; the occasion is expressed as a bias over
  activity tags that already exist. Re-tagging 200+ bank entries is a separate change.
- **No new bank prep tier for "on-site setup".** Levels 3 and 4 tolerate the same bank tier
  (`needsSetup`); level 4 differs by *biasing* toward located/on-site missions, not by unlocking
  a mission nobody could get at level 3.
- **No change to the other two creation paths.** `scratch` and `guided` (admin templates) are
  untouched. This is the `smart_build` questionnaire and its composer only.
- **No occasion field on the `Game` document.** The occasion is a questionnaire answer that
  shapes composition; it is not persisted as game metadata and is unrelated to `templateGenre`.
- **No callable is added or changed.** Composition is entirely client-side and pure.

## Capabilities

### New Capabilities
- `smart-build-questionnaire`: the smart-build question flow — which questions are asked, in what
  order, what each defaults to, and how the cumulative prep scale and the occasion answer are
  collected and turned into a composer payload.
- `occasion-aware-composition`: how the occasion answer changes the composed game — mission-fit
  bias, stage structure selection, and occasion-specific stage titles.

### Modified Capabilities
<!-- None: no existing spec in openspec/specs/ covers the smart-build path or the composer. -->

## Impact

**Surfaces touched: creator-web only** (pure lib + one component + i18n). No shared types, no
callable, no play-web, no Firestore rules.

- `apps/creator-web/src/lib/smartBuildWizard.ts` — `SMART_BUILD_QUESTION_ORDER` gains `occasion`
  and keeps `prep`; `SmartBuildAnswers.prepEffort` becomes the 1–5 level; `locationMissions`
  stops being an answer and becomes derived; `smartBuildAnswers()` gains the occasion.
- `apps/creator-web/src/lib/composeGame.ts` — `ComposerAnswers` gains `occasion`; blueprint
  selection and stage naming consult it; `fitScore` gains the occasion bias term.
- `apps/creator-web/src/bankTags.ts` — `PREP_LEVELS` / `prepToleranceOf` express the 5-point
  scale over the unchanged three prep tags; a `home` area tag is added to `BANK_TAGS`,
  `AREA_KIND_TAG_IDS` and `AREA_SETTING` (indoor).
- `apps/creator-web/src/components/SmartBuildWizard.tsx` — one new step, the prep step becomes a
  rating control, the location chip is removed from the "where" step.
- `apps/creator-web/src/i18n.ts` — HE + EN copy for the occasions, the five prep levels and the
  occasion stage titles. **`npm run i18n:check:strict` applies** (UI change).
- Tests: `scripts/test-smart-build-wizard.ts` and the composer's pure suites extend; both run in
  `npm test` via the auto-discovering aggregator.

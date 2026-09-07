## Why

The marketing homepage now opens four occasion doors (change: marketing-home-occasion-doors), and
each door leads to a landing page that explains, at length, that the product can do that thing. The
review of that work named the real weakness: **the test is behind the door, not on it.** A visitor
who clicks "activities at home" and is handed three paragraphs and one generic "start building"
button has been told, not shown. They tire and leave.

What converts is arriving at something already made. Not "you can build a game for the living room"
but "**a race to tidy the house**" and "**a couples trivia night**", each one click from being real.

The product can already do this and does not expose it. `composeGame` is a pure function that turns
a set of answers into a launch valid game, drawing from a mission bank where `home` is tagged on 49
of 89 entries and `chores` exists as an activity. A named recipe is nothing more than a **frozen set
of those answers**. The only thing missing is a way to arrive holding one: the creator console
understands exactly one deep link parameter today, `?start=game`, which opens an empty wizard.

Worse, a named card that opens an empty wizard is a promise the click does not keep. The card and
the deep link have to ship together or not at all.

## What Changes

- **A recipe registry.** A new pure module declares each recipe as an id, its display copy per
  language, and a PARTIAL set of composer answers. Partial is the whole design: a recipe answers
  what its own name already settles and leaves the rest open.
- **The questionnaire asks only what the recipe did not settle.** The remaining question set is
  computed from the recipe rather than fixed, so a recipe that already implies who is playing, how
  many, where and roughly how long may ask **nothing at all**, while one that only fixes the
  occasion and setting still asks how many people. A recipe that settles every question composes
  immediately.
- **A deep link contract.** `?start=game&recipe=<id>` opens the creator console holding that recipe.
  Fail closed: an unknown, malformed or absent id yields the ordinary wizard, never an error and
  never a wrong game.
- **Two new occasions in the composer**, `education` and `home`, each with a real profile. The
  door taxonomy and the composer's occasion list did not line up: two of the four doors had no
  matching occasion, so they would have had to pass the neutral `other`, discarding what the visitor
  had just told us. This also improves the ordinary wizard, where those two answers were missing.
- **The landing pages present their recipes as the primary call to action**, above the prose, each
  a real button carrying its own deep link. The generic "start building" CTA stays as the fallback
  for a visitor whose case is none of the offered recipes.
- **Scoped to a stated focus, not to full coverage.** The owner named two priorities for the near
  term (2026-09-05): education (student bonding days, an in session game for a youth group peula)
  and parents (occupying one child, a chores race, a birthday at home or around the neighbourhood).
  The first set of recipes covers exactly those five cases, on the `education` and `home` doors.
  Team building and the mitzvah door keep their generic call to action rather than gaining recipes
  this round — narrowing effort, not narrowing what the product admits.

## Capabilities

### New Capabilities

- `occasion-recipes`: named, frozen composer answer sets, reachable by deep link, that skip every
  question they already answer and compose a launch valid game.

### Modified Capabilities

- `seo-landing-pages`: a landing page requirement that each occasion page offers concrete named
  starting points as its primary action rather than prose plus a generic button.

## Impact

**Surfaces touched:** `apps/creator-web` and the static landing page generator. No callable, no
Firestore rules, no shared types, no play-web runtime code, no backend.

- `apps/creator-web/src/lib/occasions.ts`: two new `OccasionId` values and their profiles.
  **BREAKING for anything that exhaustively switches on `OccasionId`**, which the type system will
  surface at build time. `OCCASIONS` is a total `Record`, so a missing profile is a compile error
  rather than a runtime one.
- `apps/creator-web/src/lib/recipes.ts`: new.
- `apps/creator-web/src/lib/smartBuildWizard.ts`: opening from a partial answer set, and navigation
  over the remaining questions rather than all eight. **This file currently carries substantial
  uncommitted work from an earlier session; this change must build on that state, not revert it.**
- `apps/creator-web/src/lib/creatorOnboarding.ts`: `readRecipeIntent` beside `readStartIntent`.
- `apps/creator-web/src/pages/DashboardPage.tsx` and the wizard components: honour the intent.
- `scripts/lib/landingPages.ts`: a `recipes` block per subject, and the renderer for it.
- `apps/creator-web/src/i18n.ts`: recipe display copy, Hebrew and English.

## Non-goals

- No change to `composeGame` itself. A recipe is input to it, not a change in how it composes.
- No admin authored recipes and no Firestore storage. The registry is code, like the mission bank,
  because a recipe that composes a broken game must fail a gate rather than a creator.
- Nothing about the sign in wall. A visitor still signs in before they get their game; making the
  composed result visible before that is a separate and larger question.
- No new landing page subjects beyond the eight that now exist.

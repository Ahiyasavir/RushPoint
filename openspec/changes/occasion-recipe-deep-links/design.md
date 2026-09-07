## Context

`composeGame(bank, answers, copy, rng, recent)` is pure and already produces a launch valid game.
`SmartBuildAnswers` has eight fields and the questionnaire asks for all eight in a fixed order
(`SMART_BUILD_QUESTION_ORDER`), walking a numeric `index` from 0 to 7. There is no notion of a
question being skipped, and no way to open the wizard part answered.

The creator console understands one deep link parameter, read by `readStartIntent` in
`creatorOnboarding.ts`: `?start=game`, which opens an empty wizard.

The mission bank already supports what the doors promise: `home` is an area tag, `chores` is an
activity tag, and `preferredTagOptions` already hides `chores` unless the creator said `home`.

Two constraints from the existing code are load bearing here and are quoted rather than
paraphrased, because both are the reason a decision below goes the way it does:

- On preparation effort: *"Asked out loud rather than inferred, because the levels differ in KIND,
  not just in amount: the top one means going to a business, paying them, and relying on the owner
  to hand a code to strangers. A creator who wanted to press a button and run a game the same
  evening must never be handed that by default."*
- On the occasion question: it *"deliberately does NOT decide who is playing"*, because inferring
  the audience from the occasion recreates a contradiction the wizard was refactored to remove.

**`apps/creator-web/src/lib/smartBuildWizard.ts` currently carries roughly 860 lines of uncommitted
change from an earlier session, and `taskBank.ts` about 230.** This change edits the same file. Read
the working tree state, build on it, and do not revert it.

## Goals / Non-Goals

**Goals:**

- A visitor clicking a named starting point on a landing page arrives at that specific game, not at
  an empty wizard.
- The questionnaire asks only what the recipe genuinely left open, per recipe, so most recipes ask
  one question and some ask none.
- Every recipe is proven to compose a launch valid game by a gate, not by inspection.
- The composer gains the two occasions the doors already offer and it did not know.

**Non-Goals:**

- Changing `composeGame`.
- Admin authored or Firestore stored recipes.
- Removing the sign in wall between the click and the game.

## Decisions

### A recipe is a PARTIAL answer set, and partial is the whole idea

```ts
interface Recipe {
  id: string;
  names: Record<Language, string>;
  answers: Partial<SmartBuildAnswers>;   // ← declares only what its name settles
}
```

The distinction between "declared" and "defaulted" is the entire mechanism. `smartBuildDefaults()`
already supplies a value for every field; if a recipe merged with those defaults, every question
would look answered and the creator would be handed guesses presented as their own choices. So the
recipe stores a partial, `remainingQuestions(recipe)` derives the open set from which keys are
absent, and defaults fill in only at the point of composing, exactly as they do today for a creator
who taps through.

### Which questions each recipe settles, and why duration is settled but group size usually is not

The instruction driving this is that anything the visitor's own choice reveals should not be asked
again. Applied per field:

| Field | Settled by a recipe? |
| --- | --- |
| `occasion` | Always. The door says it. |
| `areas` | Always. The door or the recipe name says it. |
| `who` | Always. "A couples trivia night" and "a race to tidy the house" are not the same audience. |
| `preferredTags` | Always. It is what makes one recipe different from another under the same door. |
| `difficultyPreference` | Always. A birthday is easy, a team building day is not. |
| `minutes` | Always. An activity has a characteristic length: the end of a lesson is half an hour, a year group trip is a morning. Changeable afterwards in the Builder. |
| `prepEffort` | Only at level 1. See below. |
| `people` | Usually NOT. How many children are at the party is not implied by anything. Declared only where the name genuinely fixes it: a couples evening is two, a class is about thirty. |

So most recipes ask exactly one question, and two ask none.

**Preparation effort may only ever be declared at the lowest level.** The existing comment is
explicit that a creator must never be handed an obligation they did not choose, and a marketing link
is the last place that should happen: someone arriving from an advertisement has agreed to nothing.
Level 1 obliges nothing, so declaring it is safe; any higher level must still be asked. This is an
invariant with a test, not a convention.

### Navigation walks the remaining questions, not the full list

`index` stays an index into a list; the list becomes the remaining questions rather than all eight.
Forward past the end finishes, back past the start leaves, exactly as now. A skipped question is
never reachable by navigation, because it is not in the list being walked.

A recipe answering everything yields an empty list, which is the "compose immediately" case rather
than a special mode.

The creator keeps authority over every answer: a recipe pre answers a question, and the composed
game is then an ordinary game they can edit. Pre answering is not deciding on their behalf
permanently.

### The deep link fails closed, like `readStartIntent`

`readRecipeIntent(search)` mirrors the existing reader: pure, total, and read at module load on
every page view, so a malformed query string must yield "no recipe" rather than throw and take the
app down before it renders. An id not in the registry is not an error state and shows no message; it
is simply not an instruction, and the ordinary wizard opens.

### Two new occasions, profiled rather than copied

| Occasion | Favoured tags | Blueprint | Reasoning |
| --- | --- | --- | --- |
| `education` | `educational`, `thinking`, `teamwork` | 3 stages, weights `[1.0, 1.1, 0.9]`, curve `[3, 5, 7]` | The content sits in the middle stage, where attention is highest and the group has warmed up. The finish is firm but not brutal: this is a lesson, not a competition. |
| `home` | `teamwork`, `thinking`, `creative` | 3 stages, weights `[1.1, 1.0, 0.9]`, curve `[2, 4, 6]` | A flat has few distinct places, so the game leans on the PLAYERS rather than the venue. `action` is deliberately absent: there is nowhere to run. The gentlest opening of any occasion, because a living room game starts cold with no walk to warm anyone up. |

`chores` is deliberately NOT a favoured tag of the `home` occasion. Not every game at home is a tidy
up, and favouring it would push housework into a couples trivia night. The one recipe that wants it
asks for it explicitly through `preferredTags`, which is what that field is for.

`other` stays exactly as it is: no favoured tags, no blueprint.

### The landing page names its own recipes; only the ID is shared

`scripts/lib/landingPages.ts` declares, per subject, a list of `{ id, label, blurb }` in its own
marketing voice, and does NOT import the creator app's registry. The shared contract is the id
alone, asserted by a test.

The alternative, importing `apps/creator-web/src/lib/recipes.ts` into the generator, would make the
public indexed landing pages depend on the creator app's module graph, so a refactor in the app
could break page generation. The cost of the chosen approach is that a recipe's marketing label and
its in app name can drift in wording. That is acceptable: one is an advertisement and the other is a
UI label, they are written for different readers, and the thing that must not drift is which game
you get, which is the id.

### The recipes

**Scoped to the owner's stated focus (2026-09-05): education and parents.** Six recipes across two
doors, not eleven across four. Corporate team building, the couples evening and the mitzvah were
dropped, not because the product cannot do them but because he is not selling them this season.

The other two doors keep their generic call to action. Focus is where effort goes, not what the
product admits: narrowing the DOORS would undo the whole point of the change that added them.

| Id | Door | Settles | Asks |
| --- | --- | --- | --- |
| `student-bonding-day` | education | `education`/school+neighborhood/teens/`teamwork`+`action`/balanced/120m/prep 1 | people |
| `peula-game` | education | `youthGroup`/neighborhood/preteens/`action`+`teamwork`/balanced/30m/prep 1/**20 people** | nothing |
| `keep-kid-busy` | parents | `home`/home/kids/`creative`+`thinking`/easy/30m/prep 1/**1 person** | nothing |
| `home-chores-race` | parents | `home`/home/kids/`chores`+`action`/easy/45m/prep 1 | people |
| `birthday-at-home` | parents | `birthday`/home/kids/`camera`+`creative`/easy/60m/prep 1 | people |
| `birthday-neighbourhood` | parents | `birthday`/neighborhood/kids/`action`+`camera`/easy/90m/prep 1 | people |

Three readings of the owner's words are baked in here and should be corrected if wrong rather than
discovered later:

- **"games in a peula" means a game INSIDE a session, not a whole session.** Hence 30 minutes.
  This also matters beyond the duration: asking a youth leader to run one game inside the session
  they already planned is a far smaller request than asking them to replace the session. The owner
  reported that youth leaders dodged this product repeatedly even when handed a finished game on a
  weekday, so the size of the ask is the variable most worth getting right here.
- **"something to occupy a child" means ONE child playing alone**, not siblings. That makes it a
  solo game rather than a team game, which is a real structural difference. If the composer cannot
  produce a sound single player game, this recipe asks for the count instead of declaring it.
- **A birthday splits into two recipes**, at home and around the neighbourhood, because that is a
  real fork a parent faces and neither answer is inferable from the word "birthday".

## Test strategy

All pure, no emulator. RED first.

**`scripts/test-recipes.ts`** (new, auto discovered by the aggregator):

- *Every recipe composes.* Each recipe's answers, merged with defaults, passed to the real
  `composeGame` against the real `TASK_BANK`, produces a game that passes the same structural
  validation the server enforces on save. **This is the assertion that matters most**: it is what
  stops a recipe advertising a game the bank cannot actually build.
- *Determinism of the guarantee.* Composed with several seeds, so a recipe that only works on a
  lucky draw fails.
- *Partial, not defaulted.* No recipe declares a key equal to the default for a field its name does
  not settle, since that is a guess wearing a declaration's clothes.
- *Preparation is never raised.* Any recipe declaring `prepEffort` declares level 1.
- *Preferred tags are offerable.* Every declared preferred tag is in `preferredTagOptions(areas)`
  for that recipe's own areas, which is what stops `chores` being asked for outside a home.
- *Every occasion exists*, and every area, activity and audience id is a member of its registry.
- *Copy exists in both languages*, neither empty nor identical across languages.
- *Ids are unique and stable shaped* (lower case, hyphenated, no spaces), since they travel in URLs.

**`scripts/test-smart-build-wizard.ts`** (existing, extended):

- `remainingQuestions` returns the full ordered list for an empty recipe, the correct subset for a
  partial one, and an empty list for a complete one.
- Forward from the last remaining question finishes; back from the first leaves.
- A skipped question is unreachable by any sequence of next and back.
- `remainingQuestions` is total: garbage yields the full list rather than throwing.

**`scripts/test-creator-onboarding.ts`** or the onboarding test that already exists:

- `readRecipeIntent` honours a known id, yields null for unknown, empty, malformed and non string
  input, and never throws.

**`scripts/test-landing-pages.ts`** (existing, extended):

- Every recipe id named by any landing page exists in the registry.
- Every occasion page carries at least two recipes, rendered before its first body section.
- Each rendered link carries the recipe id and points at the creator origin.
- The generic call to action is still present, after the recipes.

**Preview verification:** open a recipe link against the local creator console and confirm the
questionnaire shows only the expected questions, that a zero question recipe composes with no
questionnaire, and that an unknown id opens the ordinary wizard with no error.

**Gates:** `npm run verify` in full, plus `npm run seo:build` so the regenerated pages carry the new
buttons.

## Risks / Trade-offs

- **Adding to `OccasionId` breaks exhaustive switches.** → The type system finds them: `OCCASIONS` is
  a total `Record<OccasionId, OccasionProfile>`, so a missing profile is a compile error. Run
  typecheck early rather than at the end.
- **A recipe advertises a game the bank cannot build**, and the failure appears to a creator as an
  empty or lopsided game. → The compose test above, across several seeds, is precisely this guard.
- **Editing `smartBuildWizard.ts` while it carries a large uncommitted change** risks reverting an
  earlier session's work. → Build on the working tree; never restore a remembered version of that
  file.
- **Declaring `minutes` per recipe is a guess about the creator's evening.** → It is a characteristic
  length, not a constraint: the Builder can change it afterwards, and asking would in most cases
  collect a shrug. This is the one field where the inference is weakest, and it is the first thing to
  revisit if composed games come out consistently too long or too short.
- **A visitor still meets a sign in wall** holding a recipe. The recipe survives it or the whole
  gain is lost on the round trip. → The intent is stored the way `markStartIntent` already stores
  its own, session scoped, so it survives the auth redirect. Verify this specifically in preview,
  because it is the single point where the whole feature silently becomes worthless.

## Open Questions

- Should the composed game be previewable before sign in? That removes the last wall between the ad
  and the value, and it is a much larger change (an unauthenticated compose and a throwaway game).
  Named here rather than assumed away.

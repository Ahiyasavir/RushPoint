## Why

A creator who does not like a mission has two options today, and both are expensive: write a
replacement from scratch, or open the library and read through the bank hunting for something
similar. The one thing they actually want to say — *"this slot is right, this mission is not,
give me another one like it"* — is not expressible anywhere in the Builder.

That gap is widest exactly where the product tries hardest. "Compose one for me" hands a creator
eight missions in one gesture; disliking one of them currently costs more effort than the whole
generation did. And a creator who started from a template or from scratch has no access to the
mission bank at all beyond the flat library list, even though the bank is the best content the
product owns.

## What Changes

- A mission gains a **regenerate** action: one press swaps it for a different mission drawn from
  the mission bank, chosen to be as close as possible to the one being replaced on the bank's own
  tag vocabulary.
- **Pressing it again drifts.** A second and third press do not re-roll the same neighbourhood —
  each press excludes everything already offered for that mission (and its near-duplicate family),
  and progressively down-weights the activity kind the creator has already been shown, so the
  suggestions move toward a deliberately different direction instead of circling one.
- **Playability never drifts.** The constraints that describe the creator's world rather than
  their taste — a game with no venue cannot take a location-only mission, a creator who will not
  coordinate with an outside business must not be handed one, an occasion-specific mission needs
  its occasion — stay hard filters at every drift level.
- **The mission's identity and placement survive the swap.** The task keeps its `id` (so any
  sibling's `unlockAfterTaskIds` prerequisite still resolves) and its placement (pin, radius,
  locationless flag) when the incoming mission can accept it. What changes is the mission: its
  title, description, type, interaction, difficulty and duration.
- **It works on any mission, however the game was created** — composed, from a template, from the
  library, or hand-written. The similarity profile is derived from the task itself, so nothing has
  to have been recorded when the mission was created.
- The action is **undoable through the Builder's existing undo**, and therefore asks no
  confirmation: pressing it repeatedly is the intended interaction, and a confirm dialog per press
  would defeat the feature.
- When the bank genuinely has nothing further to offer, the creator is told so and the mission is
  left exactly as it was. Nothing is ever replaced with nothing.

## Capabilities

### New Capabilities
- `mission-regenerate`: swapping one mission for a bank mission chosen by tag similarity, with a
  drift that widens on repeated presses, and the identity/placement preservation rules that make
  the swap safe inside an existing game.

### Modified Capabilities
<!-- None. No existing requirement changes: the composer keeps its own scoring untouched, the
     mission bank's content and tag registry are read-only here, and no stored shape moves. -->

## Impact

**Surfaces touched: `apps/creator-web` only.** No callable, no `packages/shared` change, no
`firestore.rules` change, no participant-facing change.

- **New pure module** `apps/creator-web/src/lib/regenerateMission.ts` — the similarity score, the
  drift model, the candidate choice and the merge that produces the replacement task. Takes the
  bank as a value and the RNG as a seed, exactly as `lib/composeGame.ts` does, so it holds no
  storage handle and no clock.
- **New pure module** `apps/creator-web/src/lib/regenerateHistory.ts` — which bank keys have
  already been offered for a given mission, persisted per creator and game. Reuses the
  soft-failing store shape of `lib/recentBankPicks.ts`: every read degrades to an empty history
  and every write to a no-op, because a browser that refuses storage must still regenerate.
- **Reads, does not change:** `taskBank.ts` (`TaskBankEntry`), `bankTags.ts` (`BANK_TAGS`,
  the group id lists, `difficultyBandFor`), `lib/missionBank.ts` (`loadMissionBank`,
  `missionBankNow`) and `lib/composeGame.ts` (`seededRng`, and the tag-group constants the
  similarity terms are defined against).
- **UI wiring:** the mission card's actions menu (`components/TaskCanvas.tsx`) and the mission
  editor (`components/TaskWizard.tsx`), both routed through `pages/BuilderPage.tsx` so the swap
  goes through the same `setGame` history the undo button already reads.
- **i18n:** new Hebrew + English strings for the action, its result notice and its
  nothing-left-to-offer state. `npm run i18n:check:strict` must stay clean.
- **Storage:** one new `localStorage` key prefix per creator+game, alongside the existing
  `rp-smart-build-recent`.

**Non-goals**

- Not a generator. It draws from the authored mission bank; it invents nothing and calls no model.
- No new callable, no server state, no new Firestore document, no change to what a participant
  receives.
- Does not record a bank origin on the stored `Task`. Adding a field would touch the shared type,
  the save payload allow-list, the game-file format and the participant sanitizer allow-list; the
  similarity profile is derived from the task instead, which also stays truthful after a creator
  edits the mission.
- Does not regenerate a whole stage or a whole game — that is what the smart-build path is for.
- Does not change the composer's scoring, the bank's content, or the tag registry.
- Does not preserve creator edits to the replaced mission. Replacing a mission replaces its text;
  undo is the escape hatch, and the action says so.

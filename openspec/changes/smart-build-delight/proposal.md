## Why

The smart-build path is the one place a creator says "compose a game for me" — it is where the
platform makes its strongest first impression, and it currently makes it as a form. Eight questions
are answered into silence, nothing visible happens while they are answered, and the payoff is a
game that simply appears in the Builder. A creator who has just told us about their event learns
nothing about what we are doing with the answer until it is over, and the moment the game exists —
the single best moment in the flow — is spent on a screen transition.

The fix is not more questions or better questions. It is making the *building* visible while it
happens, and making the finish land.

## What Changes

- **A live build panel** sits beside the questionnaire and grows as answers arrive: stage cards
  fade in, each showing its title and how many mission slots it holds. The slots render as
  **empty skeletons** — the panel shows the game's SHAPE, never which missions were chosen.
- **Shape is planned, not composed.** A new `previewShape(answers, seed)` reproduces only the
  composer's stage-planning steps — mission budget, blueprint, per-stage spread — and stops
  before a single mission is chosen. This is a correctness requirement, not a style choice:
  `composeGame`'s rng draw sequence is documented "DO NOT reorder", and re-composing on every
  answer would visibly shuffle missions in front of the creator. It is also what preserves the
  finale — a panel that already showed the missions leaves the reveal with nothing to reveal.
- **The questionnaire holds one seed.** The stage count is *not* a pure function of the answers:
  unless the occasion supplies a blueprint, the composer picks one **at random**
  (`pickBlueprint(eligible, rng)`). A predicted shape can therefore only match the delivered game
  if both are driven by the same seed. The questionnaire fixes a seed when it opens and hands it
  to both the preview and the composer. Because the blueprint is the composer's *first* draw, the
  preview can take it from a freshly-seeded stream and stop, without disturbing the sequence.
- **The questions become choices, not fields.** Each option renders as an illustrated card
  instead of a text chip, and moving between questions slides rather than swaps. The
  one-question-per-screen structure and the progress bar already exist and are kept.
- **Micro-rewards during the flow**: the progress bar gains a completion ring, and advancing a
  question fires the existing haptic feedback. No new dependency.
- **A cinematic reveal replaces the silent hand-off.** On finish, a full-screen moment fills the
  skeleton slots one at a time with the missions that were actually chosen, proposes the game
  name, fires the existing confetti component, and offers the share card — then hands off to the
  Builder.

### Non-goals

- **No change to what the composer produces.** The same answers yield the same game, mission for
  mission. `composeGame` stays pure, total, language-free and untouched in behavior.
- **No new questions, no reordering, no changed defaults.** The questionnaire's flow, its
  defaults, its totality contract and its back-out signal are exactly as they are today.
- **No server work.** No callable is added or changed, no Firestore document is written, no
  shared type changes. Nothing about this reaches the backend.
- **Not a preview of mission content.** The panel deliberately never shows which missions were
  picked before the reveal.
- **No AI generation**, no free-text event description, no "surprise me" randomiser — those were
  considered and are out of scope here.

## Capabilities

### New Capabilities
- `smart-build-live-preview`: a running visual of the game's shape — stages and empty mission
  slots — that grows as the questionnaire is answered, derived without composing the game.
- `smart-build-question-presentation`: the questionnaire's options render as illustrated choice
  cards with animated transitions, a completion ring and haptic acknowledgement on advance.
- `smart-build-reveal`: the finish moment — skeleton slots filling with the chosen missions, a
  proposed name, celebration and a share card — before the Builder is opened.

### Modified Capabilities
<!-- None. The two existing smart-build specs (smart-build-questionnaire,
     smart-game-composer) are unarchived deltas, not yet in openspec/specs/, and this change
     alters neither's requirements: the flow, defaults and composed output are unchanged. -->

## Impact

**Surface: `apps/creator-web` only.** No callable, no `functions/`, no `packages/shared`, no
`firestore.rules`, no play-web.

- **New** `apps/creator-web/src/lib/previewShape.ts` — pure, total, language-free (copy injected,
  same contract as `composeGame`/`describeNewGame`). Returns a stage/slot shape for any answers,
  including defaults and malformed input.
- **New** `scripts/test-preview-shape.ts` — auto-discovered by the `npm test` aggregator. Must
  assert the shape it predicts matches what `composeGame` actually builds for the same answers,
  or the skeletons will not match the reveal.
- **New** components for the live panel, the choice cards and the reveal, under
  `apps/creator-web/src/components/`.
- **Modified** `SteppedWizard.tsx` — gains the completion ring and transition. Stays
  presentational and copy-free; it must not learn anything about games or missions.
- **Modified** the smart-build host screen — lays out the questionnaire beside the panel, and
  routes the finish through the reveal instead of straight to the Builder.
- **Reused, not rebuilt**: the existing confetti component, the existing haptics helper, and the
  existing share-card surface.
- **Gates**: this is a UI change, so `npm run i18n:check:strict` is mandatory and must add zero
  new PART B findings. All new copy routes through `t.*`. `npm run bundle:budget` applies to
  play-web only and is unaffected; `npm run creator:build` must stay green.
- **Risk 1 — drift**: `previewShape` reproducing the composer's stage-planning logic is the one
  place this can rot. The shared test above is what holds it: a shape that disagrees with the
  composer shows the creator a game that is not the one they get. Both must be driven from the
  same seed in that test, or it asserts nothing.
- **Risk 2 — dropped slots**: the composer drops a planned slot whose candidate pool is exhausted
  (`composeGame.ts:1323`), so the delivered game can hold fewer missions than were planned. The
  panel plans; the reveal reconciles by retiring the slot visibly. The preview must never claim
  to be the final count.

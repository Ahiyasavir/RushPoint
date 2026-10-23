# Tasks: setup-flow-full-screen

## 1. RED
- [x] 1.1 `scripts/test-setup-flow.ts`: screens per mission in order, game steps first; bilingual
      split; prep/fill over the WHOLE bank (every prep prompt named); a configured prep step needs no
      input; the before-the-game list; completion per screen; nothing in the output is folded.
- [x] 1.2 Same file: `setupFlowSteps` gives a card to every station code, quiz answer, number and
      order (even when the bank filled it), and to every blank in a title, description, hint or clue;
      a photo mission asks for nothing; answer-outcome missions are left to their editor.
- [x] 1.3 `scripts/test-setup-sounds.ts`: every sound defined, the frequent ones quietest and
      shortest, the finish the longest, nothing loud, never throws with no audio.

## 2. GREEN
- [x] 2.1 `lib/setupFlow.ts`.
- [x] 2.2 `SetupFlow.tsx` + `bare` guided editor + copy (HE/EN) + motion.
- [x] 2.3 The composer opens it before the builder (the separate reveal is gone: the plan IS the
      "your game is ready" moment); no tour on top.
- [x] 2.4 `setupFlowSteps` in `lib/quickSetup.ts`: runs for every game, adds completion and
      sentence cards.
- [x] 2.5 "Another mission" (the builder's swap, lifted to module scope), shorter "edit myself",
      "let's finish it" walks only the open items.
- [x] 2.6 Order missions: numbered rows, move up and down, remove; at least three.
- [x] 2.7 Look: warm canvas with contour lines, glass header and footer, a floating card on desktop,
      the mission as a ticket with its type drawn; larger type throughout; portalled to the body.
- [x] 2.8 Motivation: readiness percent that counts the build as done (endowed progress), "N more"
      near the end (goal gradient), a cheer per finished stage, a saved mark and a glowing Next when a
      field fills, the finish counted up with confetti (peak-end), a time estimate on the plan.
- [x] 2.9 Sound: `lib/setupSounds.ts` (zzfx, loaded on the first sound), mute in the header.
- [x] 2.10 Bank: a prep card for the three missions whose teams cannot be sure to have pen and paper.

## 3. Verify
- [ ] 3.1 `npm run verify`.
- [x] 3.2 Browser at 390x844 and 1440x900: composed games end to end (Playwright screenshots).
- [ ] 3.3 Reduced motion on, and a real phone with sound.

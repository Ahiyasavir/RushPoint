## 1. RED — the shape contract, before any production code

- [x] 1.1 Write `scripts/test-preview-shape.ts` asserting that, for a fixed seed,
  `previewShape(TASK_BANK, answers, seed)` and `composeGame(TASK_BANK, answers, copy,
  seededRng(seed), recent)` agree on stage count, stage order and per-stage planned mission
  count — across a matrix of occasions × who × durations × prep levels × difficulty. **Both sides
  must be driven from the SAME seed**; a test that seeds them differently asserts nothing.
- [x] 1.2 Extend it with the totality cases: questionnaire defaults, partially answered state,
  malformed/out-of-range answers, and a missing or malformed seed — each returns a shape or the
  explicit no-shape result, never a throw.
- [x] 1.3 Extend it with: `previewShape` selects no missions (its result carries no bank key);
  same answers + same seed yields an identical shape twice; `composeGame` under one seed twice
  yields identical `usedBankKeys`; answers the composer refuses yield `possible: false`.
- [x] 1.4 Run `npm test` and confirm the new file fails for the right reason — `previewShape` does
  not exist yet — and that no other suite fails.

## 2. GREEN — one planning function, shared by preview and composer

- [x] 2.1 Extract the stage-planning steps of `composeGame` (`targetTaskCount` →
  `eligibleBlueprints` → synth fallback → `pickBlueprint` → `occasionBlueprint` →
  `distributeTaskCounts`) into an internal `planStages(bank, answers, rng, recentKeys)` in
  `apps/creator-web/src/lib/composeGame.ts`, returning `{ blueprint, counts, usable, budget }`.
  **Do not reorder any rng draw** — the blueprint draw must stay first and unconditional.
- [x] 2.2 Rewrite `composeGame` to call `planStages` and continue into slot-filling from its
  result. Run `npm test`: `test-composer-validators` and `test-smart-build-wizard` must pass
  **unmodified** — that is the proof the extraction changed no behaviour.
- [x] 2.3 Add exported `previewShape(bank, answers, seed)` calling `planStages` with
  `seededRng(seed)` and stopping before slot-filling. Return the stage/slot shape plus
  `possible`, carrying no mission identity and no user-facing copy.
- [x] 2.4 Thread the real recent picks into the preview path (design D4) so the shape is not built
  on a budget that disagrees with the composer for a returning creator.
- [x] 2.5 Run `npm test` and confirm `scripts/test-preview-shape.ts` is green.

## 3. GREEN — the seed reaches the composer

- [x] 3.1 Add `seed: number` to `SmartBuildState` in `apps/creator-web/src/lib/smartBuildWizard.ts`,
  drawn once in `initialSmartBuildState()`, preserved by every reducer action and by `safeState`.
- [x] 3.2 Extend `scripts/test-smart-build-wizard.ts`: the seed survives navigating backwards and
  forwards and every `setAnswer`/toggle action; a fresh `initialSmartBuildState()` can differ.
- [x] 3.3 Widen `onFinish` to `(answers, seed)` in `SmartBuildWizard.tsx` and swap
  `Math.random` for `seededRng(seed)` at the `composeGame` call in
  `apps/creator-web/src/pages/DashboardPage.tsx`.
- [x] 3.4 Run `npm test` + `npm run typecheck` and confirm green.

## 4. The live shape panel

- [x] 4.1 Add the panel component under `apps/creator-web/src/components/` rendering stage cards
  with **empty placeholder slots only** — no mission title, description, type, media or location.
- [x] 4.2 Render it in `SmartBuildWizard.tsx` beside the `SteppedWizard` shell (not inside it),
  fed by `previewShape(TASK_BANK, smartBuildAnswers(state), state.seed)`.
- [x] 4.3 Handle the no-shape result with the panel's empty state; the questionnaire must stay
  fully usable and finishable when no shape can be derived.
- [x] 4.4 Layout: trailing column on wide viewports, scrollable strip above the question on narrow
  ones. Verify no horizontal page scroll at 390px.
- [x] 4.5 Route every panel string through `t.*` in `apps/creator-web/src/i18n.ts` (Hebrew +
  English).

## 5. Question presentation

- [x] 5.1 Draw one inline-SVG illustration component per option under
  `apps/creator-web/src/components/illustrations/` — flat, geometric, themed through
  `currentColor` / `--ink-*` / `--surface-*`, `aria-hidden`, and **no text inside the artwork**
  (SVG text would bypass `t.*` and be invisible to the i18n gate).
- [x] 5.1b Add the choice-card component (illustration + label, visible selected state not
  conveyed by colour alone) and use it for the single-choice questions in place of `ChipRow`.
- [x] 5.2 Keep the multi-select questions multi-select on the new cards; confirm both selections
  still reach the composer payload.
- [x] 5.3 Add the completion ring to `SteppedWizard.tsx` alongside the existing step text, exposing
  current/min/max to assistive technology. The shell stays presentational and copy-free.
- [x] 5.4 Add the question in/out transition, disabled under `prefers-reduced-motion`.
- [x] 5.5 Fire the existing haptics helper on advance; confirm a device without haptic support
  advances normally and raises nothing.

## 6. The reveal

- [x] 6.1 Add the reveal component: fills the panel's slots one at a time with the composed
  missions, shows the proposed game name, fires the existing confetti component, offers the
  existing share surface, and exposes a "continue to the Builder" action available at any point.
- [x] 6.2 Retire any slot the composer dropped (exhausted pool) visibly, rather than leaving a
  placeholder that never fills.
- [x] 6.3 Route the finish in `DashboardPage.tsx` through the reveal before navigating to the
  Builder; the game is still created exactly as it is today.
- [x] 6.4 When `composeGame` returns null: do not show the reveal, tell the creator, and fall back
  to the existing blank-game path.
- [x] 6.5 Honour `prefers-reduced-motion` (present the finished game without the fill animation),
  make every control keyboard-reachable with an accessible name, and route all copy through `t.*`.

## 7. Gates

- [x] 7.1 Run `npm run i18n:check:strict` and confirm it is clean — **zero** new PART B
  hardcoded-string findings from any component added or changed here.
- [x] 7.2 Verify in the browser preview: panel present on question 1 and updating as answers
  change; slots empty until the reveal; 390px layout with no horizontal scroll; reduced-motion
  path; keyboard-only pass through questionnaire and reveal; Builder opens after the reveal.
  ✅ Full run against the seeded emulator (demo-creator): panel appeared on Q1 with ordinal
  "משימה שתיחשף בסוף" slots and tracked every answer live through Q8 (5/6/6/5 stages); difficulty
  and preferred-tags cards each carry their own `aria-hidden` SVG (ChoiceArt); createGame +
  updateGame both 200'd; reveal showed the SAME 5/6/6/5 shape now filled with real mission names
  (ConfettiBurst rendered, 29 elements); "לעריכת המשחק" opened the Builder with zero console
  errors. 390px: zero horizontal scroll on the title step, the questionnaire+panel step, and the
  Builder. All 6 choice cards are native `<button role="radio">` — keyboard-operable with no
  tabindex hacks. (Visual screenshot compositing was unavailable in this session's browser pane;
  verified via DOM/accessibility-tree/network inspection instead, which is sufficient to confirm
  the properties this task lists.)
- [x] 7.3 Run `npm run verify` (typecheck · lint · test · creator:build · play:build ·
  bundle:budget · base:check · origin:check · i18n:check:strict) and confirm all green.
  ✅ Confirmed green (all 10 sub-tasks, 233/233 pure-logic suites, 0 lint errors).
- [x] 7.4 Run `npm run e2e` and confirm it is still green (no callable changed, so it must be
  unaffected). ✅ Run on the isolated `RUSHPOINT_EMULATOR_PORT_OFFSET=1000` lane (a second
  agent held the default block); 1479/1479 PASS, exit 0, callable coverage guard clean.

## 8. Blocked — shared working tree

- [x] 8.1 ⚠️ RESOLVED — the blocking `listMyRuns` / run-history session's work landed as
  commit `3df108b` before this run picked the change back up (its WIP had been stashed by a
  third session "held during production deploy" and was recovered via `git stash pop`). The
  tree was clean, so 7.3/7.4 ran directly and 7.2 ran after clearing two confirmed-stale
  processes (an orphaned Firestore JAR and an `--only auth` emulator whose owning session
  confirmed it wasn't needed). Original blocker description, for the record:
  · 7.2 needs a dev stack, but an emulator suite on the default port block is
    already live and owned by that session; booting a second one on the same
    ports is the hub-locator conflict `scripts/lib/emulatorIsolation.mjs`
    documents. Stale Vite processes from 2026-08-24 also hold 5180/5181/5185 and
    no longer answer HTTP.
  · 7.3 `npm run verify` rewrites `packages/shared/dist` IN PLACE — CLAUDE.md
    forbids running it while another gauntlet shares the tree.
  · 7.4 `npm run e2e` needs the functions emulator (5001 is currently free, i.e.
    not running) and would contend for the same suite.
  Resolve by running them once the tree is quiet, or via the port-offset lane
  (`RUSHPOINT_EMULATOR_PORT_OFFSET=1000`).

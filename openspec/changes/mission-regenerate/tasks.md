## 1. The outgoing mission's tag profile

- [x] 1.1 RED — create `scripts/test-mission-regenerate.ts` with failing assertions for
  `missionTagProfile(task)`: a photo mission yields the camera activity tag; a quiz/numeric/
  sequence mission yields thinking; a locationless mission yields `fromAnywhere` and not
  `locationBased`; a placed mission yields `locationBased`; difficulty 8 yields the `hard` band;
  a mission that declares no audience yields no audience tag. Run it, confirm it fails because the
  module does not exist yet.
- [x] 1.2 GREEN — create `apps/creator-web/src/lib/regenerateMission.ts` exporting
  `missionTagProfile`, the minimum needed to pass 1.1. No React, no Firebase, no storage, no clock.
- [x] 1.3 RED — add totality assertions: `null`, `undefined`, `{}`, and a task whose `type`,
  `difficulty` and `locationless` are wrongly typed each return a profile and never throw.
- [x] 1.4 GREEN — make derivation total.
- [x] 1.5 REFACTOR — express the derivation against the exported group lists in `bankTags.ts`
  (`ACTIVITY_TAG_IDS`, `DIFFICULTY_TAG_IDS`, `difficultyBandFor`) rather than restating any tag id
  inline; re-run 1.1–1.3 green.

## 2. Similarity scoring

- [x] 2.1 RED — failing assertions for `similarityScore(entry, profile, drift = 0)`: a candidate
  carrying exactly the profile's tags scores strictly higher than one carrying none; the
  `SIMILARITY_WEIGHTS` terms sum to 1 (asserted through the exported constant, never a literal).
- [x] 2.2 GREEN — implement `SIMILARITY_WEIGHTS` and `similarityScore` for the six terms named in
  design D3 (activity, location, difficulty, setting, area, audience).
- [x] 2.3 RED — failing assertions for the neutral rule: when the profile declares no area, every
  candidate receives the same area contribution, and a candidate carrying area tags does not
  thereby outrank one carrying none. Same for setting and audience.
- [x] 2.4 GREEN — implement `NEUTRAL_MATCH` and apply it to every dimension the profile is silent
  on.
- [x] 2.5 REFACTOR — extract the per-dimension match into one helper driven by the group lists, so
  adding a dimension is a table entry rather than a new branch; re-run 2.1–2.3 green.

## 3. The drift model

- [x] 3.1 RED — failing assertions for `activityDriftMultiplier(level)`: `1` at level 0, `0.5` at
  1, `0` at 2, `-0.5` at 3, `-1` at 4 and at 5 (clamped), and a total answer for a negative,
  fractional, `NaN` or non-numeric level.
- [x] 3.2 GREEN — implement `ACTIVITY_DRIFT_STEP` and `activityDriftMultiplier`.
- [x] 3.3 RED — failing assertion that drift changes the ORDER: build two candidates where the
  same-activity one wins at level 0, and assert the different-activity one wins at level 4.
- [x] 3.4 GREEN — apply the multiplier to the activity term inside `similarityScore`.
- [x] 3.5 REFACTOR — confirm level 0 reproduces pure similarity exactly (assert level-0 scores are
  unchanged by the drift code path), so a first press is provably the closest match.

## 4. Playability context and hard filters

- [x] 4.1 RED — failing assertions for `regenerateContext(game, task)`: a game whose every mission
  is locationless yields the `fromAnywhere` setting; a game with any placed mission does not; the
  default prep tolerance excludes `needsPartner`; the occasion is absent.
- [x] 4.2 GREEN — implement `regenerateContext`, total against a malformed game.
- [x] 4.3 RED — failing assertions that each hard filter excludes at drift level 0 AND at a high
  drift level: a location-only candidate in a `fromAnywhere` game; a candidate declaring
  `occasions` when the occasion is unknown; a `needsPartner` candidate under the default tolerance;
  and the outgoing mission's own bank entry when it is identifiable.
- [x] 4.4 GREEN — apply the hard filters ahead of any arithmetic, mirroring `fitScore`'s ordering.
- [x] 4.5 REFACTOR — assert by construction that no drift level can relax a hard filter (loop the
  filter assertions over levels 0..6).

## 5. Choosing a candidate

- [x] 5.1 RED — failing assertions for `seedFor(taskId, drift)`: same inputs give the same seed,
  different drift levels give different seeds, and short ids that differ by one character do not
  collide (an exhaustive sweep over a small id space, per the hash lesson in CLAUDE.md).
- [x] 5.2 GREEN — implement `seedFor` with an FNV-1a mix, never a djb2/Bernstein roll.
- [x] 5.3 RED — failing assertions for `chooseRegeneratedMission({ bank, profile, context, drift,
  offeredKeys, seed })`: identical inputs return an identical key; an already-offered key is never
  returned; an entry sharing a `family` with an offered key is never returned.
- [x] 5.4 GREEN — implement the chooser on top of `pickFromBand` + `seededRng` from
  `composeGame.ts`, reusing `TOP_K_MARGIN` rather than a new band constant.
- [x] 5.5 RED — failing assertions for exhaustion: a pool where every eligible entry has been
  offered returns a candidate anyway (history relaxed); a pool with no playable candidate returns
  `null`.
- [x] 5.6 GREEN — implement the two-pass exhaustion path of design D6.

## 6. Applying the replacement

- [x] 6.1 RED — failing assertions for `applyRegeneratedMission(outgoing, incoming)`: the id is
  preserved; a sibling's `unlockAfterTaskIds` naming the outgoing id still resolves after the swap;
  a placed outgoing mission keeps its coordinates and geofence radius when the incoming mission can
  be placed; a from-anywhere incoming mission yields a locationless task with no pin; the benched
  (`hidden`) flag and `unlockAfterTaskIds` survive; the title/description/type/interaction come
  from the incoming mission.
- [x] 6.2 GREEN — implement `applyRegeneratedMission`.
- [x] 6.3 RED — failing assertion that the produced task passes the same structural validation the
  Builder's autosave will hit, for every task type the bank can produce.
- [x] 6.4 GREEN — fix whatever 6.3 exposes.

## 7. The offered-key history

- [x] 7.1 RED — create `scripts/test-regenerate-history.ts` with failing assertions: the key is
  scoped per uid, per game and per mission; two missions in one game keep separate histories; a
  throwing `getItem` yields an empty history; a throwing `setItem` is a no-op that still returns;
  malformed JSON and wrong-shaped JSON are treated as empty; the retained list is capped.
- [x] 7.2 GREEN — create `apps/creator-web/src/lib/regenerateHistory.ts` taking a `PicksStore`-
  shaped parameter, modelled on `lib/recentBankPicks.ts`.
- [x] 7.3 REFACTOR — confirm the module reaches `localStorage` only through the injected store, so
  every failure case in 7.1 is a fixture rather than a global patch.

## 8. Builder wiring

- [x] 8.1 Add `regenerateTask(stageId, taskId)` to `pages/BuilderPage.tsx`: read the bank through
  `missionBankNow()` and kick `loadMissionBank()` without awaiting it; build the profile and
  context; read the history; choose; apply; commit through the same `setGame` path the undo control
  reads; record the offered key.
- [x] 8.2 Handle the `null` result: leave the mission untouched and surface the
  nothing-further-to-offer notice.
- [x] 8.3 Verify by hand that undo restores the original mission (the swap must be one history
  entry, not two).

## 9. UI and i18n

- [x] 9.1 Add the regenerate action to the mission card's actions menu
  (`components/TaskCanvas.tsx`), wired through `BuilderPage`.
- [x] 9.2 Add the same action to the mission editor (`components/TaskWizard.tsx`).
- [x] 9.3 Add the Hebrew and English strings to `apps/creator-web/src/i18n.ts` — the action label,
  its accessible name, the replaced notice and the exhausted notice. No hardcoded strings; no
  hyphen or dash in any copy (`scripts/test-no-dashes.ts`).
- [x] 9.4 Confirm every new glyph-only control declares a real tap target from
  `lib/interaction.ts` (`scripts/test-creator-tap-targets.ts`).

## 10. Verification in a real browser

- [x] 10.1 Regenerate from the card menu and from the editor; confirm the mission is replaced and
  the card re-renders.
- [x] 10.2 Press regenerate five times on one mission; record each replacement and confirm no key
  repeats and that the later ones are a visibly different kind of mission.
- [x] 10.3 Confirm undo restores the original mission exactly.
- [ ] 10.4 Confirm a placed mission keeps its pin, and that a from-anywhere replacement drops it.
- [ ] 10.5 Confirm the exhausted-pool notice by regenerating until the pool runs out (or with a
  temporarily narrowed fixture bank), and confirm the mission is unchanged.

## 11. Gates

- [ ] 11.1 Run `npm run verify` and confirm all nine gates are green — including the two new pure
  suites (auto-discovered by `scripts/run-unit-tests.mjs`) and `npm run i18n:check:strict` with no
  new hardcoded-string findings.
- [ ] 11.2 Confirm `scripts/e2e-verify.mjs` is deliberately untouched (no callable added) and state
  that in the change summary, so the omission reads as a decision.

## 1. RED

- [x] 1.1 `scripts/test-composer-siting.ts`: `bankSiting` derivation (explicit wins; locationBased ⇒ must; fromAnywhere ⇒ possible; else never); every annotation names a real key and a known spot.
- [x] 1.2 Over a fixed answer sample at prep level 2: no stage has more than one invented pin; a stage with a `must` mission has none; a `never` mission is never sited; mean location steps per game ≤ 5 (print the before/after numbers).
- [x] 1.3 `previewPrepCost`: zero when not placed; the planned stage count when placed; never throws. Run it and watch it fail.

## 2. GREEN

- [x] 2.1 `siting` + `spot` on `TaskBankEntry`; `bankSiting`; `siteableInPlacedGame` reads it.
- [x] 2.2 Station anchoring in `composeGame` step 8 (anchor chosen after the fill, so the chosen missions do not move); the spot named in the step prompt.
- [x] 2.3 Annotate the bank (`never` and `spot`).
- [x] 2.4 `previewPrepCost` + the live line under the prep question; i18n HE + EN.
- [x] 2.5 Update `scripts/test-composer-wizard-steps.ts` where it assumed a pin per mission.

## 3. Verify

- [x] 3.1 Browser: the questionnaire at 375px shows the cost line at prep 2; the composed game opens with about one pin per stage.
- [x] 3.2 Gates: `npm run verify` green, `npm run i18n:check:strict` clean.

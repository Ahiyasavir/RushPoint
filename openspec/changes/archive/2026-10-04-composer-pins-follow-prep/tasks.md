## 1. RED

- [x] 1.1 Rewrite `scripts/test-composer-siting.ts`: at prep 2 every `possible` mission is sited, none `never`; prep 1 sites nothing; the 15 riddle/trivia keys are `possible`; conversations and chores stay `never`; `previewPrepCost` matches the composed pins. Run it, watch it fail.

## 2. GREEN

- [x] 2.1 `composeGame` step 8 sites every `possible` mission of a placed game.
- [x] 2.2 Remove `siting: 'never'` from the 15 riddle and trivia missions.
- [x] 2.3 `previewPrepCost` counts planned pins.
- [x] 2.4 Plan doc part D items 8 and 9 record Ahiya's answer.

## 3. Verify

- [x] 3.1 Gates: `npm run verify` green.

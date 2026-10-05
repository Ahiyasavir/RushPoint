## Why

Ahiya, 2026-10-04, on the station default chosen overnight (plan part D item 8): a creator who
picks "רק מיקומים" or any higher level on the prep scale has CHOSEN to invest in locations and
expects to place them. Giving such a creator one pin per stage second-guesses an answer they gave
on purpose. The simple rule is the one the scale already promises ("נדריך אתכם לסמן לכל משימה
נקודה על המפה"): level 1 = no pins, level 2 and up = a pin for every mission a place can help.

He also rejected item 9 in part: riddles and trivia CAN have a place (a riddle at a fountain is
a good station). Only conversations, team pacts, personal and household missions keep
`siting: 'never'`.

## What Changes

- At prep level 2 and up, every `possible` mission in a placed game gets a pin and a Quick Setup
  location step, as before composer-siting-by-station. The one-station-per-stage rule is removed.
- The 15 riddle and trivia missions lose `siting: 'never'` (they become `possible` again).
- The questionnaire's cost line counts the planned pins (missions a place can help), not stages.
- Kept from the earlier change: `siting: 'never'` for conversations and chores, the spot kind in
  the location prompt, and the cost line itself.

## Impact

- `apps/creator-web/src/lib/composeGame.ts`, `apps/creator-web/src/taskBank.ts`,
  `scripts/test-composer-siting.ts`, the plan doc part D.
- No server, no stored data: only games composed from now on.

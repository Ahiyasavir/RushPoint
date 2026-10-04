## Decisions

### D1. What stays in sight
Hold / release, because it decides whether a team can play at all and the existing card
comment says it must never be hidden behind another tap. Clear-out-of-bounds and let-in,
because they appear only when the team is in that state and each is the one thing a marshal
came to do. Everything else is a deliberate adjustment and can cost one tap.

### D2. One toggle, per card, local state
`actionsOpen` lives in each `TeamOpsCard`. Closed by default. The toggle is a real button with
`aria-expanded` and a 44px target. No global "expand all": a marshal works one team at a time.

### D3. A panel being used keeps the actions open
If `openPanel` is set (amount, hold reason, assign, send back), the actions area is shown
regardless of the toggle, so closing the toggle can never drop half-typed input.

### D3b. The toggle hides while a panel is open
A toggle that cannot close a panel with input in it would be a dead press, so while a panel is
open the toggle is not rendered; the panel closes with its own cancel.

### D4. The decision is pure
`hasMoreActions(acts)` in `lib/staffTeamActions.ts`: true when score, assign, skip or send back
is available. No "פעולות" button when it is false.

## Risks
- Score steps cost one more tap. Accepted by Ahiya; the frequent cases (finding a team, holding
  it, clearing a safety alert) got faster.

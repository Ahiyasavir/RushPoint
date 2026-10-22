# Composer v2, phase 0: the timer starts on arrival, and regenerate is visible

## Why
Plan: docs/composer-v2-plan-2026-10-22.md, phase 0.

1. A mission's `timeLimitMinutes` counts from the moment the team is GIVEN the mission
   (`RunTaskRecord.startedAt`). For a located mission, the team first has to walk to the pin, so
   the walk eats the clock: a 3 minute mission whose pin is 4 minutes away is lost before it
   opens. The founder: "שאם יש משימה עם טיימר אז שלא חצי מהזמן ילך להם על ללכת לאזור".
2. Regenerate (change: mission-regenerate) works, but it sits inside the card's "⋯" menu, with no
   feedback that anything changed and no visible way back. The founder wants "כפתור בולט",
   "באפקט יפה", that makes a creator enjoy building.

## What changes
- A located mission that is sealed until arrival (`arrivalGateApplies`) counts its time limit
  from the team's arrival (`RunTaskRecord.arrivedAt`). Before arrival there is no countdown and
  the sweep never closes it. Every other mission keeps counting from `startedAt`.
- A staff hold and a flash-mission suspension move `arrivedAt` forward by the pause, exactly as
  they already move `startedAt`.
- Every mission card in the Builder shows a regenerate button (dice icon) beside its menu. A
  press swaps the mission, plays a short spin on the card (none under reduced motion), and shows
  a toast "הוחלפה" with an undo action that runs the Builder's existing undo.
- `toast` gains an optional action button.

## Not in scope
Zones, diversity, ratings, learning, sentence-form setup (later phases of the plan).

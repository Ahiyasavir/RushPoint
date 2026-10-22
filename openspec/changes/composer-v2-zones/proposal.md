# Composer v2, phase 1: areas from the pins, one stage per area

## Why
Plan: docs/composer-v2-plan-2026-10-22.md, phase 1. A stage opens every mission at once, so a stage
holding a pin in the park and a pin in the city centre sends teams back and forth. The founder: "שלא
ילכו הלוך חזור", and he ruled out asking creators about areas ("מאיפה תשיג מידע על כל סיכה?").

## What changes
- `apps/creator-web/src/lib/zonePlan.ts` (pure): clusters the pins the creator already placed
  (single-linkage, 250 m), orders the areas into a walking route (nearest neighbour + 2-opt, opener's
  area first, finale's area last), and regroups the game one stage per area. Pin-less missions follow
  the located mission before them. A far area (> 400 m) opens with a geofence arrival mission and the
  area's other missions unlock after it (`unlockAfterTaskIds`). Quick Setup steps follow their mission.
- The Builder offers it ("המשימות שלכם פזורות ב N אזורים", "סדרו לפי אזורים") only when it would move
  something, and the swap is undoable through the Builder's history.
- Hands off: a game with an authored unlock gate or exclusive group is never rewritten.

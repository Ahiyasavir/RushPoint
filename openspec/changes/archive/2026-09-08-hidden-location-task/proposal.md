## Why

Creators want a true treasure-hunt mechanic: a task whose location is **not** shown on the
participant's map — the player is guided only by a written clue and discovers the spot by physically
arriving there. Today every located task drops a visible pin (the player just walks to the marker),
so the "find it from a riddle" experience is impossible. This change adds a first-class **hidden
location** option to any located task.

## What Changes

- A creator can mark a located task's location as **hidden**. The task keeps real coordinates and a
  geofence radius (server-side), but those coordinates are **never** sent to the participant.
- A creator can author a **location clue** (the visible riddle/hint that guides the player) —
  bilingual EN/HE. This is distinct from the existing *paid* `hint` (which stays a point-cost reveal).
- The participant app **suppresses the map pin** for hidden-location tasks and shows the clue + a
  "hidden location" badge instead of a distance/direction to a marker.
- On physical arrival (server-validated GPS within the geofence — the existing `radius`/`exact`
  gate), the task **reveals success** ("you found it!") and completes. Default behavior: arrival =
  complete (a plain "reach this hidden location" task).
- The server **GPS-gate error for a hidden task does not leak the distance** ("keep following the
  clue" instead of "60m away"), so players can't triangulate the spot by polling `completeTask`.
- `sanitizeTaskForParticipant` strips `coordinates` (and the exact radius) from hidden-location
  tasks, exposing only the clue text, a `locationHidden: true` flag, and the existing `hasHint`.

## Capabilities

### New Capabilities
- `hidden-location-task`: a located task whose coordinates are server-secret and hidden from the
  participant map; the player is guided by a creator-authored clue and the task is gated/revealed by
  server-validated physical arrival.

### Modified Capabilities
- `task-trigger-modes`: the `completeTask` proximity gate SHALL suppress the distance figure in its
  rejection message when the task's location is hidden (non-leaking error), while still validating
  GPS server-side exactly as for `radius`/`exact`.

## Impact

- **Shared types** (`packages/shared/src/types/index.ts`): add `Task.hideLocation?: boolean` and
  `Task.locationClue?` / `locationClueHe?` (clue text). Add validation helpers as needed.
- **Callable** (`functions/src/runs/index.ts`): extend `sanitizeTaskForParticipant` to strip
  coordinates/radius for hidden tasks and emit `locationHidden`; adjust the `completeTask` GPS-gate
  error to be non-leaking for hidden tasks. No new callable — reuses `completeTask`/`getMyTeamState`.
- **Validation** (`packages/shared/src/validation.ts` / `functions` game write path): a hidden task
  MUST still have valid coordinates + a radius; SHOULD have a non-empty clue.
- **Creator UI** (`apps/creator-web` Builder / `TaskWizard` / `LocationStep`): a "hide location on
  map" toggle + a clue field; i18n strings (EN/HE) via `t.*`.
- **Participant UI** (`apps/play-web` `TaskRunner` / `NavMap`): suppress the pin, render the clue +
  hidden badge, show the arrival "found it" reveal.
- **Tests**: pure-logic for the sanitizer + non-leaking gate (`scripts/test-*.ts` or co-located
  vitest); extend `scripts/e2e-verify.mjs` with a hidden-location task (join → too-far reject with
  no distance → arrive → reveal/complete). i18n gate for the new UI strings.

## Non-goals

- No "hot/cold" proximity meter or directional arrow toward the hidden spot (explicitly the opposite
  of this feature — arrival is the only signal). A distance-feedback variant is future work.
- No new task **type** — `hideLocation` is an orthogonal flag layered on existing located tasks
  (`field`/`geofence`/station types using `radius`/`exact`), not a `TaskType` member.
- No change to scoring, routing weights, or the paid-`hint` mechanic.
- No multi-stage "unlock a chain of clues" authoring beyond a single per-task clue.

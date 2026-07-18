# Proposal: hidden-location-leak-guard

## Why

A family playtest exposed a hole in the **hidden-location** (treasure-hunt) mechanic. When a
creator marks a task's location as hidden (`hideLocation: true`), the sanitizer correctly strips
`coordinates` + the geofence radius so no map pin is drawn — the player is meant to find the spot
from the `locationClue` alone. **But the task's `title` and `description` are still sent to the
participant** (they must be, so the player knows what to do), and creators routinely name the place
right there ("Meet at the Old City fountain", "המשימה ברחוב יפו"). The player reads the answer off
the title and the whole "discover it from a riddle" experience collapses. The sanitizer plugged the
coordinate leak but not the **text** leak.

Because "this text reveals the location" is inherently fuzzy, we do NOT try to auto-detect-and-delete
(destroying a creator's authored title is both wrong and unpredictable). Instead we give the creator
a **non-blocking warning at authoring time**: a pragmatic heuristic flags a hidden-location task
whose `title`/`description` contains an obvious place-naming token, so the creator can move the
place name into a riddle before launching. Warn, don't mutate.

## What Changes

- **New pure shared helper** `locationLeakWarnings(task)` in `packages/shared`: given a task, returns
  which participant-visible text fields (`'title'` / `'description'`) look like they name the hidden
  location. Returns `[]` when `hideLocation` is falsy (nothing hidden ⇒ nothing to leak) or when the
  fields carry no place-naming token. The detection is a curated, bilingual (EN + HE) location-token
  match (street/road/square/plaza/park/gate/fountain/statue/tower/market/corner/near/opposite +
  Hebrew equivalents) — deliberately pragmatic and fully unit-testable, biased toward *useful* flags
  over exhaustive NLP.
- **Builder warning UI** (`apps/creator-web` `TaskWizard`): when a task has `hideLocation` on, render
  a non-blocking caution under the clue field naming the offending field(s) and telling the creator
  to keep the place name out of the title/description and put it in the clue riddle. All strings via
  `t.*` (i18n EN + HE).
- **No content is auto-stripped or blocked.** The creator can still save and launch — the warning is
  advisory. The `title`/`description` continue to be sent to the participant unchanged (they are
  legitimately needed to render the task).

## Capabilities

### New Capabilities
- `hidden-location-leak-guard`: a creator authoring a hidden-location task is warned when the task's
  participant-visible `title`/`description` appears to name the hidden spot, so the map-pin
  suppression is not defeated by the text. Warning only, never destructive.

## Impact

- **Shared** (`packages/shared/src/locationLeak.ts` new + index export): pure `locationLeakWarnings`
  helper + its `LocationLeakField` type. No dependency on Firebase.
- **Creator UI** (`apps/creator-web/src/components/TaskWizard.tsx`): render the warning in the
  existing hide-location block; new i18n keys in `apps/creator-web/src/i18n.ts` (EN + HE).
- **Sanitizer / callables / participant app**: unchanged. `title`/`description` still flow to the
  participant; there is no server behavior change — this is a purely additive authoring-time guard.
- **Tests**: pure-logic `scripts/test-location-leak.ts` (auto-run by `npm test`) for the helper;
  i18n correctness gate for the new UI strings.

## Non-goals

- **No auto-strip / auto-edit / save-block** of creator text — the guard is advisory only. Deleting or
  rewriting an authored title is destructive and unpredictable; the creator decides.
- **No server-side sanitizer change.** `title`/`description` remain participant-visible (the player
  needs them). A hidden-location task's *coordinates* stay stripped exactly as today.
- **No perfect leak detection / NLP / gazetteer.** The heuristic is a curated bilingual token list; it
  will neither catch every phrasing nor be a security boundary — it is a helpful nudge, not a gate.
- No change to scoring, routing, the paid `hint`, or the `locationClue` mechanic itself.

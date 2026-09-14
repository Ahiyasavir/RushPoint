## Why

The smart composer draws from a curated pool of ~89 hand-authored missions
(`apps/creator-web/src/taskBank.ts` + the live `missionBankOverrides` admin
edits), but a creator building a game by hand never sees any of them. The task
library — the "pull a mission in" surface in the Builder, and the task tab of the
public Gallery — only lists `publicTasks`, which exist **only** after some creator
publishes a game. On a young platform that means the library is nearly empty
while the best-written content on the platform sits unreachable. It should be the
opposite: every hand-authored mission should be one tap away, everywhere a
creator looks for a mission, and it should track the bank automatically so an
edit (in the source file or from the admin console) is reflected without a
re-seed.

## What Changes

- The task library (the in-Builder `TaskLibrary` modal **and** the Gallery task
  tab) lists the effective mission bank — `TASK_BANK` merged with
  `missionBankOverrides` via the existing `loadMissionBank()` — interleaved with
  the real `publicTasks` search results and ranked together by relevance then
  popularity.
- Bank rows are **derived at read time** from the same in-browser source the
  composer already uses. No Firestore seeding, no `publicTasks` duplication, no
  backfill. An edit to `taskBank.ts` ships on the next build; an admin edit via
  `setMissionBankOverride` is picked up on the next `loadMissionBank()` (5-minute
  memo, already invalidated in-session after an admin edit).
- Bank rows are **de-duplicated** against real `publicTasks`: if a mission with
  the same normalized title and task type is already in the gallery (e.g. a
  creator published one of the harvested templates), the real row wins and the
  bank row is suppressed — the library never shows the same mission twice.
- Picking a bank row inserts a fresh `Task` from `entry.build()` (full factory:
  type, verification, capacity, quick-setup expectations) rather than
  reconstructing one from a projected `PublicTask`. The synthetic row carries no
  answer keys, secret codes, or exact coordinates — the projection is built
  field-by-field, never by spreading `build()`.
- Bank rows do not call `incrementTaskCopyCount` (there is no `publicTasks` doc
  to bump) and cannot be "liked".

## Non-goals

- Not writing bank missions into `publicTasks` / `publicGames`, and not adding a
  seed or backfill.
- Not adding server-side ranking of bank content — the interleave/rank happens
  client-side, reusing `rankGalleryResults` from `@rushpoint/shared`.
- Not changing the smart composer, the admin mission-bank console, or the
  `missionBankOverrides` collection / callables.
- Not putting bank rows on the Gallery **map** (they carry no `approxLocation`;
  the creator places the pin per event — same as any locationless mission).
- Not exposing bank content to signed-out visitors beyond what the Gallery task
  tab already shows to signed-in creators.

## Capabilities

### New Capabilities

- `mission-bank-library-listing`: the task library surfaces the effective mission
  bank alongside published `publicTasks`, kept in sync with the bank source and
  admin overrides, de-duplicated against real gallery content, with a pick path
  that builds a fresh task from the bank factory.

### Modified Capabilities

<!-- none: task-library-map, smart-game-composer, game-task-tags behaviour is unchanged -->

## Impact

- **creator-web only.** No callable, no shared-type, no `functions/`, no
  `firestore.rules` change. `missionBankOverrides` is already world-readable to
  signed-in users and already read by `loadMissionBank()`.
- New pure module `apps/creator-web/src/lib/libraryBankRows.ts` (bank entry →
  sanitized library row; merge + dedupe + rank) — unit-tested by a new
  `scripts/test-library-bank-rows.ts` (auto-discovered by the aggregator).
- Edited: `apps/creator-web/src/components/TaskLibrary.tsx`,
  `apps/creator-web/src/pages/GalleryPage.tsx`, and their pick/insert paths;
  possibly `apps/creator-web/src/lib/libraryTask.ts` (bank branch).
- i18n: bank strings are bilingual `"HE\n\nEN"`; the library must show the
  active-language half. No new dictionary keys expected beyond a section label
  ("RushPoint missions" / provenance) — `npm run i18n:check:strict` must stay
  clean.
- Gates: `typecheck`, `lint`, `test` (new pure suite), `creator:build`,
  `i18n:check:strict`. No `e2e` impact (no callable touched).

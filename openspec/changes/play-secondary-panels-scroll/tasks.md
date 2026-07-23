# Tasks — play-secondary-panels-scroll

There is **no pure logic** and **no user facing string change** in this change: it is a documentation
correction plus a formal scoping decision (reorder only, no nested scroll region). So there is no RED
unit test to write. Per CLAUDE.md's UI lane, the gates are typecheck + play:build + bundle:budget +
browser, with no i18n change to check.

## GREEN

- [x] 1. Correct the comment at `apps/play-web/src/screens/PlayScreen.tsx:539-541` so it describes the
      shipped behavior: the secondary panels sit below the promoted task and scroll with the page,
      each self hides when its feature is unused, and there is deliberately no nested bounded scroll
      region (one line reason: a nested scroll on mobile traps momentum and hides content below an
      invisible fold). Leave the `<div className="mt-1 -mx-1 px-1">` wrapper unchanged. No em dash, no
      en dash, no spaced hyphen.

## VERIFY

- [x] 2. Preview / browser check (play-web): the task and map are on top; all secondary panels
      (standings peek, feed, chat, trackables, zones, devices) render below and are reachable by
      scrolling the page; a simple game with no trackables/zones/devices shows little below the task
      because those panels self hide.
- [x] 3. Hand the relevant gates to the parent (`npm run typecheck`, `npm run play:build`,
      `npm run bundle:budget`). This lane must not run them: they rewrite `packages/shared/dist` in
      place and other agents are live on this tree.
- [x] 4. Confirm nothing else is owed: no i18n key added (so `i18n:check` has nothing new), no callable
      touched (so no e2e change), no shared type change.

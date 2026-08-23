# Design — play-secondary-panels-scroll

## 1. Current code, audited

`apps/play-web/src/screens/PlayScreen.tsx`:

- PRIMARY block (`:509-537`): the `NavMap` (`:512-516`) and the `TaskRunner` + `LockedTasksList`
  (`:518-537`) sit at the top. This is half (1) of `fix-play-screen-hierarchy`, and it shipped.
- SECONDARY block (`:539-558`): a plain `<div className="mt-1 -mx-1 px-1">` wrapper holding, in order,
  the viewer banner, `LiveOps` (standings peek), `FeedSection` (gated on `photoFeedEnabled`),
  `ChatSection`, `TrackablesPanel`, `ZonesPanel`, and `TeamDevicesPanel` (gated on
  `hasTeammateDevices`).
- The comment at `:539-541` currently reads that the secondary content "scrolls within its own
  bounded region so it never pushes the task off-screen" — describing a bounded region that the
  wrapper does not implement.

Several panels already self hide: `TrackablesPanel` returns null when there are no trackables
(`:825`), `ZonesPanel` returns null when there are no zones (`:884`), chat is collapsible, feed is
gated on `state.game.photoFeedEnabled !== false` and devices on `hasTeammateDevices`.

## 2. The decision: reorder only, no nested scroll

Two options were on the table (from the finding):

- **(A) Finish half (2)** — wrap `:542-558` in `max-h-[...] overflow-y-auto`.
- **(B) Formally close half (2) as not done** and make the code comment truthful.

**Chosen: (B).** Rationale:

- The reported problem was "the task is buried and the screen scrolls to find it." Half (1) put the
  task on top and fixed that. Half (2) targets a different, unproven problem (page length below the
  task).
- A nested `overflow-y-auto` inside the page scroll is a known mobile anti pattern: it creates a
  second scroll surface with no visible scrollbar on touch, traps momentum scrolling, and hides
  content (chat, devices) below an invisible fold. On a phone this is worse than the natural page
  scroll the PWA already provides, where every panel is reachable by scrolling the page.
- Option (B) is strictly smaller: it changes a comment, adds zero runtime behavior, and removes zero
  ability. Option (A) adds a container and a real ergonomic risk on the exact devices this app runs
  on.

If a future playtest shows the below-task page length is a genuine problem, option (A) can be
revisited as its own change with a measured trigger. It is not added speculatively here.

## 3. The change

- Correct the comment at `PlayScreen.tsx:539-541` so it describes the shipped behavior: the secondary
  panels sit below the promoted task and scroll with the page; each self hides when its feature is
  unused; there is deliberately no nested scroll region (with a one line reason pointing at the mobile
  nested scroll trade off).
- Leave the `<div className="mt-1 -mx-1 px-1">` wrapper (`:542`) exactly as is. No class change.
- No other file changes.

## 4. Test strategy

There is **no pure logic** in this change and no user facing string change, so there is nothing to
unit test and nothing for the i18n checker to catch. Per CLAUDE.md's UI lane, verification is:

- `npm run typecheck` and `npm run play:build` stay green (the change is a comment; these prove it
  compiles and the play-web bundle still builds).
- `npm run bundle:budget` stays green (no import change, so the entry chunk is unaffected).
- Preview / browser check: on the play active screen the task and map are on top, and all secondary
  panels (standings peek, feed, chat, trackables, zones, devices) render below and are reachable by
  scrolling the page; on a simple game with no trackables/zones/devices, little shows below the task
  because those panels self hide.

No emulator, no e2e change (no callable touched), no i18n change.

## 5. RTL / i18n notes

No new or changed user facing string, so no i18n key is added and `i18n:check:strict` has nothing new
to evaluate. The untouched wrapper uses only symmetric spacing utilities (`mt-1 -mx-1 px-1`), so there
is no physical direction class to correct. The comment contains no em dash, no en dash, no spaced
hyphen.

## 6. Relationship to `fix-play-screen-hierarchy`

This change does not edit the `fix-play-screen-hierarchy` change directory. It records, in its own
spec, that the play active screen's shipped and intended behavior is reorder only, superseding the
nested bounded scroll half of that earlier change. When `fix-play-screen-hierarchy` is next revisited
or archived, its half (2) tasks should be marked closed with a pointer to this change.

## Why

Building a game on an iPhone is, in the product owner's words, "very cumbersome — the scrolling
becomes complicated". The mission editor is where a creator spends most of their Builder time, and
on a phone it is a fixed bottom sheet layered over a scrimmed workspace that is itself a stack of
scroll containers. Three concrete failures follow from that shape:

1. **The back gesture does the most destructive thing available.** Back is the primary navigation
   on a phone. With the editor open it does not close the editor — it leaves the Builder entirely.
2. **The editor negotiates screen space with another fixed overlay by hand.** `reserveTop` exists
   only because the sheet and the floating הקמה מהירה bar are two independently-`fixed` elements
   claiming the same corner, so the sheet gives up a third of its height (`88dvh` → `62dvh`)
   whenever that bar is up — on the smallest screen, at the moment the creator has the most to read.
3. **The open mission is not addressable.** A reload loses it, and every deep link into a mission
   (readiness, הקמה מהירה) has to re-drive local state rather than navigate.

Stage A of this overhaul (input-zoom floor, `overscroll-contain`, keyboard viewport, deferred Quick
Setup invite) removed the mechanical pain. This removes the structural cause.

## What Changes

- The open mission moves into the URL as a search param on the existing `/build/:gameId` route.
  Opening a mission is a navigation; the phone's back gesture, the browser back button and the ✕
  control all close it by the same mechanism.
- Below the `lg` breakpoint the editor presents **full-screen** instead of as an `88dvh`/`62dvh`
  bottom sheet. It gets the whole viewport, so it no longer negotiates height with any other
  overlay and `reserveTop` is deleted rather than tuned.
- A mission is now deep-linkable: reloading `/build/:gameId?task=<id>` reopens that mission's editor.
- **Desktop (`lg` and up) is unchanged.** The inline side pane keeps today's width, slide-in and
  collapse behaviour exactly; only the source of "which mission is open" moves.
- `stageId` stops being carried alongside `taskId` in editor state — it is derived from the task id,
  so the two can no longer disagree. `revealAll` stays local: it is transient UI intent ("show this
  mission's validation messages now"), not an addressable location.
- **BREAKING (internal only):** `SlidePanel`'s `reserveTop` prop is removed. It has one caller.

## Non-goals

- **Not** restructuring `TaskWizard`'s internal steps, fields, opt-in groups or validation gating.
  The editor's contents are untouched; only where it lives and how it is dismissed change.
- **Not** changing the desktop presentation, the stage-settings side pane's presentation, or the
  Builder's tab/rail/canvas layout. (The mobile Builder shell is stage C of the overhaul.)
- **Not** putting the Builder's tab (`build`/`preview`/`settings`), the active stage, or `revealAll`
  into the URL. Only the open mission.
- **Not** adding or changing any callable, Firestore path, or rule. No server surface is touched.
- **Not** changing autosave, undo/redo or draft-flush semantics. BuilderPage must stay mounted
  across an editor open/close precisely so these are unaffected.

## Capabilities

### New Capabilities
- `builder-mission-editor-route`: how the Builder addresses, opens, dismisses and presents the
  mission editor — the URL contract for the open mission, back-gesture dismissal, deep-link
  restoration (including a task id that no longer exists), and the full-screen phone presentation.

### Modified Capabilities
- `task-creation-wizard`: its requirements are written in terms of a "task editor modal" opened by
  clicking a tile. The open/close trigger and the phone presentation change; the wizard's own
  step behaviour does not.

## Impact

**Surfaces touched:** `apps/creator-web` only. No shared types, no callable, no `functions/`, no
`firestore.rules`, no `packages/shared`.

- `apps/creator-web/src/pages/BuilderPage.tsx` — `editing` state (line 2226) and its 6 setters /
  5 clearers become navigations; `ContextPanel` and `SlidePanel` presentation; `reserveTop` removal.
- `apps/creator-web/src/lib/` — a new pure module owning the URL contract (parse, serialize, and
  the "this task id is not in this game" verdict), per the repo rule that every pure decision lives
  in a lib module.
- `scripts/test-*.ts` — a new guard for that module, auto-discovered by the unit lane.
- **i18n:** a full-screen editor needs an accessible back/close control, so new `t.*` keys are
  likely (HE + EN). `npm run i18n:check:strict` is mandatory.
- **No new dependency.** `react-router-dom` is already the router; this uses its existing search-param
  and history primitives.

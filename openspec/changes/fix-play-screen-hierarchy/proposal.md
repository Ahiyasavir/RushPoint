# Proposal: fix-play-screen-hierarchy

## Why

A family playtest of the participant app produced three concrete complaints about the **active
racing screen** (`apps/play-web/src/screens/PlayScreen.tsx`, the `team.launched` return):

1. **The screen scrolls**, which makes the game feel complex and confusing on a phone.
2. **The primary task is buried.** The task card (`TaskRunner`, the one thing a player must read and
   act on) renders **last**, in the `flex-1` block at the very bottom, after `LiveOps`, the photo
   feed, chat, trackables, the territory panel, the devices panel, and the map. Its title is only
   `text-xl` and its description is small, low-contrast `text-zinc-400 text-sm`, so the main
   instruction is hard to notice and hard to read.
3. **Priority is inverted.** Lower-value status (territory capture, trackables, feed, chat) sits
   *above* the task, while the task the player actually needs sits below the fold.

The current DOM order of the active return (lines ~375-444) is: ReconnectingPill → StoryInterstitial
→ PowerUpToast → Header → test-drive banner → Progress → InRunAlerts → streak chip → share button →
**LiveOps** → **FeedSection** → **ChatSection** → **TrackablesPanel** → **ZonesPanel** →
TeamDevicesPanel → viewing banner → **NavMap** → **TaskRunner + LockedTasksList** → SOS. The primary
task is dead last; the secondary panels stack on top and are what force the page to scroll.

## What Changes

- **Promote the primary task to the top.** Move the map + `TaskRunner` + `LockedTasksList` block so
  it renders **immediately under the Header/progress/alerts**, before any secondary panel. The task
  card becomes the first substantial thing a player sees.
- **Make the task legible.** Enlarge the task title from `text-xl` to `text-2xl` and lift the task
  description from `text-zinc-400 text-sm` to `text-zinc-300 text-base leading-relaxed` (play-web
  reverses the zinc scale for its light "Warm Trail" theme, so a *lower* zinc number is *darker*,
  i.e. higher contrast on the light background). Static Tailwind classes only.
- **Demote the secondary panels below the task.** `LiveOps`, `FeedSection`, `ChatSection`,
  `TrackablesPanel`, `ZonesPanel`, and `TeamDevicesPanel` move **below** the task block, grouped in a
  clearly-secondary region, so the busy status content no longer sits between the player and the
  task.
- **Reduce main-screen scroll.** Wrap the demoted secondary panels in their own bounded,
  independently-scrolling region (`overflow-y-auto` with a max height) so long status content scrolls
  *inside its own area* instead of pushing the whole page down. The primary task + map stay in view;
  only the secondary region scrolls.
- **No conflict with `fix-play-offline-continuity`.** That in-flight change adds `ReconnectingPill`
  at the very top of these returns (a `fixed` overlay). It stays exactly where it is — this change
  only reorders the in-flow blocks below it and never touches the pill, its i18n key, or the sync
  logic.

## Non-goals

- No change to what any panel *does*, to any callable, or to routing/scoring. Pure
  presentation-order + typography.
- No change to the pre-launch (`!team.launched`), finished (`FinalScreen`), or loading/error returns.
- No new caching, no offline-continuity behavior change (owned by `fix-play-offline-continuity`).
- No removal of any panel; everything that renders today still renders, just re-ordered.

## Capabilities

### New Capabilities
- `play-screen-hierarchy`: on the active racing screen, the primary task is the most prominent,
  top-most, legibly-sized element; secondary status panels sit below it in a self-contained scroll
  region so the main screen does not grow unbounded.

## Impact

- **Surfaces touched:** play-web only — `screens/PlayScreen.tsx` (JSX reorder + a wrapper for the
  secondary region) and `components/TaskRunner.tsx` (two typography classes on the title/description).
  No i18n dictionary change is required (no new user-facing string); `npm run i18n:check` still runs
  because `.tsx` files change.
- **Tests:** UI-only change, verified via the preview tools per CLAUDE.md (a running launched team:
  task card is top-most and legible, secondary panels are below and scroll within their own region,
  the main screen no longer scrolls to reach the task). Gates: `npm run typecheck` · `npm run lint` ·
  `npm run creator:build` · `npm run play:build` · `npm run i18n:check`.

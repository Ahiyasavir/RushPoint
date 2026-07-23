# Proposal — gallery-mission-detail

## Why

The creator Gallery has a "mission library" tab (`GalleryPage.tsx`, `tab === 'tasks'`) and the
Builder has a mission picker (`TaskLibrary.tsx`). Both render a **card**, and a card is all there
ever is: everything the server already returned about a mission is either truncated to two lines or
never rendered at all.

What `searchTaskLibrary` returns today versus what a creator can actually see:

| Field on `PublicTask` | Gallery card | Builder library row |
|---|---|---|
| `title` | shown | shown |
| `description` | `line-clamp-2` | `truncate` (one line) |
| `type` | shown, as a terse enum label | shown, same terse label |
| `difficulty` | shown | shown |
| `estimatedMinutes` | **never rendered** | **never rendered** |
| `pointValue` | shown | shown |
| `tags` | first 6 | first 4 |
| `copyCount` | shown | shown |
| `likeCount` | shown | **never rendered** |
| `approxLocation` | a pin on the shared map, only in map view | **never rendered** |
| `sourceGameTitle` | shown | shown |
| `ownerDisplayName` | **never rendered** | **never rendered** |
| `createdAt` | **never rendered** | **never rendered** |

Pressing a mission does nothing at all in the Gallery, and in the Builder library the only press
target is "insert", which commits the mission into the stage **before** the creator has read it.

The product owner's ask: *"In the gallery, when I press a mission I want to be able to look at it
and see all the details."*

## What Changes

**Pressing a mission opens a detail view that shows everything the sanitized public payload
carries, and nothing else.**

- A new **pure** view-model module, `apps/creator-web/src/lib/galleryTaskDetail.ts`, decides what a
  mission detail contains: which rows exist, in which order, which rows are suppressed when the
  underlying value is missing or unusable, the plain-language key for the interaction type, and the
  coarse area (if any).
- **Secrecy is a property of the view model, not of the markup.** `buildGalleryTaskDetail` copies
  named fields out of the input, so a field that is not in the allow-list cannot reach the screen
  even if a future `PublicTask` starts carrying it. `answers`, `numericAnswer`, `steps`, `hint`,
  `smart.secretCode` and the deprecated exact `coordinates` are asserted absent from the produced
  object by a dedicated test, over an input that carries all of them.
- **Location is the coarse area only.** The detail reads `approxLocation` through the shared
  `isPlottablePublicTask` predicate, the same one the library map filters on, so the detail can
  never draw a pin the map refuses to draw (or vice versa). A mission with no published area gets
  an explicit explanation instead of a blank slot.
- A new modal component, `apps/creator-web/src/components/GalleryTaskDetailModal.tsx`, renders that
  view model: title, full description, plain-language interaction type, difficulty, estimated
  minutes, points, tags, source game, author, publish date, copy count, like count, a small map of
  the approximate area, and a standing note that answer keys stay with the author.
- **Both surfaces open it.** In the Gallery the mission card becomes pressable and the modal is
  read-only (with a pointer to the Builder's library, which is where a mission is actually
  inserted). In the Builder's `TaskLibrary` the row becomes pressable and the modal carries the
  real **"use this mission"** action, so a creator now reads before committing.

## Non-goals

- **No new callable and no callable change.** `searchTaskLibrary` already returns the whole
  sanitized `PublicTask` (it strips the legacy exact `coordinates` server-side), so the detail is
  built from data already in the client's hands. Nothing is fetched on open.
- **No new field on `PublicTask`,** and therefore no `publishGame` change. In particular there is
  **no media/photo to show**: `SmartStationConfig.imageUrl` / `mediaUrl` are never copied into
  `publicTasks`. The detail renders the media block only if a future publish path adds one; it does
  not invent one.
- **No change to the public game (`publicGames`) card.** This change is missions only.
- **No change to `functions/`, `packages/shared`, `firestore.rules`, or play-web.**
- **No inserting from the Gallery tab.** Adding a mission to a game requires a target game, which
  the Gallery has no notion of; the modal says where to do it instead of guessing.

## Impact

- Affected specs: `gallery-mission-detail` (new)
- Affected code: `apps/creator-web/src/lib/galleryTaskDetail.ts` (new),
  `apps/creator-web/src/components/GalleryTaskDetailModal.tsx` (new),
  `apps/creator-web/src/pages/GalleryPage.tsx`, `apps/creator-web/src/components/TaskLibrary.tsx`,
  `apps/creator-web/src/i18n.ts` (additive), `scripts/test-gallery-task-detail.ts` (new)
- Surfaces touched: **creator-web only**. No shared types, no callable, no rules.

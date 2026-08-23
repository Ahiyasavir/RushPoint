## Context

creator-web has ESLint but no component test runner, so the testable core is a **pure view-model**
(the same pattern `gallery-mission-detail` established with `lib/galleryTaskDetail.ts` +
`scripts/test-gallery-task-detail.ts`). This change mirrors that pattern for games. Presentation is a
UI lane; the field-selection logic is unit-tested.

## Current state (re-confirmed)

`apps/creator-web/src/pages/GalleryPage.tsx`:

- **Game card** (games tab): a `<Card>` per `PublicGame` `pg`, rendering title + mode badge,
  description, a meta row (`gl.stages` / `gl.tasks` / `~{pg.estimatedTotalMinutes}m` / `gl.plays`),
  `<TagChips tags={pg.tags} …>`, a `LikeButton`, an optional `📍 {pg.approxLocation.label}`, and a
  trailing `<Button … onClick={() => void copyAction.run(pg)}>{gl.copyBtn}</Button>`. No press-to-open
  affordance.
- **Mission card** (tasks tab): a `<Card>` wrapping a `role="button"` `tabIndex={0}` div with
  `aria-label={tk.title}`, `onClick={() => setDetailTask(tk)}` and an Enter/Space `onKeyDown` guarded
  by `e.target !== e.currentTarget` (so the nested `LikeButton` still works); `{detailTask && (<GalleryTaskDetailModal task={detailTask} … />)}` renders below the grids.

`packages/shared/src/types/index.ts` `interface PublicGame` already carries every field the detail
needs: `title`, `description?`, `mode`, `stageCount`, `taskCount`, `estimatedTotalMinutes`,
`playCount`, `tags`, `approxLocation? { label? }`, `requirement?`. No exact `coordinates`.

`apps/creator-web/src/components/GalleryTaskDetailModal.tsx` is the house modal pattern to mirror:
portal, Escape/backdrop/✕ close, body-scroll lock, focus trap + restore, renders a view-model built
by `buildGalleryTaskDetail(task)` and knows nothing about raw fields.

## The fix

1. **`src/lib/galleryGameDetail.ts` (new, pure).** `buildGalleryGameDetail(game: unknown)` returns a
   plain view-model: the title, description, a labelled meta list (mode, stages, tasks, minutes,
   plays, requirement, location label), and tags — copying ONLY those named fields out of the input.
   Like `galleryTaskDetail`, it must never spread the input; any field it does not name is dropped by
   construction (future-field safety). It performs no i18n — it hands back keys/values the modal
   labels.
2. **`src/components/GalleryGameDetailModal.tsx` (new).** Mirrors `GalleryTaskDetailModal`'s
   portal/close/focus/scroll-lock chrome, renders `buildGalleryGameDetail(game)`, and shows a
   **Copy** action (calls the same `copyAction.run(game)` the caller passes in). No map is required
   (a game has only a coarse label), so it does NOT import `GalleryMap` — keeping it lighter than the
   mission modal.
3. **`GalleryPage.tsx`.** Give the game card the same press-to-open affordance as the mission card:
   wrap the tappable region in a `role="button"` `tabIndex={0}` `aria-label={pg.title}` with
   `onClick` → `setDetailGame(pg)` and the same `e.target !== e.currentTarget`-guarded Enter/Space
   `onKeyDown`, so the nested `LikeButton` and the Copy `<Button>` remain independently clickable.
   Keep the Copy button on the card. Render `{detailGame && (<GalleryGameDetailModal game={detailGame} onClose={() => setDetailGame(null)} onCopy={() => void copyAction.run(detailGame)} copyBusy={copyAction.isBusy(detailGame.id)} />)}` beside the existing `detailTask` modal.

## RTL / i18n notes

- HE is default. Use logical Tailwind only (`ms-`/`me-`/`text-start`/`gap-*`) — mirror the mission
  modal, which is already RTL-safe. No physical-direction classes.
- New strings go through `t.gallery.*` in both dictionaries (HE + EN); no hardcoded UI literals (the
  emoji/`•` separators are non-text, as on the mission card). No em-dash in copy.
- New keys (HE + EN): a modal title (e.g. `gameDetailTitle`), and labels for the meta rows that don't
  already exist as reusable strings (`gl.stages` / `gl.tasks` / `gl.plays` already exist and are
  reused; add `detailMode`, `detailLength`, `detailRequirement`, `detailLocation` as needed, plus
  `detailClose` if the ✕ needs an aria-label distinct from the mission modal's). `copyBtn` is reused.
- Run `npm run i18n:check:strict` — PART A parity must stay green, zero new PART B (every new string
  routed through `t.*`).

## Test strategy

- **Pure lane (`npm test`):** new `scripts/test-gallery-game-detail.ts` asserting
  `buildGalleryGameDetail` (a) surfaces each expected field from a representative `PublicGame`, and
  (b) a **secrecy/allowlist sweep** — given a `PublicGame` with an extra unknown field (and a
  planted exact `coordinates`), the view-model output contains none of it. The aggregator
  auto-discovers `scripts/test-*.ts`, so dropping the file in adds it to the gate.
- **UI lane:** `npm run typecheck` · `npm run lint` · `npm run creator:build` ·
  `npm run i18n:check:strict`. Manual: open a game card → detail renders (stages/tasks/length/tags/
  description/mode/location label); Copy on the card and in the detail both duplicate the game; the
  like button still toggles without opening the detail; Escape/backdrop/✕ close.

## Non-regression checklist

- Copy still works from the card (one tap) and now also from the detail; callable unchanged.
- Mission cards + `GalleryTaskDetailModal` untouched.
- No coordinates ever reach the game detail (allowlist test proves it).
- Like button and Copy button remain independently clickable inside the now-pressable card
  (`e.target !== e.currentTarget` guard, mirroring the mission card).

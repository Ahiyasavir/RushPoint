## Context

The task library UI in creator-web has two mounts, both fed only by the
`searchTaskLibrary` callable (→ `publicTasks`):

- `apps/creator-web/src/components/TaskLibrary.tsx` — modal in the Builder,
  inserts a chosen mission into the stage being edited (`onInsert`), bumps
  `incrementTaskCopyCount`.
- `apps/creator-web/src/pages/GalleryPage.tsx` (task tab) — browse-only: search,
  facets, map, like, and a detail modal (`GalleryTaskDetailModal`). No insert.

The mission bank already has a browser-side, sync-safe accessor:
`apps/creator-web/src/lib/missionBank.ts` — `loadMissionBank()` returns
`applyBankOverrides(TASK_BANK, <missionBankOverrides>)`, memoized 5 min, failing
open to the authored `TASK_BANK`, invalidated in-session by
`invalidateMissionBank()` after an admin edit. `missionBankOverrides` is
world-readable to any signed-in user (`firestore.rules:300`).

`rankGalleryResults` (`@rushpoint/shared`) is the same relevance-then-popularity
ranker the gallery callables use server-side; it is framework-free and safe to
call in the browser. `buildGalleryTaskDetail(task: unknown)`
(`lib/galleryTaskDetail.ts`) copies named fields off whatever object it is
handed and is covered by a secrecy-sweep test.

Bank mission titles/descriptions are Hebrew prose (not `"HE\n\nEN"` — only the
Quick-Setup `prompt` strings are bilingual). Published `publicTasks` from Hebrew
games already render Hebrew in the library under `dir="auto"`, so bank rows need
no language split.

## Goals / Non-Goals

**Goals**

- Bank missions listed in both library mounts, interleaved and ranked with
  `publicTasks`.
- Zero new server surface; sync is automatic via `loadMissionBank()` + the build.
- A bank row can never carry a secret (secretCode / answers / numericAnswer /
  hint / steps answers / exact coordinates).
- De-dupe so a published bank mission is shown once.
- Builder insert of a bank row uses `entry.build()`.

**Non-Goals**

- Server ranking, seeding, `publicTasks` writes, map pins for bank rows,
  composer / admin-console changes. (See proposal Non-goals.)

## Decisions

### D1 — One pure module owns the projection + merge: `lib/libraryBankRows.ts`

Exports:

- `type LibraryRow = PublicTask & { bankKey?: string }` — the shape both mounts
  render. A bank row sets `bankKey` (the stable entry key) and `id =
  \`bank:${key}\``; a real row is a `PublicTask` untouched.
- `bankEntryToLibraryRow(entry: TaskBankEntry): LibraryRow` — builds the row
  **field by field** from `entry` and a single `entry.build()` snapshot, copying
  only: `title`, `description`, `type`, `difficulty`,
  `estimatedMinutes`/`expectedDurationMinutes` (whichever the build carries) →
  `estimatedMinutes`, `pointValue`, `tags` (from `entry.tags`). Sets
  `copyCount: 0`, `likeCount: 0`, `popularity: 0`, `sourceGameId: ''`,
  `sourceGameTitle: ''`. **No `approxLocation`** (bank rows are unplaced). Never
  spreads `build()`.
- `mergeLibraryRows(published: PublicTask[], bank: LibraryRow[], query: string):
  LibraryRow[]` — dedupe then rank:
  - **Dedupe**: drop a bank row when some `published` row has
    `normalizeTitle(pub.title) === normalizeTitle(bank.title) && pub.type ===
    bank.type`. `normalizeTitle` = trim + collapse whitespace + lowercase.
  - **Rank**: feed the concatenated list through `rankGalleryResults(list,
    query, adapter)` with the same adapter shape `searchTaskLibrary` uses
    (`uses: copyCount`, `likes: likeCount`, `popularity`). Bank rows' zeros sink
    them under real content on an empty query; a title match lifts them via the
    relevance tier.

Rationale: mirrors `lib/missionBankOverlay.ts` / `lib/galleryTaskDetail.ts` —
pure, total, unit-tested, no React. creator-web has no component test runner, so
all logic that can be tested must live outside the component.

Alternative rejected: merging inside each component. Duplicates the dedupe/rank
in two files and can't be tested.

### D2 — Each mount calls `loadMissionBank()` and merges after its own search

`TaskLibrary.run()` and `GalleryPage.run()` (task branch) already `await
searchTaskLibrary(...)`. Add a parallel `await loadMissionBank()` (cheap: memo or
one tiny collection read, fail-open), map through `bankEntryToLibraryRow`, then
`mergeLibraryRows(tasks, bankRows, q)` and render the result.

Facets in the Gallery (`type`, `difficulty ≥`, `hasLocation`, `tags`, `sort`):
apply the same predicates to bank rows client-side so the facet bar stays
honest — `hasLocation: 'on'` hides every bank row (no `approxLocation`),
`hasLocation: 'off'` shows them; `type` / `difficulty` / `tags` filter on the
row's own fields; `sort` is folded into the merge (popularity/newest → keep
merge order; "difficulty" → stable re-sort after merge). A small
`applyBankRowFacets` helper in the same module, unit-tested.

### D3 — Pick path branches on `bankKey`

`libraryTaskToTask` (`lib/libraryTask.ts`) stays the path for real rows. In
`TaskLibrary.pick()`:

```
if (row.bankKey) { onInsert(missionBankNow-entry(row.bankKey).build()); onClose(); return; }
```

Resolve the entry from the same list `loadMissionBank()` returned (hold it in
state), not from `TASK_BANK` directly, so an override-edited build is honoured.
No `incrementTaskCopyCount` for bank rows. The one-tap `Button` and the detail
modal's `onUse` both route through `pick()`.

Gallery: no pick path. The detail modal opens on a bank row unchanged
(`buildGalleryTaskDetail` already tolerates missing `sourceGameId` etc.); the
like button is hidden when `row.bankKey` is set (nothing to like).

### D4 — i18n

One new dictionary key per app-section if a provenance label is shown (e.g.
`gallery.bankRowBadge` = "משימת RushPoint" / "RushPoint mission"). Bank titles
stay Hebrew — same as existing Hebrew `publicTasks` rows, rendered `dir="auto"`.
`npm run i18n:check:strict` must stay clean (route any visible literal through
`t.*`).

## Risks / Trade-offs

- **Dedupe is title+type, not identity** → a creator who renamed a published
  copy will see both. Acceptable: a renamed mission is arguably a different one,
  and the bank row still builds the pristine version. Documented in the spec.
- **`rankGalleryResults` called client-side on ≤ ~90 bank + ≤100 published rows**
  → trivial cost, runs once per search. No pagination concern (library is
  single-page).
- **`loadMissionBank()` adds a Firestore read to the Gallery task tab for
  signed-in creators** → it's one usually-empty collection, memoized 5 min,
  shared with the Dashboard/wizard in-flight promise. Fail-open. Within the
  Spark budget posture (CLAUDE.md) this is negligible and made only when the
  task tab is actually opened.
- **A bank entry whose `build()` throws** → `bankEntryToLibraryRow` wraps the
  single `build()` call in try/catch and drops that entry from the list (logged),
  total like `missionBankOverlay`.

## Migration Plan

Pure additive UI change. Ship behind no flag. Rollback = revert the creator-web
commit; no data written anywhere.

## Open Questions

- Show a small "RushPoint mission" badge on bank rows, or leave them visually
  identical to published rows? Leaning: a quiet badge, so a creator understands
  why it has no copy count / author. Resolved in tasks as a one-line badge.

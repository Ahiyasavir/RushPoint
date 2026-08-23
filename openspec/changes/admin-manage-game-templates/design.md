## Context

Templates are currently `apps/creator-web/src/templates.ts`: an in-repo array of
`{ key, emoji, mode, scoringPreset, build(): Stage[] }`, consumed only by `DashboardPage.tsx`'s
new-game modal. `build()` is called fresh each time to get fresh stage/task ids — but it never had
to preserve cross-references because every static template was authored id-consistent by hand at
build time.

The admin wants a runtime-editable equivalent, authored the same way any creator authors a game —
via the Builder. The existing admin surface (`/admin/users`, `functions/src/admin/index.ts`,
`lib/adminGate.ts` + `assertAdmin`) already establishes the auth pattern to extend.

## Goals / Non-Goals

**Goals:**
- Admin can create, edit (via the normal Builder), and delete templates without a deploy.
- A template is a real `Game` document — no parallel data model, no parallel editor.
- Instantiating a template into a new game preserves the unlock/exclusive-group dependency graph
  (the static `build()` approach never had this problem because it never remapped a graph — only
  ever emitted a hand-authored one already using the ids it generated).
- Bilingual templates ride the existing `translateGame` mechanism.

**Non-Goals:**
- No new translation pipeline, no per-template i18n dictionary entries.
- No change to `deleteGame`/`updateGame`/Builder editing behavior itself.
- "Blank" is not migrated into Firestore — stays a client-side special case.
- No self-service (non-admin) template authoring.

## Decisions

### 1. Templates are `Game` documents flagged `isTemplate: true`, not a new collection
**Why**: literally satisfies "edit it like a regular game" — the admin uses the unmodified
Builder, `updateGame`, and `deleteGame`. Zero new editing UI to build or maintain.
**Alternative considered**: a dedicated `templates/{id}` collection with a bespoke editor
mirroring Builder's tile+modal pattern — rejected as substantially more code for no behavioral
gain, and it would drift from Builder over time as Builder evolves.

### 2. `listGameTemplates` uses a `collectionGroup('games')` query via the Admin SDK
**Why**: templates are owned by whichever admin authored them (not a fixed system uid), so a
straight per-owner query can't list them all. Admin SDK reads bypass `firestore.rules` entirely
(server-only), so no rule change is needed — the callable itself is the access boundary, same
posture as `listPlatformUsers`.
**Requires**: a new Firestore index on `isTemplate` at `COLLECTION_GROUP` scope — without it the
first production query fails `FAILED_PRECONDITION`. Grouping/sorting by `templateOrder` happens in
application code (not in the query), so this is a single-field `fieldOverrides` entry, not a
composite index — matching the existing `runs.ownerUid` precedent in `firestore.indexes.json` for
the identical shape of problem (`collectionGroup(...).where(field, '==', value)`). Deploy the index
(`firebase deploy --only firestore:indexes`) **before** shipping the callable that queries it.

### 3. `cloneTemplateStages` does two passes: assign ids, then remap references
**Why**: `unlockAfterTaskIds` (Task) and `exclusiveGroups[].taskIds` (Stage) are the only two
fields in the `Game`/`Stage`/`Task` shape that reference another task's id
(`packages/shared/src/types/index.ts:397,486`). A single-pass rename (assign a new id, immediately
overwrite the old one everywhere) is unsafe because a task can be referenced before its own new id
has been assigned yet, depending on iteration order — so the map must be fully built (pass 1)
before any reference field is rewritten (pass 2).
**Alternative considered**: reuse `GameTemplate.build()`'s "always emit fresh ids, no remapping"
approach — rejected because it is exactly the bug this design fixes: a template built with
`unlockAfterTaskIds` would silently produce a game where later tasks never unlock.
**Fail-open**: an id that doesn't resolve in the map (e.g. an already-dangling reference in the
source) passes through unchanged rather than throwing — consistent with this codebase's
fail-open convention for non-critical/cosmetic data (`stuckGuards.ts`, `safeZone.ts` etc.).

### 4. Multilingual templates: `templateGroupKey` + `templateLang`, resolved client-side
**Why**: `translateGame` already exists and produces a fully independent `Game` doc with
machine-translated text — reusing it avoids a second translation pipeline. `templateGroupKey`
links siblings; `templateLang` tags which language a given doc's content is authored in.
`listGameTemplates` groups server-side (so the picker gets one card per template, not one per
language) but resolution of WHICH variant to instantiate happens client-side
(`currentLang → 'he' → first available`) — kept in one place, matching the "leak predicate lives
in exactly one place" precedent already established for `i18nLeak.ts`.
**Validation guard**: `setGameTemplateFlag` rejects a sibling whose `templateEmoji`/`templateOrder`
disagrees with its group's existing values — otherwise the picker's card (icon/position) would be
ambiguous depending on which variant happened to be returned first by Firestore.

### 5. `createGameFromTemplate` takes an already-resolved `templateGameId`
**Why**: keeps the callable's contract simple (clone this one doc) and keeps all language
decision-making in the picker, not duplicated server-side.

### 6. Full replacement of `templates.ts`, one-off backfill script
Per approved plan: migrate the 11 existing templates via `scripts/backfill-seed-templates.mjs`
(dry-run by default, mirrors `scripts/backfill-public-tasks.mjs`), verify against the emulator and
then production, then delete `templates.ts` + `templateLabels.ts`. No fallback path is kept.

## Test Strategy

- **Pure logic** (`npm test`, no emulator):
  - `scripts/test-clone-template-stages.ts` — id regeneration, reference remapping
    (`unlockAfterTaskIds`, `exclusiveGroups[].taskIds`), fail-open on unresolved ids, no field
    drift, no cross-call id collisions.
  - `scripts/test-template-picker-order.ts` (rewritten) — Blank-first ordering, group sort by min
    `templateOrder`, language-fallback resolution (`currentLang → 'he' → first available`).
  - `scripts/test-template-group-validation.ts` — sibling emoji/order match/mismatch predicate.
- **Callable** (`scripts/e2e-verify.mjs`, `npm run e2e`) — new scenarios per spec.md's scenarios
  below; the suite's callable-coverage guard forces all three new callables to be exercised.
- **UI**: preview tools per CLAUDE.md — `/admin/templates` access-denied for non-admin, full
  create→edit→flag→appears-in-picker→delete loop; `npm run i18n:check:strict` for the new admin
  page chrome.

## Risks / Trade-offs

- **[Risk]** A `collectionGroup` query across all users' `games` subcollections could in theory
  surface a non-template game if `isTemplate` is ever misread as truthy for an unrelated doc.
  → **Mitigation**: `isTemplate` is admin-only-writable (`setGameTemplateFlag` behind
  `assertAdmin`); `updateGame`'s existing allow-listed-fields payload (`BUILDER_EDITABLE_FIELDS`
  in `savePayload.ts`) does not include `isTemplate`, so a normal creator's autosave can never set
  it even accidentally.
- **[Risk]** Deploying the callable before the Firestore index finishes building causes production
  errors on first use. → **Mitigation**: call out explicit deploy ordering in tasks.md (index
  deploy is its own task, before the callable-deploying task, with a wait-for-ready check).
- **[Risk]** Backfill script mis-migrates a template (wrong ids, broken unlock graph) since it must
  now go through `cloneTemplateStages`-equivalent logic rather than the old `build()` factories.
  → **Mitigation**: the backfill's created docs are exactly what `createGameFromTemplate` will
  later clone from — verify by running the full create→instantiate→play loop against the emulator
  before touching production, and inspect at least one multi-stage/unlock-graph template
  (e.g. `city_tour` or `riddle`, whichever has cross-task unlocks) by hand.
- **[Trade-off]** `listGameTemplates` denormalizes projected fields per group per language rather
  than joining at read time — acceptable because template count is small (dozens, not thousands)
  and this mirrors the existing `publicTasks`/gallery denormalization pattern already used
  elsewhere in this codebase.

## Migration Plan

1. Add `Game` fields (non-breaking, additive, optional).
2. Ship `cloneTemplateStages` + its test, `functions/src/admin/templates.ts` callables + tests.
3. Deploy the Firestore composite index; confirm it's `READY` before the next step.
4. Deploy functions (the three new callables).
5. Ship `AdminTemplatesPage.tsx` + route (feature is now usable but Dashboard still reads the
   static array — no user-facing change yet).
6. Run `scripts/backfill-seed-templates.mjs --execute` against the emulator, verify end-to-end via
   preview tools.
7. Ship the `DashboardPage.tsx` picker rewrite (now reads Firestore-backed templates).
8. Run the backfill against production; verify the live picker.
9. Delete `templates.ts` + `templateLabels.ts` + the obsolete parts of
   `scripts/test-template-picker-order.ts`'s old assumptions.

Rollback: steps 1–5 are additive/inert until step 7 ships; if step 7 or later needs to roll back,
revert `DashboardPage.tsx` to read the static array again (keep `templates.ts` in git history — do
not force-push it away) while the Firestore-backed data stays intact for a retry.

## Open Questions

None outstanding — migration scope and the Blank-option question were resolved with the user
before this design was written (full replacement; Blank stays hardcoded).

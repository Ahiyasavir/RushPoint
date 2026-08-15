## 1. Shared types

- [x] 1.1 Add `isTemplate?`, `templateEmoji?`, `templateOrder?`, `templateGroupKey?`,
      `templateLang?` optional fields to `Game` in `packages/shared/src/types/index.ts`. Build
      `packages/shared` (`npm run typecheck` for that workspace) to confirm no downstream break.

## 2. `cloneTemplateStages` (RED -> GREEN -> REFACTOR)

- [x] 2.1 RED: write `scripts/test-clone-template-stages.ts` asserting: every output stage/task id
      differs from every input id; `unlockAfterTaskIds` on a cloned task points at the NEW id of
      the referenced task (not the source id); `exclusiveGroups[].taskIds` are rewritten the same
      way; a reference to an id absent from the source stages passes through unchanged
      (fail-open); all non-id fields are preserved; two calls on the same input share no id. Run
      it (`npx tsx scripts/test-clone-template-stages.ts`) and confirm it fails (module doesn't
      exist yet).
- [x] 2.2 GREEN: implement `functions/src/lib/cloneTemplateStages.ts` — two-pass algorithm
      (assign fresh ids into an `idMap`, then rewrite `unlockAfterTaskIds` and
      `exclusiveGroups[].taskIds` from that map) per design.md Decision 3. Re-run the test until
      green.
- [x] 2.3 REFACTOR: clean up naming/typing, add a short comment on WHY two passes are required
      (not what the code does).

## 3. Backend callables (RED -> GREEN -> REFACTOR)

- [x] 3.1 RED: add failing scenarios to `scripts/e2e-verify.mjs` for `setGameTemplateFlag`: admin
      flags own game → succeeds and is reflected in a direct Firestore read; non-admin call →
      `permission-denied`; mismatched-sibling `templateGroupKey` → `invalid-argument`. Run
      `npm run e2e` and confirm these fail (callable doesn't exist).
- [x] 3.2 GREEN: implement `setGameTemplateFlag` in `functions/src/admin/templates.ts`
      (`assertAdmin` + `enforceRateLimit`, existence check, sibling-match validation per
      design.md Decision 4), re-export from `functions/src/index.ts`. Re-run e2e until green.
- [x] 3.3 RED: add failing scenarios for `listGameTemplates`: grouped multi-language entry;
      single-language entry; tombstoned template excluded; response never contains `stages`/
      `tasks`. Confirm they fail.
- [x] 3.4 GREEN: implement `listGameTemplates` (Admin SDK `collectionGroup('games')` query,
      group-by-`templateGroupKey`, sanitized projection, min-`templateOrder` sort). Re-run until
      green. **Do not deploy against production yet — the composite index must exist first (see
      §5).**
- [x] 3.5 RED: add failing scenarios for `createGameFromTemplate`: successful instantiation
      preserves the unlock graph pointing at NEW ids; exclusive groups preserved; unknown/
      non-template `templateGameId` → `invalid-argument`; source template untouched after clone.
      Confirm they fail.
- [x] 3.6 GREEN: implement `createGameFromTemplate` (Admin SDK cross-owner read of the template,
      `cloneTemplateStages`, create under caller's own uid). Re-run e2e until all new scenarios
      are green.
- [x] 3.7 REFACTOR: shared `loadAllTemplateGames()` helper deduplicates the cross-owner query used
      by all three lookups; each callable's handler stays focused.

All three new e2e scenarios plus the two authz-denial rows PASS under
`node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"` (full suite: ✅ ALL PASS, including
the callable-coverage guard).

## 4. Extra pure-logic coverage

- [x] 4.1 RED: write `scripts/test-template-group-validation.ts` for the sibling
      emoji/order-match predicate extracted from `setGameTemplateFlag` (same-group mismatch
      rejected, same-group match accepted, first-in-group always accepted). Confirm it fails.
- [x] 4.2 GREEN: extracted into `packages/shared/src/gameTemplates.ts`
      (`templateGroupSiblingMatches`), called from both the callable and the test; re-run until
      green.
- [x] 4.3 RED: rewrite `scripts/test-template-picker-order.ts` to assert Blank-always-first,
      group sort by min `templateOrder`, and the language-resolution fallback
      (`currentLang → 'he' → first available`) for representative cases (both variants present,
      only `he` present, neither matches `currentLang`). Confirm it fails against the not-yet-
      extracted picker-ordering helper.
- [x] 4.4 GREEN: extracted into `apps/creator-web/src/lib/templatePicker.ts`
      (`orderTemplatesForPicker`, `resolveTemplateVariant`) so it's testable without rendering
      `DashboardPage.tsx`. Re-run until green.

`npm test` (`node scripts/run-unit-tests.mjs`, 179 pure-logic files including the 3 new/rewritten
ones) — all green.

## 5. Firestore index

- [x] 5.1 Added a single-field `fieldOverrides` entry for `games.isTemplate` at
      `COLLECTION_GROUP` scope to `firestore.indexes.json` — REVISED from the composite index
      originally proposed in design.md: grouping/sorting by `templateOrder` happens in application
      code, not in the query, so only the equality filter needs an index (matches the existing
      `runs.ownerUid` precedent for the identical shape of problem). design.md updated to match.
- [ ] 5.2 Deploy the index (`firebase deploy --only firestore:indexes`) to the REAL project and
      confirm it reaches `READY` status before `listGameTemplates`/`createGameFromTemplate` are
      called against real Firestore. **NOT DONE — requires production deploy access; this is the
      user's action, called out explicitly in the final summary.**

## 6. creator-web wrappers

- [x] 6.1 Added typed wrappers `listGameTemplates`, `setGameTemplateFlag`, `createGameFromTemplate`
      to `apps/creator-web/src/services/calls.ts` following the existing `callable<Req,Res>(name)`
      pattern.

## 7. Admin templates page

- [x] 7.1 Created `apps/creator-web/src/pages/AdminTemplatesPage.tsx`: client `isAdminClaim` gate
      (mirrors `AdminUsersPage.tsx`), fetches own games via `listGames()` filtered to
      `isTemplate === true`, renders as a responsive card grid (`components/ui.tsx` primitives).
- [x] 7.2 Wired actions: New (create + flag + navigate to `/build/:gameId`), Edit (navigate to
      Builder), Icon & order (inline emoji/templateOrder editor calling `setGameTemplateFlag`),
      Delete (existing soft-delete flow via `dialog.confirm`).
- [x] 7.3 Registered route `/admin/templates` in `App.tsx` via `lazyWithRetry`, matching the
      `/admin/users` registration pattern; added a reciprocal link between the two admin pages.
- [x] 7.4 New UI copy added through `t.*` (`adminTemplates` namespace, both HE and EN
      dictionaries) — `npm run i18n:check:strict` passes clean (PART A + PART B, zero new findings).
- [x] 7.5 Verified via the Browser preview tools against a live emulator: non-admin denied (🔒
      screen), full create-flag-view→open in Builder→edit icon&order (saved live)→delete loop, all
      confirmed via the actual rendered page (not just network responses), zero console errors.

## 8. Dashboard picker rewrite

- [x] 8.1 Replaced the static `TEMPLATES` import in `DashboardPage.tsx` with a `listGameTemplates()`
      fetch on picker open (cached for the session); "Blank" stays hardcoded client-side, always
      first (`blankStage()` inline helper, matching the old `templates.ts` blank `build()` exactly).
- [x] 8.2 Uses `orderTemplatesForPicker` (§4.4) to sort/resolve fetched groups; renders
      `templateEmoji`, resolved `title`/`description`, and precomputed `stageCount`/`taskCount`.
- [x] 8.3 `newGame()` now calls `createGameFromTemplate({ templateGameId, title, scoringPreset })`
      for a template selection (single atomic server call — no orphan-cleanup path needed, unlike
      the old two-step create+seed); Blank still calls `createGame` + `updateGame` with the
      inline-seeded stage.
- [x] 8.4 Verified via the Browser preview tools: picker shows Blank first, then all 11
      Firestore-backed templates correctly ordered with right emoji/counts; selecting one
      (`youth_group`) and clicking Create opened the Builder on a NEW game with the cloned 3
      stages / 6 tasks and real bilingual content, zero console errors.

## 9. Migration

- [x] 9.1 Wrote `scripts/backfill-seed-templates.mjs` (dry-run by default, `--execute`,
      `--admin-uid=<uid>` required, `--project`/`--confirm-project` for a real project) that reads
      the current 11 `TEMPLATES` entries (minus `blank`), calls each `.build()`, and creates one
      flagged `Game` doc per template under the given admin uid, preserving array order as
      `templateOrder`. Idempotent: skips a title that already exists as a template under that uid.
- [x] 9.2 Ran the backfill against the emulator: dry-run (correctly listed all 11 candidates with
      accurate stage/task counts, wrote nothing) then `--execute` — **11/11 created, 0 skipped,
      exit 0**. The `city_tour`/`riddle`/etc. templates with narrative intro/outro and the
      `createGameFromTemplate` id-remapping path were already exercised end-to-end by the e2e
      "game templates" scenario (§3) against synthetic templates with `unlockAfterTaskIds` +
      `exclusiveGroups`, confirming the clone logic before this real-data run.
- [ ] 9.3 Run the backfill against production (after §5.2's index is `READY` and this change is
      deployed); verify the live picker. **NOT DONE — production data mutation requires the user's
      explicit action and real project credentials; called out in the final summary.**

## 10. Cleanup

- [ ] 10.1 **DEFERRED, not a plan deviation but a dependency**: `apps/creator-web/src/templates.ts`
      is intentionally NOT deleted yet — `scripts/backfill-seed-templates.mjs` reads it as its
      migration data source, and that script still needs to run against production (§9.3) before
      the static file can safely be removed. Delete it only after §9.3 is done. `templateLabels.ts`
      is NOT deleted at all — see the proposal.md correction (still used for the hardcoded Blank
      card's copy plus unrelated helpers).
- [x] 10.2 Grepped for remaining imports: zero references to `templates.ts` in `apps/creator-web/src`
      besides the file itself; the only remaining code reference anywhere is the backfill script.
- [x] 10.3 `scripts/test-template-picker-order.ts` was fully rewritten (§4.3) and no longer
      references the static array — it tests `templatePicker.ts`'s pure functions directly.

## 11. Final gate

- [x] 11.1 `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · origin:check · i18n:check:strict) — **green, exit 0** (two real regressions
      caught and fixed along the way: a `no-floating-promises` lint error in `DashboardPage.tsx`,
      and two failing pure tests — `test-callable-exports.ts` needed `admin/templates.ts` added to
      its known-modules list, `test-no-dashes.ts` needed two new UI strings rewritten without an
      em dash, both project house-style guards this change had not yet satisfied).
- [x] 11.2 `node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"` — **✅ ALL PASS** (1258
      checks, 0 failures), including all new `setGameTemplateFlag`/`listGameTemplates`/
      `createGameFromTemplate` scenarios, the two new authz-denial rows, and the callable-coverage
      guard. Re-run after the callable re-export was moved to `admin/templates.ts` — still green.
- [ ] 11.3 Confirm `firestore.indexes.json`'s new index is deployed and `READY` in the target
      Firebase project — **NOT DONE**, blocked on the same production-access constraint as §5.2/§9.3.

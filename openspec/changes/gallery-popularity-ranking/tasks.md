# Tasks — gallery-popularity-ranking

Strict RED → GREEN → REFACTOR. Do not write production code before the test that demands it.

## 0. Baseline

- [x] 0.1 Capture the pre-change `npm run i18n:check:strict` result so "zero new findings" is provable.

## 1. RED — the popularity formula (pure)

- [x] 1.1 Write `packages/shared/src/popularity.test.ts` encoding the whole contract **before** the
      module exists: 3:1 use/like weighting, `log10` compression (10x engagement ⇒ exactly `+1.0`),
      the newness calibration (80 days ties a 10x incumbent), time-invariance of the score (the
      "no cron" property), `NaN`/`Infinity`/negative/missing-`createdAt` clamping,
      `comparePopularity` totality (antisymmetric + transitive over a seeded sample, never 0 for
      distinct ids), and `rankGalleryResults` relevance tiers with popularity as tiebreak.
      Run `npm test` and confirm it fails for the right reason (module not found).

## 2. GREEN — the popularity module

- [x] 2.1 Add `packages/shared/src/popularity.ts` with the constants, `popularityScore`,
      `comparePopularity`, `relevanceTier`, `rankGalleryResults`, and `PublicLikeKind`.
      Re-export from `packages/shared/src/index.ts`. `npm test` green.

## 3. Shared types, paths, rate-limit budget

- [x] 3.1 Extend `scripts/test-firestore-paths.ts` with `publicLike` / `publicLikesCol` cases and
      confirm it fails (paths do not exist).
- [x] 3.2 Add `likeCount?` / `popularity?` to `PublicGame` and `PublicTask`, the `PublicLike` type,
      and `FIRESTORE_PATHS.publicLike` / `.publicLikesCol` in `packages/shared/src/types/index.ts`.
      Add the `setPublicLike` budget to `packages/shared/src/rateLimit.ts`. `npm test` green.

## 4. RED — callable behaviour (e2e scenario; NOT runnable in this session)

- [x] 4.1 Add the `gallery popularity + likes` scenario to `scripts/e2e-verify.mjs` with every
      assertion from design.md §Test strategy lane 3, including the denormalization-consistency
      oracle and the `assertTaskPayloadAllowlisted` check. **Emulator is off-limits this session —
      this scenario is written but UNVERIFIED and must be run before the change is done.**
- [x] 4.2 Add the rules denial cases to `scripts/test-rules.mjs` (client cannot write
      `likeCount`/`popularity`; cannot read or write `publicLikes`). Also UNVERIFIED.

## 5. GREEN — server

- [x] 5.1 `functions/src/gallery/popularityStore.ts`: `bumpPublicSignals()` — one transaction,
      counter + recomputed score, `max(0, …)` clamps, flat top-level `update()` keys only.
- [x] 5.2 `setPublicLike` callable in `functions/src/gallery/index.ts` (auth + `enforceRateLimit` +
      desired-end-state transaction over the deterministic like id). Re-export from
      `functions/src/index.ts`.
- [x] 5.3 Order both search callables by `popularity` desc with the legacy-document union fallback,
      widen the text-search candidate window to the hard cap, rank with `rankGalleryResults`, trim
      to `limit`, and return `likedIds` via `getAll` point reads.
- [x] 5.4 Route `incrementTaskCopyCount` and `duplicateGame`'s public bump through
      `bumpPublicSignals`; add the missing `launchRun` public play bump.
- [x] 5.5 `publishGame`: preserve existing `likeCount` / `copyCount` across a re-publish and seed
      `popularity` from the preserved counters.

## 6. RED → GREEN — creator-web pure like state

- [x] 6.1 Write `scripts/test-gallery-likes.ts` against a not-yet-existing
      `apps/creator-web/src/lib/likeState.ts`; confirm it fails.
- [x] 6.2 Implement `likeState.ts` (`applyOptimisticLike`, `reconcileLike`). `npm test` green.

## 7. GREEN — creator-web UI

- [x] 7.1 `services/calls.ts`: `setPublicLike` wrapper + `likedIds` on both search response types.
- [x] 7.2 `i18n.ts`: new `gallery.*` keys in **both** dictionaries (real Hebrew, no dash separators).
- [x] 7.3 `GalleryPage.tsx`: like control + count on game and task cards, own-state from `likedIds`,
      optimistic update reconciled against the server response.

## 8. Rules + indexes

- [x] 8.1 `firestore.rules`: deny all client read/write on `publicLikes`.
- [x] 8.2 `firestore.indexes.json`: add `tags CONTAINS + popularity DESC` for both collections.

## 9. REFACTOR + gates

- [x] 9.1 Remove duplication: every signal writer goes through `bumpPublicSignals`; the server and
      the client both rank through the shared pure functions; no hardcoded Firestore paths.
- [x] 9.2 Ran and recorded: `npm run typecheck` (5/5 green) · `npm run lint` (0 errors, 42 pre-existing
      warnings) · `npm test` (all lanes green, incl. the new popularity + like-state files) ·
      `npm run i18n:check:strict` (PART A and PART B clean, identical to the 0.1 baseline ⇒ zero new
      findings). `creator:build` / `play:build` were NOT re-run at the end: the tree is shared with
      other in-flight agents, so the coordinator runs the full suite once, serially, after everyone lands.
- [ ] 9.3 **BLOCKED THIS SESSION (emulator off-limits):** run `npm run e2e` and `npm run test:rules`
      and confirm green. The change is NOT done until these pass.

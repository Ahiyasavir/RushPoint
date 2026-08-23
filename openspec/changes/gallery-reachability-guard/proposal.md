# Change: gallery-reachability-guard

## Why
A creator opened `/creator/gallery` on the live tunnel and saw a raw **"INTERNAL"**
dialog with the game/mission cards stuck as skeletons — the gallery could not reach any
games or missions. The console showed `searchGallery` returning HTTP **500** and
`FirebaseError: INTERNAL`.

### ACTUAL root cause (found by reproducing live in the browser against seeded data)
The emulator logged the real throw: `TypeError: Cannot read properties of null (reading
'length')` in `fetchRankedWindow`'s `withTags` (`tags.length`). **`tags` was `null`.**
The gallery filter bar (`7c202cf`) started sending absent facets as `undefined`
(`tags: gameTags.length ? gameTags : undefined`, `mode: gameMode || undefined`, …); the
Firebase **callable SDK serializes `undefined` to `null` on the wire**, so the server's
destructuring default (`tags = []`, which only applies to `undefined`) did NOT apply →
`null.length` → 500 on every gallery open. This regressed exactly when the filter bar
landed (~05:14, after the 3am "working" state, when the client sent only `{query, limit}`
with no facet keys → server default `[]`). The e2e passed because it OMITS the keys — it
never sent the `null` shape the real client sends.

**Fix:** coerce every optional facet at the `searchGallery`/`searchTaskLibrary` boundary
(null/omitted = "no filter"), and harden `fetchRankedWindow`'s `withTags`
(`Array.isArray(tags) && tags.length > 0`). Verified live: searchGallery 500 → **200 OK,
4 games + 48 missions render**. The e2e reachability scenario now also sends the explicit
`null`-facet client shape so this cannot regress.

### Compounding issue also fixed (stale-shared bundle)
Separately confirmed and hardened (not the trigger here, but a real deploy fragility):

- `functions/` builds with `esbuild --bundle` and does **not** mark `@rushpoint/shared`
  external, so shared is **inlined into `lib/index.js` from `packages/shared/dist` at
  build time**.
- esbuild does **not** fail on a missing named export — it bundles it as `undefined`.
- The playtest auto-deploy supervisor (`scripts/playtest-forever.mjs`) compiled
  `functions` **before** rebuilding `@rushpoint/shared`, so the first pull that added a
  new shared export (`applyGalleryFacets`, from the gallery facet/tags work) froze a
  **stale** shared into the functions bundle. At runtime `searchGallery` called
  `applyGalleryFacets` (`undefined`) → threw → surfaced as `500 INTERNAL`.
- Secondary: the creator client echoed the raw callable error (`e.message === "INTERNAL"`)
  straight into a dialog, so the failure was opaque and untranslated.

This class of failure is invisible to `tsc --noEmit` (it checks source, not the emitted
bundle) and to esbuild's own exit code, so nothing caught it before a real device did.

## What Changes
Three fixes (already implemented) plus the SDD/TDD that lock them in:

1. **Functions never inline a stale shared** — `functions/package.json` gains a
   `prebuild` hook that rebuilds `@rushpoint/shared` before esbuild, so any DIRECT
   `npm run build --workspace=functions` (the auto-deploy supervisor's compile-gate and
   `deploy`, both of which bypass turbo's dependency ordering) produces a bundle that
   inlines a fresh shared. (`turbo run build` already ordered them via the devDependency
   edge; only the direct call was unguarded.)
2. **Auto-deploy build order** — `scripts/playtest-forever.mjs` `buildProd()` rebuilds
   shared before the functions compile-gate (belt-and-suspenders with #1; also makes the
   supervisor honor the documented "shared before functions" invariant once it restarts).
3. **Friendly client error** — `GalleryPage` shows the localized `t.gallery.searchFailed`
   instead of leaking a raw server code, and logs the real error to the console.

## Guards (TDD)
- **Pure build-integrity guard** `scripts/test-functions-shared-bundle.ts` (in `npm test`):
  asserts from source that (a) functions declares `@rushpoint/shared`, (b) shared is
  bundled (`--bundle`, not `--external`), and (c) the functions build rebuilds shared
  first. Reads only `functions/package.json` (never a build artifact), so a stale build
  can neither fake it green nor fail it. This is the guard that keeps the exact
  stale-shared → `undefined` → `INTERNAL` regression from ever recurring.
- **e2e reachability scenario** `scripts/e2e-verify.mjs` — "gallery reachability
  (published game + missions are findable)": publishes a game with a tag + a located
  mission + a locationless mission, then asserts it is reachable via `searchGallery`
  (text, tag filter, and the exact `mode`+`sort` facet args the UI sends) and its missions
  via `searchTaskLibrary` (including `type`+`hasLocation` facets), plus `getPopularTags`
  does not throw. A throw in that path aborts the scenario and fails the suite.

## Impact
- Functions: `functions/package.json` (prebuild). No dependency change → `npm ci` stays
  valid on the auto-deploy host.
- Scripts: `scripts/playtest-forever.mjs` (build order),
  `scripts/test-functions-shared-bundle.ts` (new, auto-discovered by the unit runner),
  `scripts/e2e-verify.mjs` (new reachability scenario — also satisfies the callable
  coverage guard for `searchGallery`/`searchTaskLibrary`/`getPopularTags`).
- Creator-web: `apps/creator-web/src/pages/GalleryPage.tsx` (friendly error).
- No schema, callable-surface, or data-model change. No new i18n keys (reuses
  `t.gallery.searchFailed`).

## Non-goals
- Not switching `@rushpoint/shared` to an `--external` runtime dependency (would break the
  production Firebase deploy, which has no monorepo to resolve it from). The contract is
  and stays: shared is bundled inline, kept fresh by building it first.

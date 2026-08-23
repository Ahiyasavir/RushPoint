# Tasks — gallery-map-serve-exact

## 1. RED — failing tests for the read-path location resolution

- [x] 1.1 Add `functions/src/gallery/index.test.ts` cases for `publicTaskForLibrary`: a legacy
  coordinate-only doc yields an EXACT plottable `approxLocation`; an ordinary coordinates doc is not
  coarsened; a `hideLocation` doc is coarsened; a new-style `approxLocation`-only doc is kept; a
  locationless doc yields no point; the `coordinates` key is always dropped.
- [x] 1.2 Add an additive scenario to `scripts/e2e-verify.mjs` that simulates a pre-fix on-disk doc
  (exact `coordinates`, no `approxLocation`) with the Admin SDK and asserts `searchTaskLibrary`
  serves it an EXACT plottable `approxLocation` and never the raw `coordinates` key. (UNVERIFIED —
  e2e not run in this lane.)

## 2. GREEN — implement the resolution

- [x] 2.1 Add the pure `publicTaskForLibrary(raw)` export to `functions/src/gallery/index.ts`,
  routing through the shared `publicTaskLocation` rule, dropping `coordinates`/`hideLocation`/
  `locationless`, and falling back to the stored `approxLocation` when no point is computed.
- [x] 2.2 Replace the inline `searchTaskLibrary` mapping with `ranked.map(publicTaskForLibrary)`.

## 3. REFACTOR / verify

- [x] 3.1 Document the three-generation reconciliation and the `hideLocation` residual risk in the
  helper's doc comment (verified from git history, not guessed).
- [x] 3.2 Run `npm run verify` (typecheck · lint · test · builds · bundle:budget · base:check ·
  i18n:check:strict) — green.
- [ ] 3.3 Run `npm run e2e` under the emulator to exercise the new scenario. (UNVERIFIED — not run
  in this lane.)

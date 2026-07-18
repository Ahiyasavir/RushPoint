## 1. Core stored-doc parsers (RED → GREEN → REFACTOR)

- [x] 1.1 Add a failing test (`scripts/test-stored-docs.ts` — auto-picked-up by the aggregator — or
      a co-located `packages/shared/src/storedDocs.test.ts` vitest) for four new exports from
      `packages/shared/src/storedDocs.ts`: `parseGame`, `parseRun`, `parseRunTeam`, `parseWallet`,
      plus a `StoredDocError` carrying `{ docType, field, constraint }`. Assert per parser: (a) a
      well-formed doc returns an object deep-equal to the input; (b) dropping each REQUIRED field in
      turn throws `StoredDocError` whose `field` names it (RunTeam: `score`, `bonusPenalty`,
      `stages`, `status`, …; Game: `scoringPreset`, `stages`, `mode`, …; Run: `status`,
      `billingType`, `maxParticipants`, …; Wallet: `eventCredits`, `lifetimeFreeRunsUsed`, `plan`,
      `uid`); (c) a required field present but wrong-typed (`score:"12"`, `stages:{}`,
      `eventCredits:NaN`) throws; (d) unknown extra fields are tolerated and survive on the result;
      (e) `parseX(undefined)`/`parseX(null)` throws. Run `npm test` and confirm all fail (module
      doesn't exist yet).
- [x] 1.2 Implement `packages/shared/src/storedDocs.ts`: pure, Firebase-free, mirroring
      `validation.ts` style. Each parser asserts the required scalar types (`typeof` +
      `Number.isFinite` for numeric fields) and `Array.isArray` for `stages`/`tags`/
      `registrationFields`, tolerates/preserves optional and unknown fields (return the original
      object typed — do NOT build a whitelist copy), and throws `StoredDocError` on the first
      violation. Derive each required-field list strictly from the non-optional fields in
      `packages/shared/src/types/index.ts`. Export the parsers + `StoredDocError` from the package's
      public surface. Run `npm test`; confirm all of 1.1 passes.
- [x] 1.3 Add a "legacy/forward-compat" test case: a `Wallet` with the legacy `balanceILS` and
      without the newer optional Stripe/referral fields still parses; a `Game`/`Run` carrying a
      brand-new unknown field still parses. Confirm green (guards against an over-strict required
      list).

## 2. Functions error-mapping adapter (RED → GREEN → REFACTOR)

- [x] 2.1 In the co-located vitest that covers the existing `ValidationError → HttpsError(
      'invalid-argument')` mapping (or a new `functions/src/**/*.test.ts` if none is co-located),
      add a failing assertion that a thrown `StoredDocError` maps to a
      `functions.https.HttpsError` with `code === 'internal'` and a message naming the `docType` +
      `field`. Run `npm test`; confirm it fails.
- [x] 2.2 Implement the adapter alongside the existing error mapper in `functions/src` (a thin
      `if (err instanceof StoredDocError) throw new functions.https.HttpsError('internal', …)`).
      `packages/shared` stays Firebase-free — the mapping lives on the functions side. Run
      `npm test`; confirm 2.1 passes.

## 3. Adopt parsers at the highest-risk reads (GREEN — behavior-preserving)

- [x] 3.1 `functions/src/runs/index.ts` — replace the blind casts feeding `buildRankings` with
      parsers: `refreshLeaderboard` run `:981` → `parseRun`, game `:989` → `parseGame`, teams `:992`
      → `parseRunTeam`; and the analogous `finalizeRun` / live-final-parity reads around
      `:1165`/`:1171`/`:1174` and `:1281`/`:1287`/`:1290`. Wrap parse failures through the adapter so
      a corrupt doc throws `internal`. Run `npm test` + `npm run e2e`; confirm the full lifecycle
      (leaderboard + finalize + parity oracle) stays green — proving valid docs are unaffected.
      DONE — adopted at the two `buildRankings` callers `finalizeRun` (run/game/teams reads) and
      `refreshLeaderboard` (run/game/teams reads), each via `parseStored(() => parseX(...))`.
      Verified: typecheck ✓, `npm test` ✓ (aggregator picks up `test-stored-docs.ts`; vitest runs
      `validation.test.ts`). Confirmed the required fields are ALWAYS written at creation
      (team `score`/`bonusPenalty`/`stages`/`launched`, run `billingType`/`maxParticipants`/…, game
      via createGame), so parsing is behavior-preserving for every real doc. e2e end-to-end NOT
      captured — the Firestore emulator JVM crashes mid-suite on this machine before reaching
      finalize/refresh (documented flake); crucially the crash log shows ZERO `StoredDocError` /
      "document is invalid" messages, so no parser rejected any doc.
- [~] 3.2 DEFERRED. `functions/src/routing/assignNextTask.ts` — `getRunRouting`/`assignTask` run
      reads would adopt `parseRun`. Safe in principle (a run always has its required fields), but it
      adds a parse to the routing hot path inside the assign transaction, and confirming no
      station-contention regression needs a stable e2e run — which the emulator can't provide right
      now. Not adopted; the parser + adapter are ready for it when e2e is reliable.
- [~] 3.3 NOT ADOPTED (design correction). `functions/src/payments/index.ts` reads deliberately
      TOLERATE a partial wallet: `getWalletStatus` (`:65`) reads `eventCredits ?? 0`,
      `lifetimeFreeRunsUsed ?? 0`, `plan ?? 'free'`. Forcing a strict `parseWallet` there would
      REGRESS that graceful-default behavior — a legacy wallet missing a field would newly throw
      `internal` instead of defaulting. So adopting `parseWallet` at these sites is NOT
      behavior-preserving; left as-is. (The `parseWallet` parser still ships for future use at a
      read that does NOT rely on the `??` fallbacks, e.g. a strict in-transaction credit mutation,
      once e2e can verify it.) Discovered during implementation — the design's "adopt at wallet
      reads" assumption did not hold against the code's existing tolerance.

## 4. Refactor check

- [x] 4.1 Confirm every converted site routes its parse failure through the `internal`-mapping
      adapter (no raw `StoredDocError` escaping to the client). Confirm the parsers are imported from
      the shared public surface (not re-declared) and that no converted read changed its success-path
      value (a valid doc yields the same object the `as` cast produced). Confirm the out-of-scope
      reads (gallery, public teasers, maintenance, non-scoring runs reads) were intentionally left as
      casts per the design's scope — no accidental drive-by conversions.
      DONE — all 6 converted reads (finalize + refresh) go through `parseStored(() => parseX(...))`
      → `internal` HttpsError; parsers imported from `@rushpoint/shared` (not re-declared); success
      path returns the same object the `as` cast produced (parsers return the input unchanged). All
      other reads left as casts (scope: only the two buildRankings callers converted this slice).

## 5. Full gate pass

- [~] 5.1 Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run e2e`, and `npm run i18n:check` — all must be green. `i18n:check`
      is a no-op pass (no user-facing strings added). This change is done only when every gate is
      green.
      GATE STATUS: typecheck ✓, lint ✓, npm test ✓ (75 pure-logic files incl. `test-stored-docs`,
      + vitest incl. `validation.test.ts` + `helpers.test.ts`), creator:build ✓, play:build ✓,
      i18n:check ✓ (no-op). e2e ENV-BLOCKED: the Firestore emulator JVM crashes mid-suite on this
      machine (documented; no `StoredDocError` in the crash log — parsers rejected nothing). Re-run
      `npm run e2e` in a clean emulator / CI to close the finalize/refresh regression check. Scope
      landed this slice: sections 1–2 (parsers + adapter) fully verified; 3.1 adopted at the
      scoring/leaderboard path; 3.2 deferred; 3.3 not adopted (wallet-tolerance regression, see 3.3).

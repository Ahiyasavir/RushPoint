# Tasks — game-file-export-import

Strict TDD. Every logic task is RED (write the failing test, run it, confirm it fails for the
right reason) → GREEN (minimum code) → REFACTOR. Do not reorder.

## 1. Baseline

- [x] 1.1 Capture the pre-change gate baseline so no pre-existing red is attributed to this
      change: `npm run typecheck`, `npm run lint`, `npm test`, `npm run i18n:check:strict`.
      Record the output. (Expected: all green; i18n strict clean in both PART A and PART B.)

## 2. RED — the round-trip property and the format contract (pure lane)

- [x] 2.1 Create `scripts/test-game-file.ts` with a seeded `Game` generator (LCG, no new
      dependency, mirroring `functions/src/__property__/invariants.property.test.ts`) that emits
      games covering: all nine task types; every optional task/stage/game field independently
      present and absent; Hebrew/RTL strings and emoji in titles, descriptions, clues, hints and
      answers; an empty stage list; a stage with `requiredTaskCount`; exclusive groups; an acyclic
      unlock graph; and media arrays (image / video / YouTube).
- [x] 2.2 Write the **round-trip property** test: for 300 seeded samples,
      `parseGameFile(serializeGameToFile(g)).game` deep-equals `g` restricted to the authored key
      set, and re-serializing yields a document identical to the first excluding `exportedAt`.
      Run `npx tsx scripts/test-game-file.ts` and confirm it fails because `gameFile.ts` does not
      exist yet.
- [x] 2.3 Add the **secrets-present** test: a fully-loaded game exports `answers`, `orderItems`,
      `numericAnswer`, `steps[].answer`, `hint`, `smart.secretCode`, and the `coordinates` of a
      `hideLocation` task. Confirm RED.
- [x] 2.4 Add the **exclusions** test: the serialized document has no `id`, `ownerUid`,
      `visibility`, `playCount`, `createdAt`, `updatedAt`, `deletedAt`, `deletedBy`,
      `integrationWebhookUrl`, `integrationPlatform`, `currentTeamCount` or `smart.stationCoords`
      key, even when the source game carries every one of them. Confirm RED.
- [x] 2.5 Add the **refusal** tests, each asserting an error is returned and no game is produced:
      wrong/absent `format`; `schemaVersion` = `CURRENT + 1` (message names both versions);
      `schemaVersion` non-integer; missing game title; task with no `id`; task with no `type`;
      cyclic unlock graph within a stage; over-byte / over-stage / over-task / over-string-length
      documents each naming their bound. Confirm RED.
- [x] 2.6 Add the **key-list drift guard**: every key of a fully-populated `Task`, `Stage` and
      `Game` literal must appear in either the exported key list or an explicit
      `DELIBERATELY_EXCLUDED` list; an unclassified key fails. Confirm RED.

## 3. GREEN — the pure serialize/deserialize core

- [x] 3.1 Create `packages/shared/src/gameFile.ts`: `GAME_FILE_FORMAT`,
      `CURRENT_GAME_FILE_VERSION = 1`, `MAX_GAME_FILE_BYTES` / `MAX_FILE_STAGES` /
      `MAX_FILE_TASKS` / `MAX_FILE_STRING_LEN`, the `GameFile` types, the four exported key lists
      + `DELIBERATELY_EXCLUDED`, `serializeGameToFile()`, `parseGameFile()` (returns
      `{ game, errors }`, never throws), `upgradeGameFile()` (empty chain at v1) and
      `gameFileFilename()`. Pure — no Firebase imports.
- [x] 3.2 Export it from `packages/shared/src/index.ts`.
- [x] 3.3 Re-run `npx tsx scripts/test-game-file.ts` until every test from §2 is GREEN. Confirm
      `npm test` picks the new script up via `scripts/run-unit-tests.mjs`.

## 4. RED — callable behavior (e2e lane, write now, cannot run here)

- [x] 4.1 Add the scenario `game file export/import (owner-only, round trip, launchable)` to
      `scripts/e2e-verify.mjs`, encoding every assertion listed in design.md § "E2E lane":
      owner export shape + secrets present + server-owned fields absent; **non-owner denied**;
      nonexistent game `not-found`; owner import creates a NEW private caller-owned game with
      `playCount` 0 and identical answer keys; the imported game **launches**; re-export parity;
      four malformed imports each `invalid-argument` **with `listGames` length unchanged**; and a
      document naming a foreign `ownerUid`/`id` producing a caller-owned game with a fresh id.
- [ ] 4.2 ⚠️ **Do not start the emulator in this session.** Record the scenario as written but
      UNVERIFIED. When an emulator is available, run `npm run e2e` and confirm it fails for the
      right reason (the callables do not exist) before §5.

## 5. GREEN — the callables

- [x] 5.1 Add `exportGameFile` to `functions/src/games/index.ts`: `requireAuth`, load
      `users/{uid}/games/{gameId}`, `not-found` if absent, `permission-denied` if
      `ownerUid !== uid`, `assertGameNotDeleted`, return `{ file: serializeGameToFile(game) }`.
      No `sourceOwnerUid` parameter and no public-game path.
- [x] 5.2 Add `importGameFile` to the same module: `requireAuth`; `parseGameFile` on the payload;
      refuse with `invalid-argument` joining `errors` with ` · ` when non-empty; then run the same
      semantic guards `updateGame` runs (`gameStructureProblems`, `validateUnlockGraph`,
      `validateAvailabilityWindow`, `validateOrderItems`, `validateSurveyChoices`, the
      orderItems/quiz exclusivity rule) and the same normalizers (`sanitizeStagesText`,
      `normalizeStagesMedia`, `cleanGameInstructions`); allocate a new doc ref and perform a
      **single** `ref.set()` with server-assigned `id`, `ownerUid`, `visibility: 'private'`,
      `playCount: 0`, fresh `createdAt`/`updatedAt`. Return `{ gameId }`.
- [ ] 5.3 <!-- unticked: needs emulator/browser evidence --> Confirm both callables are re-exported (line 23 of `functions/src/index.ts` already
      re-exports `./games/index` — verify, do not duplicate) and appear in the emulator's callable
      list once one is available.

## 6. GREEN — creator-web wiring

- [x] 6.1 Add typed wrappers `exportGameFile` and `importGameFile` to
      `apps/creator-web/src/services/calls.ts`.
- [x] 6.2 Add i18n keys to **both** `he` and `en` in `apps/creator-web/src/i18n.ts`: export label,
      import label, download success, and one message per refusal class (not a RushPoint game
      file / exported by a newer version / too large / invalid). Hebrew must be real Hebrew;
      no `—`, `–` or ` - ` separators (INSTRUCTIONS §3.C).
- [x] 6.3 Wire the Export and Import actions into the Builder header area in
      `apps/creator-web/src/pages/BuilderPage.tsx`: Export downloads a Blob named via
      `gameFileFilename`; Import reads a file, `JSON.parse`s it, pre-checks with the pure
      `parseGameFile`, calls the callable, and navigates to the new game. Every visible string via
      `t.*`. **Do not touch `DashboardPage.tsx` or `WalletPage.tsx`.**
- [x] 6.4 Run `npm run i18n:check` and `npm run i18n:check:strict` and confirm both are clean with
      **zero** new findings against the §1.1 baseline.

## 7. REFACTOR

- [x] 7.1 Extract the semantic stage validation currently inlined in `updateGame`
      (`functions/src/games/index.ts`) into one local `stagesProblems(stages): string[]` helper,
      and have **both** `updateGame` and `importGameFile` call it, so the two entry points can
      never accept different games. Re-run the pure lane; behavior must be unchanged.
- [x] 7.2 Review `gameFile.ts` for duplication against `validation.ts` — reuse
      `stripUnsafeDisplayChars` and `isValidCoord` rather than re-implementing them.

## 8. Gates

- [ ] 8.1 `npm run typecheck` — green. (If it reports `No matching export … from './runs/index'`,
      that is the concurrent-`shared:build` artifact described in CLAUDE.md; re-run once before
      treating it as real.)
- [ ] 8.2 `npm run lint` — 0 errors.
- [ ] 8.3 `npm test` — green, including the new `scripts/test-game-file.ts`.
- [x] 8.4 `npm run i18n:check` **and** `npm run i18n:check:strict` — both clean, zero new findings.
- [ ] 8.5 `npm run creator:build` and `npm run play:build` — both pass.
- [ ] 8.6 `npm run e2e` — ⚠️ **BLOCKED in this session** (a live tunnel is running; the emulator
      must not be started). Must be run, and the new scenario confirmed green, before this change
      is declared done. Until then the callable behavior is UNVERIFIED.

# Tasks — game-import-hardening

Strict TDD. Every logic task is RED (write the failing test, run it, confirm it fails for the right
reason) → GREEN (minimum code) → REFACTOR. Do not reorder.

⚠️ A live playtest stack owns the emulator on this machine: no `e2e`, `verify:emulator`,
`test:rules`, `dev:all`, `playtest` or `simulate` may be run. e2e assertions are written, not run.

## 1. Investigate before writing

- [x] 1.1 Read the import path end to end — `packages/shared/src/gameFile.ts` (`parseGameFile`,
      `pick`, `clone`, `overlongString`) and `importGameFile` + `stagesProblems` in
      `functions/src/games/index.ts` — and record which threats are ALREADY closed.
      (Result: envelope/version/byte cap, stage+task counts, string cap, allow-list `pick()`,
      required ids/titles, task-type enum, `isValidCoord`, unlock graph, availability windows,
      ordering/survey rules, and the whole identity/authz-smuggling class are already closed.)
- [x] 1.2 Probe the shipped validator with hostile inputs and record the verbatim output in
      design.md. Only gaps demonstrated here may be implemented.
      (Result: 4 gaps — nested prototype-pollution keys, non-finite coercion, type confusion
      causing a downstream `TypeError` 500, unbounded array length + unbounded depth throwing
      `RangeError` in violation of the "never throws" contract.)

## 2. RED — the failing cases (pure vitest lane, no emulator)

- [x] 2.1 Create `packages/shared/src/gameFile.hardening.test.ts` with a shared valid-game builder
      (one helper producing a minimal accepted document plus per-case overrides), so every case
      differs from the accepted baseline by exactly the hostile value under test.
- [x] 2.2 **Prototype pollution**: `__proto__`, `constructor`, `prototype` as a key at the top of
      `game`, inside `branding`, inside a stage, inside a task, inside `task.smart`, inside
      `steps[0]` and inside `media`. Assert `game === null`, the reason names the key and its path,
      and `({} as any).polluted === undefined` after the call. Confirm RED.
- [x] 2.3 **Resource exhaustion**: `answers`, `choices`, `steps` and `unlockAfterTaskIds` longer
      than `MAX_FILE_ARRAY_LEN`; a multi-megabyte `description`; an over-long `hint`. Assert each
      names its field and bound. Confirm RED for the array cases (the string cases must already
      pass — they are regression guards for the existing cap).
- [x] 2.4 **Deep nesting**: a graph nested past `MAX_FILE_DEPTH`, passed as an object AND as raw
      JSON text. Assert a depth error is RETURNED and nothing is thrown (wrap in a try/catch that
      fails the test on throw). Confirm RED with `RangeError: Maximum call stack size exceeded`.
- [x] 2.5 **Type confusion**: `answers: 5`, `answers: ['a', 5]`, `choices: {}`, `steps: 'x'`,
      `steps: [1,2]`, `media: [1,2,3]`, `description: 42`, `title: 7`, `stages: {}`, `game: []`,
      root array / `null` / number. Assert each is a named refusal. Add the regression assertion
      that `gameStructureProblems` over the parser's output no longer throws for `answers: 5`.
      Confirm RED.
- [x] 2.6 **Numeric poison**: `NaN`, `Infinity`, `-Infinity` and `1e999`-in-text on `numericAnswer`,
      `numericTolerance`, `geofenceRadiusMeters`, `hintPenalty`, `pointValue`,
      `stage.requiredTaskCount` and `coordinates.lat/lng`; plus out-of-range `lat: 91` / `lng: 181`.
      Assert refusal by name, and that no accepted game ever carries a coerced `null` in place of a
      supplied number. Confirm RED.
- [x] 2.7 **Identity/authz smuggling** (regression, expected GREEN): a document carrying
      `ownerUid`, `id`, `visibility: 'public'`, `playCount: 9999`, `deletedAt`, `deletedBy`,
      `integrationWebhookUrl`, `credits` and `runs` parses successfully and the returned game
      carries **none** of those keys.
- [x] 2.8 **Round-trip integrity** (regression, expected GREEN): a fully-loaded game — all nine
      task types, Hebrew/RTL text in titles/descriptions/clues/answers, a ZWJ emoji sequence,
      media, unlock graph, availability windows, ordering + survey tasks — survives
      `serializeGameToFile` → `parseGameFile` unchanged with zero errors.
- [x] 2.9 Run `npm test --workspace=packages/shared` (or `npx vitest run` in `packages/shared`) and
      record the RED output verbatim in the change notes.

## 3. GREEN — the validator

- [x] 3.1 Add the bounds next to the existing `MAX_FILE_*` constants in
      `packages/shared/src/gameFile.ts`: `MAX_FILE_DEPTH`, `MAX_FILE_ARRAY_LEN`,
      `FORBIDDEN_KEYS` (`__proto__`, `constructor`, `prototype`), `MAX_FILE_PROBLEMS`.
- [x] 3.2 Implement `scanCandidateGraph(root)` — an **iterative** (explicit stack, never recursive)
      walk returning path-qualified problems for: forbidden key, depth over cap, array over cap,
      non-finite number, over-long string. It must subsume and then replace the recursive
      `overlongString` helper, preserving that helper's exact message text.
- [x] 3.3 Call the scan inside `parseGameFile` on the RAW game, **before** `clone()` (which is a
      JSON round trip and destroys `NaN`/`Infinity`), returning early on any finding.
- [x] 3.4 Add the field-type checks inside the existing per-task loop using declarative tables:
      string-array fields (`answers`, `choices`, `unlockAfterTaskIds`), object-array fields
      (`steps`), object-not-array fields (`media`), text fields, and optional finite-number fields.
      Extend the existing `unlockAfterTaskIds` check rather than duplicating it.
- [x] 3.5 Add the same guards at the stage level (`requiredTaskCount`, `tasks` must be an array,
      `exclusiveGroups`).
- [x] 3.6 Re-run the vitest lane and confirm every case from §2 is GREEN, including the two
      regression groups (2.7, 2.8) and the untouched `scripts/test-game-file.ts` round-trip
      property suite.

## 4. REFACTOR

- [x] 4.1 Reuse, don't re-derive: confirm `isValidCoord`, `stripUnsafeDisplayChars`,
      `validateUnlockGraph`, `validateAvailabilityWindow`, `validateOrderItems`,
      `validateSurveyChoices` and any existing tags normalizer are consumed as-is; delete any
      duplicate logic introduced during GREEN.
- [x] 4.2 Fold the per-task type tables into named constants with a comment stating why each field
      is checked (which crash it prevents), so a future field addition is an obvious edit.
- [x] 4.3 Document at the top of the import section: **unknown field ⇒ strip, forbidden key ⇒
      reject**, and why the two policies differ.

## 5. Callable coverage — WRITTEN, NOT RUN

- [x] 5.1 Append to the existing `game-file-export-import` scenario in `scripts/e2e-verify.mjs`:
      (a) a hand-edited file carrying another account's `ownerUid`, `visibility: 'public'` and
      `playCount: 9999` imports as a private game owned by the caller with `playCount: 0`;
      (b) a file with `answers: 5` is rejected with `invalid-argument`, never `internal`.
- [x] 5.2 Do **not** run `npm run e2e` (a live playtest stack owns the emulator). State explicitly
      in the report that these assertions are written but unrun.

## 6. Gates

- [x] 6.1 `npm run typecheck` — record verbatim.
- [x] 6.2 `npm run lint` — record verbatim.
- [x] 6.3 `npm test` — record verbatim (pure-logic aggregator + vitest, no emulator).
- [x] 6.4 `npm run creator:build` and `npm run play:build` — record verbatim.
- [x] 6.5 `npm run i18n:check` — run as insurance even though no UI file was touched; PART A and
      PART B both clean.

## 7. Notes from execution

- The two REGRESSION groups (2.7 identity smuggling, 2.8 round trip) were GREEN from the start, as
  expected: the identity/authz class was already closed by the exported-key allow-list plus the
  callable's server-side assignment. They stay in the suite as the guard that the hardening refuses
  nothing legitimate.
- Two field types were guessed wrong in the first GREEN pass and corrected against
  `packages/shared/src/types/index.ts`: `Stage.narrative` is `{ intro?, outro? }` and
  `Game.instructions` is a `GameInstructions` object (not text), and `Task.media` is `TaskMedia[]`
  (a list, not an object). The 300-sample round-trip property suite in `scripts/test-game-file.ts`
  caught both immediately — which is exactly what it is for.
- `parseGameFile` deliberately sanitizes titles/descriptions with `stripUnsafeDisplayChars`, which
  removes U+200D and therefore collapses ZWJ emoji sequences **in those two fields only**. That is
  pre-existing, documented behaviour and was left alone; the ZWJ assertion lives on a `tag` and a
  `steps[].answer`.
- e2e assertions (§5.1) are WRITTEN AND UNRUN — a live playtest stack owns the emulator.

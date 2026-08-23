## 1. RED — failing tests first

- [x] 1.1 Create `scripts/test-join-code.ts` in the house `check(label, cond, detail)` style,
      importing `normalizeJoinCodeInput`, `joinErrorKey` and `MAX_JOIN_CODE_LEN` from
      `../apps/play-web/src/lib/joinCode`.
- [x] 1.2 Encode the normalization fixtures from the design's Test Strategy: case, whitespace,
      internal space, dash, pasted link (`?code=`, `&code=`, `CODE=`), a link with no code
      parameter, an RTL-marked paste, empty / whitespace-only / `null` / `undefined` / number /
      object, an over-long string, and the no-substitution assertion for `o0i1l`.
- [x] 1.3 Encode the invariants asserted over EVERY normalization fixture: output matches
      `/^[A-Z0-9]*$/`, length `<= MAX_JOIN_CODE_LEN`, and normalization is idempotent.
- [x] 1.4 Encode the `joinErrorKey` table: every code in the design's D3 table, both bare and
      `functions/`-prefixed, plus an unrecognized code, an `Error` with no code, a bare string,
      `null` and `undefined`.
- [x] 1.5 Add the wiring guards over `JoinScreen.tsx` source: it imports from `lib/joinCode`, uses
      `normalizeJoinCodeInput` in the code input's `onChange`, calls `joinErrorKey`, no longer has
      `maxLength={8}` on the code input, and no longer falls back to a raw `e.message`.
- [x] 1.6 Run `npx tsx scripts/test-join-code.ts` and confirm it FAILS for the right reason (the
      module does not exist). Record the failure verbatim.

## 2. GREEN — the pure module

- [x] 2.1 Add `apps/play-web/src/lib/joinCode.ts` with `MAX_JOIN_CODE_LEN`,
      `normalizeJoinCodeInput` (D1, D2) and `joinErrorKey` + `JoinErrorKey` (D3). Pure: no React, no
      DOM, no storage.
- [x] 2.2 Re-run the script; the pure sections go GREEN and only the wiring guards stay red.

## 3. GREEN — copy

- [x] 3.1 `apps/play-web/src/i18n.ts`: rewrite `join.invalidCode`, `join.finished`, `join.gameFull`
      and `join.joinFailed` per D4 and add `join.codeRevoked`, in BOTH the Hebrew and the English
      dictionary. Additive to whatever else that file is receiving; never revert another key.
- [x] 3.2 `npm run i18n:check:strict` stays clean (no new PART B warnings, no PART A error).

## 4. GREEN — wire the screen

- [x] 4.1 `JoinScreen.tsx`: the code input's `onChange` stores `normalizeJoinCodeInput(value)`, the
      deep-link `linkCode` is normalized the same way, and `maxLength` is removed from that input.
- [x] 4.2 `JoinScreen.tsx`: `lookup`, `submit` and `attach` send `normalizeJoinCodeInput(code)`
      instead of `code.trim().toUpperCase()`.
- [x] 4.3 `JoinScreen.tsx`: `joinError(e)` becomes `joinErrorKey(e)` looked up in a `t.join.*`
      table; delete the raw `e.message` fallback and the local `CONNECTION_CODES` set.
- [x] 4.4 `JoinScreen.tsx`: `attach` shows the connection copy for a `connection` key and keeps
      `t.devices.attachFailed` otherwise.
- [x] 4.5 Re-run `npx tsx scripts/test-join-code.ts`: fully GREEN.

## 5. REFACTOR + gates

- [x] 5.1 Re-read the file before each edit (another lane is adding keys to `i18n.ts`); keep every
      addition additive.
- [x] 5.2 `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
      `npm run bundle:budget`, `npm run i18n:check:strict` all green.
- [x] 5.3 `npx openspec validate join-flow-resilience --strict` passes.

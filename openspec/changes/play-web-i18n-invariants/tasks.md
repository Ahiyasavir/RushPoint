## 0. MEASURE — establish what is already covered, before writing anything

- [x] 0.1 Read the sibling suite `apps/creator-web/src/lib/__tests__/i18nDictionary.test.ts` and
      mirror its approach, helper set and house style. Do not invent a second idiom.
- [x] 0.2 Read `scripts/check-i18n.ts` (PART A/PART B) and `scripts/test-i18n-parity.ts` — **read
      only**, neither is edited by this change — and record precisely what each already covers for
      play-web, so this change adds coverage instead of duplicating it.
- [x] 0.3 Measure the play-web dictionary: recursive key count, function-leaf count, and which
      invariants have **no** pure-logic coverage today.
- [x] 0.4 Decide the test lane from the repo's existing wiring (design D1), not from preference, and
      record the reason.

> **Measured baseline.** `apps/play-web/src/i18n.ts`: **478 recursive key paths per language**, of
> which **58 are function-valued** in each language. `scripts/test-i18n-parity.ts` covers key parity
> (functions included, via `keysDeep`) and English-in-HE — but only over `leafStrings()`, which
> returns `[]` for a function, so its purity rule sees **420 of 478** keys and **none** of the 58
> formatters; its `TASK_KEYS`/`FINAL_KEYS`/`FN_KEYS` lists are a frozen ~55-key allowlist that says
> nothing about the rest. `scripts/check-i18n.ts` covers A1–A4 including function output, as a
> program that exits — not a test. **Uncovered by any test:** leaf-type drift (A2), Hebrew-in-EN
> (A4), English in function output (A3 over formatters). **Uncovered anywhere, in either app:**
> function arity drift, empty leaves, interpolation safety, brand vocabulary in play-web.
>
> **Lane chosen: `scripts/test-*.ts` (tsx), not vitest.** `apps/play-web` has no `vitest`
> devDependency, no `vitest.config.ts` and no `test` script — mirroring creator-web's *location*
> would mean adding a runner, a config file and a workspace script, which this change is not allowed
> to do. `scripts/run-unit-tests.mjs` already globs `/^test-.*\.ts$/` and is the first half of
> `npm test`, so a new file there is wired into the gate with **zero** configuration. See design D1.

## 1. RED — pin the invariants the test lane does not cover

- [x] 1.1 Create `scripts/test-play-web-i18n-dictionary.ts` in the house style of the neighbouring
      assertion scripts (`ok(cond, msg, detail)` helper, pass/fail counters, verdict line,
      `process.exit`), importing `translations` from `../apps/play-web/src/i18n`. No new dependency,
      no config change — `scripts/run-unit-tests.mjs` discovers it by glob.
- [x] 1.2 Implement the local helpers per design D2/D3/D5/D6: `keysDeep` (a function is a leaf),
      `leafTypes`, `leafArities`, and `walkLeaves` that CALLS function entries with the `Proxy`
      sample argument (`Symbol.toPrimitive` → token, `toString` → token, `valueOf` → token,
      `Symbol.iterator` → `undefined`, any other property → token) and asserts on the produced
      message. Re-derived, never imported from `check-i18n.ts` — that file `process.exit()`s at
      import time, and a test that imports its subject only proves the subject agrees with itself.
- [x] 1.3 A1 — identical sorted recursive key sets, with the missing keys named in **both**
      directions, plus a non-empty assertion so a broken walker cannot pass vacuously.
- [x] 1.4 A2 — identical leaf **type** per key, and identical **arity** per function entry (D6).
- [x] 1.5 A6 — no empty or whitespace-only message in either language.
- [x] 1.6 A3/A4 — no English word in any HE leaf and no Hebrew letter in any EN leaf, over strings
      **and** function output, using the checker's whitelist and its digit-bearing-token strip; plus
      the whitelist-is-load-bearing assertion (D4).
- [x] 1.7 A5 — the blind spot, guarded directly: assert the dictionary really has function entries,
      assert the walker **reached all of them** (count reached == count that exist), assert none
      throws on plausible arguments, and assert each returns a string message.
- [x] 1.8 A8 — interpolation safety (D7): no raw `{ident}` / `%s` / `%d` / `${` , no `undefined`, no
      `NaN`, no `[object Object]` in any produced message; and every argument-taking entry proven to
      **consume** its argument by rendering it twice with two far-apart tokens and requiring the two
      messages to differ.
- [x] 1.9 A7 — brand vocabulary (D8): the retired *מירוץ הרפתקה* absent from HE and "race adventure"
      absent from EN, while the bare noun *הרפתקה* stays allowed.
- [x] 1.10 Prove every assertion can go red — **detector self-checks over LOCAL FIXTURES only**
      (D9). Twenty cases: a key missing on one side; leaf-type drift; arity drift; a whitespace-only
      entry; English inside a Hebrew **function** entry (the parity-script blind spot); Hebrew inside
      an English entry including a function; a formatter that throws (recorded, not silently
      dropped); each interpolation signature; an argument-taking entry that ignores its argument;
      both retired brand phrases. Plus the negatives that keep the whitelist honest — `RushPoint`/
      `QR`, the sample code `FOX42`, the `עברית` toggle label, and a correctly rendered message must
      **not** be flagged.
      ⚠️ The real `apps/play-web/src/i18n.ts` is **never** mutated to demonstrate a red. Other lanes
      are adding keys to it concurrently in this tree (tags, map/area, stuck-player copy); mutating a
      shared file leaves a restore window in which their work can be clobbered. An earlier agent did
      exactly that on a shared file mid-session — the fixtures exist so it never needs repeating.

## 2. GREEN — make the assertions pass

- [x] 2.1 Run `npx tsx scripts/test-play-web-i18n-dictionary.ts` and drive it green. Any red here is
      a REAL dictionary defect — fix `apps/play-web/src/i18n.ts` with natural Hebrew in the tone of
      the surrounding copy, never a literal gloss, and never relax an assertion to match the defect.
- [x] 2.2 Confirm the new file is reached by the repo gate, not only by direct invocation: it must
      appear in `scripts/run-unit-tests.mjs`'s file list and pass inside `npm test`.

> **Section 2 outcome: no dictionary change was needed.** The suite came up **45/45 green on its
> first run** against the live dictionary — all 478 keys parity-matched, all 58 formatters per
> language called successfully, no wrong-language leaf in either direction, no empty message, no
> arity drift, no interpolation defect, no retired brand wording. `apps/play-web/src/i18n.ts` is
> therefore **untouched by this change**. Inventing a copy edit to justify this section would be
> fabrication; the honest result is that the dictionary was already correct and is now *protected*.
> Verified reached by the gate: `npm test` → `▶ test-play-web-i18n-dictionary.ts` →
> `✓ ALL 45 PLAY-WEB I18N DICTIONARY ASSERTIONS PASSED` → `✓ All 126 pure-logic unit file(s) passed.`

## 3. REFACTOR

- [x] 3.1 Re-read the script for duplication within itself: helpers defined once at the top, the
      per-language cases driven by a single `LANGS` table, list-emptiness assertions funnelled
      through shared `okEmpty` / `okEqual` reporters that print the offending **keys**, never a count.
- [x] 3.2 Check the file header states, for the next reader: why this lane and not vitest, what
      `check-i18n.ts` and `test-i18n-parity.ts` already cover, and which invariant each block pins.

## 4. GATES — record verbatim

- [x] 4.1 `npm run typecheck` →
      `Tasks: 5 successful, 5 total` / `Cached: 3 cached, 5 total` / `Time: 10.431s`. Exit 0.
      (`scripts/` is not a turbo typecheck target, so the new file was additionally typechecked
      directly with `npx tsc --noEmit --strict --skipLibCheck` → no diagnostics.)
- [x] 4.2 `npm run lint` → `✖ 53 problems (0 errors, 53 warnings)`, `Tasks: 1 successful, 1 total`,
      exit 0. **0 errors**; all 53 are pre-existing `no-non-null-assertion` /
      `react-hooks/exhaustive-deps` warnings in creator-web files this change does not touch.
- [x] 4.3 `npm test` →
      `▶ test-play-web-i18n-dictionary.ts` … `✓ ALL 45 PLAY-WEB I18N DICTIONARY ASSERTIONS PASSED`
      `✓ All 126 pure-logic unit file(s) passed.`
      `Test Files 32 passed | 10 skipped (42)` · `Tests 341 passed | 340 todo (681)`
      `Tasks: 4 successful, 4 total`. Exit 0.
      ⚠️ **A first run of this gate went red — in another lane's file, not this one, and it was
      transient.** `@rushpoint/creator-web:test` failed on
      `builder.coverImageHint="מוצגת בראש עמוד המשחק הציבורי. קישור https בלבד."` (English `https`
      inside Hebrew copy) and `test-i18n-parity.ts` / `test-no-dashes.ts` failed alongside it. On
      re-read the key had already been corrected to `קישור מאובטח בלבד` by the lane that owns
      creator-web copy, and all three passed. Recorded rather than hidden: this tree is being edited
      concurrently, so a gate can catch a file mid-edit. Nothing here touched creator-web.
- [x] 4.4 `npm run play:build` → `✓ built in 14.93s` (chunk-size advisories only).
- [x] 4.5 `npm run creator:build` → `✓ built in 11.40s` (chunk-size advisories only).
- [x] 4.6 `npm run i18n:check` →
      `✓ PART A (dictionaries): keys parity-matched; HE is pure Hebrew, EN is pure English.`
      `✓ PART B (source scan): no hardcoded UI strings bypassing i18n.` Exit 0.
- [x] 4.7 `npm run i18n:check:strict` → identical two lines, exit 0. **PART B = 0 repo-wide**, which
      `npm run verify` now enforces.
- [x] 4.8 `npx openspec validate play-web-i18n-invariants --strict` → passes.
- [x] 4.9 NOT RUN, by hard constraint — a live playtest stack serves from this tree:
      `npm run e2e`, `verify:emulator`, `test:rules`, `dev:all`, `playtest`, `simulate`,
      `npm run shared:build`, and any emulator / Vite / tunnel / backup start, stop or restart.
      Recorded as an explicit non-verification, not left to read as coverage.

## 5. REPORT

- [x] 5.1 State the lane chosen and why (task 0.4).
- [x] 5.2 List the invariants pinned and, for each, the coverage it adds over what already existed.
- [x] 5.3 State plainly whether a real dictionary defect was found, and quote any copy that changed
      so a human can review the Hebrew.
- [x] 5.4 List what remains unverified and by whom.

---

## Results

### Files touched

- **`scripts/test-play-web-i18n-dictionary.ts`** — NEW, the only file added or changed by this
  change. 45 assertions: 25 over the real dictionaries + 20 detector self-checks over local fixtures.
- **`apps/play-web/src/i18n.ts`** — **not touched.** Any modification showing in `git status` is
  another lane's concurrent work.

### Coverage added, invariant by invariant

| Invariant | Before | After |
|---|---|---|
| A1 key-set parity | parity script + checker | + named diffs in both directions, non-empty guard |
| A2 leaf-type drift | checker only (no test) | **test** |
| A2 function **arity** drift | **nothing, either app** | **test** |
| A3 English in HE strings | parity script + checker | test |
| A3 English in HE **function output** | checker only (no test) | **test** |
| A4 Hebrew in EN | checker only (no test) | **test** |
| A5 formatters called at all | parity script sees **0 of 58** | **all 58 per language, count-guarded** |
| A6 empty / whitespace-only leaf | **nothing** | **test** |
| A7 retired brand wording | **nothing** (play-web) | **test, HE and EN** |
| A8 interpolation safety | **nothing, anywhere** | **test** |
| Detectors proven able to fail | — | 20 fixture self-checks |

### Real dictionary defects found: **none**

The suite was green on its first run, 45/45, against the live `apps/play-web/src/i18n.ts`:
478 key paths parity-matched, 58 formatters per language called without a throw, no wrong-language
leaf in either direction, no empty message, no arity drift, no raw placeholder / `undefined` / `NaN`
/ `[object Object]`, every argument-taking entry proven to consume its argument, and no retired brand
wording. **No Hebrew copy was written or changed, so there is no new Hebrew for a human to review.**

The one wrong-language leaf observed during this change was in **creator-web**
(`builder.coverImageHint`, the literal `https` inside Hebrew copy) and was corrected by the lane that
owns that file before this change's gates were re-run — see 4.3.

### Left unverified

- **Naturalness of the participant Hebrew — human only.** The suite proves the copy is Hebrew,
  complete, correctly interpolated and on-brand; no machine check tells natural phrasing from a stiff
  gloss, and this is the app a teenager reads on a phone in the dark.
- **Runtime / UI behavior** — the live playtest stack must not be touched (4.9).
- **Emulator-bound lanes** — `e2e`, `test:rules`, `simulate`, `verify:emulator` were not run, by
  constraint. Nothing in this change reaches a callable, a rule or shared state, but that is an
  argument, not a measurement.
- **Concurrency caveat** — other lanes are adding keys to `apps/play-web/src/i18n.ts` in this tree.
  The suite is structural (it asserts properties of *every* key, never a fixed key list), so their
  additions are covered on arrival; but a gate run can still catch that file mid-edit, as 4.3 shows.

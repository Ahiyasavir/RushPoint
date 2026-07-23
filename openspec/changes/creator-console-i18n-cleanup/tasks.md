## 0. MEASURE — record the PART B baseline before touching anything

- [x] 0.1 Run `npx tsx scripts/check-i18n.ts` and `npx tsx scripts/check-i18n.ts --strict` and record
      both outputs verbatim. Extract the PART B findings for the scoped files only:
      `apps/creator-web/src/pages/{RunConsolePage,DashboardPage,WalletPage,RunsOverviewPage}.tsx` and
      `apps/creator-web/src/components/ui.tsx`. That list is the work-list.
- [x] 0.2 Do not trust a green checker on its own — confirm per scoped file, independently of the AST
      scan: a Hebrew-codepoint grep (all Hebrew must arrive via `t.*`), an object-literal copy grep
      (`label:`/`title:`/`placeholder:` … carrying prose), and a `cond ? 'a' : 'b'` grep for inline
      copy the scan's JSX-position rule would miss. Classify every hit as copy or not-copy.
- [x] 0.3 Inventory every `// i18n-ignore` in the scoped files and judge each one: brand, sample data
      or debug label with a stated reason = keep; anything else = real work.
- [x] 0.4 Write the measured baseline into this file (task 6.1). If it is non-zero, sections 2–4
      become the burn-down; if it is zero, say so plainly and do not invent copy to change.

## 1. RED — pin the dictionary invariants the test lane does not cover

- [x] 1.1 Establish what `npm test` already covers by reading `scripts/test-i18n-parity.ts` (read
      only — `scripts/` is another agent's). Record the gap: it checks key parity and English-in-HE,
      but its `leafStrings()` returns `[]` for a function, so function-valued entries are invisible;
      and leaf-type drift (A2) and Hebrew-in-EN (A4) have no pure-logic coverage at all.
- [x] 1.2 Create `apps/creator-web/src/lib/__tests__/i18nDictionary.test.ts` in the house style of
      the neighbouring suites (`describe`/`it`/`expect` from vitest, node environment), importing
      `translations` from `../../i18n`. No new dependency and no config change — the existing
      `vitest.config.ts` `include: ['src/**/*.test.ts']` picks it up.
- [x] 1.3 Implement the local helpers per design D2/D3/D5: `keysDeep` (function is a leaf),
      `leafTypes`, and `walkLeaves` that CALLS function entries with the `Proxy` sample argument
      (`Symbol.toPrimitive` → `'0'`/`0`, `toString` → `'0'`, `valueOf` → `0`, `Symbol.iterator` →
      `undefined`, any other property → `0`) and asserts on the produced message.
- [x] 1.4 Encode the structural cases: identical sorted key-path sets with the missing keys named in
      both directions; identical leaf type per key; no empty or whitespace-only leaf.
- [x] 1.5 Encode the language-purity cases over strings AND function output: no English word in any
      HE leaf, no Hebrew letter in any EN leaf, using the checker's whitelist and its
      digit-bearing-token strip. Assert every function leaf is callable without throwing.
- [x] 1.6 Encode the whitelist-integrity case (D4): at least one HE leaf genuinely contains a
      whitelisted Latin term, so the whitelist stays load-bearing.
- [x] 1.7 Encode the brand case (D6): the retired complete phrase *מירוץ הרפתקה* is absent from the HE
      dictionary. Do NOT ban the bare noun *הרפתקה* — the Builder's sample chapter title uses it correctly.
- [x] 1.8 Prove each new assertion can actually fail. Done two ways, because a suite that has never
      failed has not been shown to test anything:
      **(a) Permanent detector self-check.** Rather than a throwaway mutation, the
      `the detectors actually detect` block feeds each rule a deliberately defective synthetic
      dictionary and requires it to notice — a key missing on one side, leaf-type drift, a
      whitespace-only entry, English inside a Hebrew **function** entry (the parity-script blind
      spot), Hebrew inside an English entry, and a formatter that throws. It also pins the negative
      cases so the whitelist cannot decay: `RushPoint`/`QR`, the sample code `FOX42`, and the
      `עברית` toggle label must NOT be flagged. These 7 cases stay red-able forever.
      **(b) One real mutation against the live dictionary,** observed and reverted: setting
      `HE.nav.myGames` to `'My Games'` produced
      `AssertionError: expected [ 'nav.myGames="My Games"' ] to deeply equal []` — the offending key
      and its value named. Reverted; the restored file was confirmed **byte-identical** to the
      pre-mutation copy (`diff` clean) and `check-i18n.ts` PART A re-verified green.
      ⚠️ Note for future agents: `i18n.ts` is being edited concurrently by other agents in this tree
      (`game-task-tags`, `public-task-area-visibility` keys landed during this change). Mutating a
      shared file in place risks clobbering their work in the restore window. (a) exists so this
      never needs repeating.

## 2. GREEN — route every hardcoded string through `t.*`

- [x] 2.1 For each finding from 0.1, add the key to BOTH dictionaries in `apps/creator-web/src/i18n.ts`
      and replace the literal with the `t.*` reference. Hebrew must be natural, user-facing Hebrew in
      the tone of the surrounding copy — never a literal gloss of the English — and must use the
      current brand vocabulary (*משחק שדה*, never *מירוץ הרפתקה*).
- [x] 2.2 For a finding that is deliberately not translatable, add a trailing `// i18n-ignore` WITH a
      short reason instead of inventing a translation.
- [x] 2.3 On every line touched, keep RTL correct: logical Tailwind classes (`ms-`/`me-`/`text-start`/
      `text-end`) over left/right, `dir="auto"` retained on user-authored content, static Tailwind
      class strings only (no `bg-${x}`).
- [x] 2.4 Re-run `npx tsx scripts/check-i18n.ts --strict` and confirm the scoped files' findings are gone.

> **Section 2 outcome:** no work. The measured baseline (task 6.1) is **0 findings** across all five
> scoped files, so there was no literal to route and no key to add. `apps/creator-web/src/i18n.ts` is
> unchanged by this change — deliberately, since inventing copy to justify the section would be
> fabrication. 2.3's RTL rule still bound the change and was vacuously satisfied: no screen line was
> edited. The one in-scope `// i18n-ignore` (2.2) pre-exists and was audited in 0.3, not added here.

## 3. GREEN — make the new assertions pass

- [x] 3.1 Run `npx vitest run src/lib/__tests__/i18nDictionary.test.ts` in `apps/creator-web` and
      drive it green. Any red here is a REAL dictionary defect — fix the dictionary, never relax the
      assertion to match it.
- [x] 3.2 Confirm the new file is reached by the repo gate, not just by a direct invocation. Verified
      structurally + by workspace run rather than through `npm test` itself: `npm test` is
      `node scripts/run-unit-tests.mjs && turbo run test`, `turbo run test` dependsOn `^build`, and
      `packages/shared`'s build rewrites `dist` in place — which the parent agent has serialized and
      forbidden here. The equivalent that does NOT touch `dist` was run instead: the creator-web
      workspace's own `test` script (`npx vitest run`, whose `include: ['src/**/*.test.ts']` is the
      same glob `turbo run test` would invoke) picks the new file up — **10 test files, 197 tests,
      all passing**. See 5.5.

## 4. REFACTOR — deduplicate

- [x] 4.1 If the same user-visible string was routed through more than one new key across the scoped
      screens, collapse it to a single shared key and update the call sites.
- [x] 4.2 Re-read the new test for accidental duplication of the neighbouring suites' helpers; keep it
      self-contained (design D2) but not repetitive within itself.

> **Section 4 outcome:** 4.1 is vacuous — no keys were added (see section 2), so no duplicate keys
> exist to collapse. 4.2 applied: the helpers are defined once at the top of the file and shared by
> every case.

## 5. GATES — record verbatim

> **Turbo caveat, applying to 5.3 and 5.5.** `npm run typecheck` and `npm test` are turbo tasks that
> both `dependsOn: ["^build"]`, so each one rebuilds `packages/shared` and rewrites
> `packages/shared/dist` **in place** — exactly the operation the parent agent serialized and
> forbade, and a live stack is serving from this tree. Both were therefore run as the
> **workspace-direct equivalents**, which execute the identical commands (`npx tsc --noEmit`,
> `npx vitest run`) without triggering `^build`. This is a real, named reduction in coverage, not a
> claim of having run the gate: neither `packages/shared` nor `functions` was typechecked or tested
> by me. Nothing in this change touches either — the only new file is a creator-web test — but the
> parent must run the full turbo gates once it is safe to rebuild `dist`.

- [x] 5.1 `npm run i18n:check` — PART A is a HARD gate; a PART A error is never shippable.
      → `✓ PART A (dictionaries): keys parity-matched; HE is pure Hebrew, EN is pure English.`
      `✓ PART B (source scan): no hardcoded UI strings bypassing i18n.` PASSED.
- [x] 5.2 `npm run i18n:check:strict` — PART B must be 0. → same two lines, exit 0. **PART B = 0.**
- [x] 5.3 Typecheck — ran `npx tsc --noEmit` in `apps/creator-web` (see caveat above). Exit 0, no
      diagnostics. `packages/shared` / `functions` typecheck NOT run.
- [x] 5.4 `npx eslint src --ext .ts,.tsx` in `apps/creator-web` → `✖ 53 problems (0 errors, 53
      warnings)`, exit 0. **0 errors**; all 53 are pre-existing `no-non-null-assertion` /
      `react-hooks/exhaustive-deps` style warnings in files this change did not touch. The new test
      file contributes zero warnings.
- [x] 5.5 Tests — ran `npx vitest run` in `apps/creator-web` (see caveat): **Test Files 10 passed
      (10), Tests 197 passed (197)**, including the new `i18nDictionary.test.ts` (17 tests). Also ran
      the existing pure-logic `npx tsx scripts/test-i18n-parity.ts` (read-only, no build) →
      `ALL I18N PARITY TESTS PASSED`. The full `scripts/run-unit-tests.mjs` aggregator and the
      `functions` vitest suite were NOT run.
- [x] 5.6 `npm run creator:build` → `✓ built in 16.82s` (chunk-size advisories only).
- [x] 5.7 `npm run play:build` → `✓ built in 16.53s` (chunk-size advisories only).
- [x] 5.8 NOT RUN, by hard constraint — a live playtest stack serves from this tree:
      `npm run e2e`, `verify:emulator`, `test:rules`, `dev:all`, `playtest`, `simulate`,
      `npm run shared:build`, and any emulator/Vite/tunnel start, stop or restart. Record this as an
      explicit non-verification rather than letting it read as coverage.

## 6. REPORT

- [x] 6.1 State the PART B count for the scoped files **before → after**, with the verbatim command
      output backing both numbers.
- [x] 6.2 List every file touched, and every string marked `// i18n-ignore` with its reason.
- [x] 6.3 List what remains unverified and by whom it must be done: native-speaker review of the
      Hebrew console copy (human only), runtime/UI behavior (stack must not be touched), and the
      standing enforcement gap that `i18n:check:strict` is in no gate chain — fixing that edits root
      `package.json`, which is outside this change's ownership.

---

## Results

### PART B, scoped files: **0 → 0**

| File | PART B before | PART B after |
|---|---|---|
| `apps/creator-web/src/pages/RunConsolePage.tsx` | 0 | 0 |
| `apps/creator-web/src/pages/DashboardPage.tsx` | 0 | 0 |
| `apps/creator-web/src/pages/WalletPage.tsx` | 0 | 0 |
| `apps/creator-web/src/pages/RunsOverviewPage.tsx` (exists, 94 lines) | 0 | 0 |
| `apps/creator-web/src/components/ui.tsx` | 0 | 0 |
| **Scoped total** | **0** | **0** |

Backing output, identical before and after, from both `check-i18n.ts` and `check-i18n.ts --strict`:

```
🌐 i18n correctness check — Hebrew↔English UI parity

✓ PART A (dictionaries): keys parity-matched; HE is pure Hebrew, EN is pure English.

✓ PART B (source scan): no hardcoded UI strings bypassing i18n.

✓ i18n check PASSED — Hebrew is Hebrew, English is English, nothing hardcoded.
```

The repo-wide PART B total is also 0, so the delta is 0 by arithmetic, not by scoping. **The
"~119 findings" backlog figure carried in project memory is stale** — a previous cleanup landed it.
That should be corrected wherever it is recorded, so the next agent does not re-open this hunt.

Independent per-file confirmation (task 0.2), because a green AST scan could equally mean a blind
spot: a Hebrew-codepoint grep over all five files returns **no matches at all** — every Hebrew string
reaches them through `t.*`. Object-literal copy (`label:` / `title:` / `placeholder:` carrying prose)
returns nothing. Inline `cond ? 'a' : 'b'` copy returns only Tailwind class strings and enum
discriminants (`'public'`/`'private'`, `'finished'`/`'live'`, `'approved'`). The remaining literals
are route paths, URLs and `${}` compositions of dictionary values.

### Files touched

- **`apps/creator-web/src/lib/__tests__/i18nDictionary.test.ts`** — NEW, the only file added or
  changed. 17 tests: 10 invariant cases over the real dictionaries + 7 detector self-checks.

No production file was modified. `i18n.ts` is byte-identical to its pre-change state; the
`M apps/creator-web/src/i18n.ts` in `git status` is other agents' concurrent work, not this change's.

### `// i18n-ignore` inventory (scoped files)

- `apps/creator-web/src/pages/WalletPage.tsx:165` — `PRO` badge, `{/* i18n-ignore brand */}`.
  **Pre-existing, audited, kept.** `Pro` is brand text and is already in `check-i18n.ts`'s own
  `LATIN_WHITELIST`. **No new exemption was added by this change.**

### Left unverified

- **Naturalness of the Hebrew copy — human only.** The tests prove the Hebrew is *Hebrew*,
  structurally complete and on-brand; no machine check can tell natural phrasing from a stiff gloss.
- **Runtime / UI behavior** — the live playtest stack must not be touched (5.8).
- **`packages/shared` and `functions` typecheck + tests** — skipped with the turbo `^build` caveat
  above; the parent should run the full gates when rebuilding `dist` is safe.
- **Standing enforcement gap:** `i18n:check:strict` — the only mode where PART B *fails* — is in no
  gate chain. `npm run verify` runs plain `i18n:check`, which exits 0 with PART B warnings, so the
  backlog can silently regrow. The fix is one word in root `package.json`'s `verify`, which is
  outside this change's ownership. **Recommended follow-up, deliberately not done silently.**
- **`apps/play-web`'s dictionary** has the identical A2/A4/function-leaf gap and no equivalent test.
  Out of ownership; flagged so it is not mistaken for coverage.

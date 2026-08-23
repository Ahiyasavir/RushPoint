> ## ⚠ RETROFITTED AFTER THE FACT
>
> This change did **not** follow `/opsx:propose → /opsx:apply → /opsx:archive`. The code fix was
> written directly, committed and **pushed** as `8729464` before any OpenSpec artifact or test
> existed. It changed the semantics of a **hard gate** (`npm run i18n:check` PART A), so it was not
> covered by CLAUDE.md's trivial-one-liner exemption and the ceremony is being applied late.
>
> Sections 0–1 below record what actually happened, in order, including the parts that were skipped.
> They are marked `[x]` because they are history, not because they were done correctly. Sections
> 2–5 are the retrofit and were performed in the order shown.

## 0. What actually happened (history — recorded, not re-run)

- [x] 0.1 The i18n hard gate went red on correct Hebrew copy:
      `'{launched} קבוצות התחילו. {held} קבוצות ממתינות לאישור אפוטרופוס ולא יוכלו להתחיל בלעדיו.'`
      in `apps/creator-web/src/i18n.ts` was reported as an English leak (A3), twice.
- [x] 0.2 **SKIPPED — no OpenSpec change was proposed.** No proposal, design, tasks or delta spec.
- [x] 0.3 **SKIPPED — no failing test was written first.** The RED phase did not happen.
- [x] 0.4 The fix was written directly into `scripts/check-i18n.ts::hasEnglishWord` and, separately,
      into the near-duplicate `scripts/test-i18n-parity.ts::hasEnglish`: strip
      `/\{[A-Za-z0-9_]+\}/g` before the English-word test.
- [x] 0.5 Verification was manual and unrecorded — the commit message claims only "Verified a real
      English string is still detected", with no test, no fixture and no output.
- [x] 0.6 Committed and **pushed** as `8729464`.

## 1. Consequences carried into the retrofit

- [x] 1.1 The rule existed in two places kept aligned by a `// (Kept in sync with …)` comment, and
      the same defect had to be patched in both — drift already realised, not hypothetical.
- [x] 1.2 Neither predicate had any unit test; both were exercised only indirectly through whatever
      copy happened to be in the dictionaries.
- [x] 1.3 The original trigger is no longer reproducible from the dictionaries: an unrelated lane
      converted `heldForConsent` to a function using template interpolation
      (`` `${launched} קבוצות…` ``), so no literal `{launched}` token remains in the tree. The
      regression protection now rests entirely on the retrofitted unit test.

## 2. REFACTOR — make the rule testable and singular (prerequisite for RED)

Done first because `hasEnglishWord` was a file-local function inside a script with top-level side
effects and **could not be imported at all** — there was no way to write a test that did not
re-implement the regex. Testability forced the extraction (design D4).

- [x] 2.1 Create `scripts/lib/i18nLeak.ts` holding the single definition of `HEBREW`,
      `PLACEHOLDER_RE`, `DIGIT_CODE_RE`, `LATIN_WHITELIST`, `HEBREW_WHITELIST`, `stripAll`,
      `stripPlaceholders`, `hasEnglishWord` and `hasHebrew`. Pure move — identical regexes; the two
      whitelists were identical in content and differed only in element order.
- [x] 2.2 Replace the local definitions in `scripts/check-i18n.ts` with an import, keeping the raw
      `HEBREW` regex available to the PART B AST scan so PART B uses the same definition.
- [x] 2.3 Delete the duplicate `WHITELIST` / `stripWhitelist` / `hasEnglish` from
      `scripts/test-i18n-parity.ts` and bind `const hasEnglish = hasEnglishWord` from the shared
      module. Remove the now-meaningless "kept in sync with" comments from both files.
- [x] 2.4 Confirm the extraction is behaviour-preserving: `npx tsx scripts/test-i18n-parity.ts`
      → `ALL I18N PARITY TESTS PASSED`.

## 3. The tests that should have come first

- [x] 3.1 Create `scripts/test-i18n-leak.ts` in the house style of `scripts/test-join-code.ts`
      (`check(label, cond, detail)`, a `failures` counter, `process.exit`), auto-discovered by
      `scripts/run-unit-tests.mjs` and therefore run by `npm test`. Import the predicates from
      `./lib/i18nLeak` — the file MUST NOT restate any regex from the rule (design D4).
- [x] 3.2 A3 clean cases: the verbatim string that broke the gate, plus `{max}`, `{team}`,
      multiple placeholders, `{team_name}`, `{n}`, `{a1}`, and a placeholder-only string.
- [x] 3.3 A3 anti-blinding cases — the load-bearing half (design D2): English in Hebrew; English
      AND a placeholder together; placeholder-then-English; English between two placeholders; a
      full English sentence; a bare two-letter word; and `'{launched} כבר launched'`, where the
      placeholder's name also appears as real copy.
- [x] 3.4 Placeholder edge cases: `stripPlaceholders` directly, `{}`, `{42}`, placeholders hugging
      punctuation, placeholder in parentheses, `{{nested}}`, a bare `{` with no closer, `{ n }`.
- [x] 3.5 Pin the KNOWN LIMITS as deliberate (design D1): `{ launched }`, `{team-name}`,
      `{launched` unclosed, a bare `{` followed by English, and `launched}` all still flagged.
- [x] 3.6 Pre-existing behaviour that must survive: digit-code stripping (`FOX42`, `ABC123`,
      `game7`, a code beside a placeholder) paired with `FOX`-without-digit still flagged; every
      `LATIN_WHITELIST` entry swept in Hebrew context; a whitelist entry beside a placeholder; a
      non-whitelisted brand-looking word still flagged.
- [x] 3.7 A4, the opposite direction (design D6): Hebrew in English flagged; clean English not;
      English with placeholders not; the whitelisted language name alone not; Hebrew beside it
      flagged; a single Hebrew letter flagged; `hasHebrew('teams {שלום}')` flagged.
- [x] 3.8 Structural no-drift guard: read both checkers' source and fail if either reintroduces the
      placeholder regex, the `[A-Za-z]{2,}` rule, or the whitelist array.

## 4. RED → GREEN demonstration (the phase that was skipped)

- [x] 4.1 GREEN baseline with the shipped fix in place — `npx tsx scripts/test-i18n-leak.ts`:

      ...
      PASS  neither checker redefines the whitelist array

      ALL I18N-LEAK TESTS PASSED

- [x] 4.2 Temporarily revert the fix in `scripts/lib/i18nLeak.ts` — `stripPlaceholders(s)` removed
      from `hasEnglishWord`, restoring the pre-`8729464` pipeline — and re-run. Verbatim RED:

      FAIL  clean: the exact string that broke the gate :: "{launched} קבוצות התחילו. {held} קבוצות ממתינות לאישור אפוטרופוס ולא יוכלו להתחיל בלעדיו."
      FAIL  clean: single multi-letter placeholder :: "נותרו {max} ניסיונות"
      FAIL  clean: placeholder as the whole latin content :: "הקבוצה {team} סיימה"
      FAIL  clean: several placeholders in one string :: "{launched} מתוך {max} עבור {team}"
      FAIL  clean: placeholder with an underscore :: "שלום {team_name}, ברוכים הבאים"
      FAIL  clean: a placeholder-only string :: "{launched}"
      FAIL  clean: placeholder hugging punctuation :: "התחילו: {launched}, ממתינות: {held}. סה\"כ {max}!"
      FAIL  clean: placeholder in parentheses :: "הקבוצה ({team}) סיימה"
      FAIL  clean: nested braces — the inner canonical token is stripped :: "שלום {{launched}} עולם"
      FAIL  clean: a code next to a placeholder :: "הקוד FOX42 עבור {team}"
      FAIL  clean: whitelist entry beside a placeholder :: "סרקו QR עבור {team}"
      11 FAILED

- [x] 4.3 Record the discriminating detail: **only** the 11 placeholder-clean assertions fail.
      Every anti-blinding, known-limit, digit-code, whitelist and A4 assertion still passes under
      the revert. The suite is sensitive to this fix specifically, not merely to the file existing —
      and a hypothetical "fix" that blinded the detector would fail the other half instead.
- [x] 4.4 Restore the fix (`stripPlaceholders(s)` back in `hasEnglishWord`) and re-run to GREEN.
      Confirm no revert remains: `scripts/lib/i18nLeak.ts:70` reads
      `const noCodes = stripAll(stripPlaceholders(s), LATIN_WHITELIST).replace(DIGIT_CODE_RE, '');`

## 5. OpenSpec artifacts + gates

- [x] 5.1 Author `proposal.md`, `design.md` and this `tasks.md`, plus the delta spec at
      `specs/i18n-leak-detection/spec.md` (new capability). State plainly in the proposal and design
      that this alters a hard gate's semantics, and that the change is a retrofit.
- [x] 5.2 `npx openspec validate i18n-placeholder-detection --strict` — must pass.
- [x] 5.3 Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run i18n:check:strict`.
      Record output verbatim.
- [x] 5.4 Record what was deliberately NOT run and why: `npm run e2e`, `npm run verify:emulator`,
      `npm run test:rules`, `dev:all`, `playtest`, `simulate` and `shared:build` were all skipped —
      a live playtest stack serves from this tree and no emulator, Vite, tunnel or backup process
      may be started or restarted. None of them exercise `scripts/check-i18n.ts`; the change touches
      `scripts/` only, with no callable, rule, shared type, component or dictionary edited.
- [x] 5.5 No commit and no push — the working tree is left for the caller to review alongside the
      four other active lanes in `apps/**` and `packages/shared/**`.

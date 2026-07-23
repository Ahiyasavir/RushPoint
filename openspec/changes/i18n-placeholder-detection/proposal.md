## Why

> **This change is a RETROFIT.** The code fix shipped first, as commit `8729464`
> ("fix(i18n): placeholder tokens are structure, not English copy"), with no OpenSpec change and
> no failing test written first. It altered the semantics of a **hard gate**, which puts it well
> past the "trivial one-liner" exemption in CLAUDE.md, so the ceremony is being applied after the
> fact. `tasks.md` records the real sequence honestly rather than pretending the loop was followed.

`npm run i18n:check` PART A is a **hard gate**: A3 forbids English inside a Hebrew dictionary leaf,
A4 forbids Hebrew inside an English one. It exists because users repeatedly saw English text while
the app was set to Hebrew. Both A3 and A4 decide whether the repo ships.

The A3 predicate defined an English word as "2+ consecutive Latin letters left after whitelisting".
That rule read a `{placeholder}` token as copy. Verified at `8729464`:
`apps/creator-web/src/i18n.ts` held

```
heldForConsent: '{launched} קבוצות התחילו. {held} קבוצות ממתינות לאישור אפוטרופוס ולא יוכלו להתחיל בלעדיו.',
```

— unambiguously Hebrew copy — and the gate reported it as an English leak, twice (`{launched}`,
`{held}`). The gate was **red on correct copy**.

Two things made this worse than a single bad string:

1. **The failure mode is corrosive.** A hard gate that fires on correct work teaches people to
   route around it. The next real leak arrives in a report the reader has already learned to
   distrust.
2. **The rule existed twice.** `scripts/check-i18n.ts` (`hasEnglishWord`) and
   `scripts/test-i18n-parity.ts` (`hasEnglish`) held near-duplicate copies of the same logic, kept
   aligned only by a comment saying "kept in sync with". Both copies carried the defect and both
   had to be patched in the same commit. That is drift already happening, not a risk of drift.

And nothing tested either predicate. They were exercised only *indirectly*, through whatever copy
happened to be in the dictionaries at the time. That is how the defect got in — and how the fix
went out unverified. A gate whose own rule is untested provides the *feeling* of coverage.

## What Changes

**A `{placeholder}` token is structure, not copy.** It is substituted at runtime and the token
NAME is never rendered to a user, so its letters are not a language signal. The A3 English-word
test strips canonical `{name}` tokens before it looks for English. Single-letter `{n}` had only
ever passed because the rule needs 2+ letters — luck, not intent; the same strip now makes both
cases correct for the same stated reason. (This is the behaviour already shipped in `8729464`.)

**The rule now exists exactly once.** The A3/A4 predicates, their whitelists and their regexes move
to `scripts/lib/i18nLeak.ts`. `scripts/check-i18n.ts` and `scripts/test-i18n-parity.ts` import that
single definition instead of each holding a copy. The "kept in sync with" comments are deleted,
because there is no longer anything to keep in sync.

**The gate's own rule becomes tested.** A new `scripts/test-i18n-leak.ts` (pure-logic lane, picked
up by the `npm test` aggregator) pins BOTH directions. Because the standing risk with this class of
fix is a detector that has been **blinded** rather than corrected — a gate that never fires is
worse than one that fires wrongly, since nobody notices — every "not flagged" assertion is paired
with a "still flagged" one, including real English sitting directly next to a placeholder.

**A4 is unchanged**, and is now pinned by tests so it stays that way: placeholder stripping belongs
to the English-word test only, and a `{name}` token must not affect the Hebrew-in-English check.

### Non-goals

- **No copy changes.** No dictionary (`apps/*/src/i18n.ts`) is edited. This change is about the
  CHECKERS, not the strings they check.
- **No widening of the placeholder grammar.** Only the canonical `{name}` form the dictionaries
  actually use is recognised. Known limits (spaces inside braces, hyphens, unbalanced braces) are
  pinned by tests as deliberate, so widening the rule must break a test first.
- **No new gate, no new tier, no change to A1/A2 or to the PART B hardcoded-string scan.**
- **No product behavior changes.** No callables, no rules, no shared types, no UI.

## Capabilities

### New Capabilities

- `i18n-leak-detection`: the language-leak predicates behind the hard i18n gate are specified in
  their own right — what counts as an English leak in Hebrew copy, what counts as a Hebrew leak in
  English copy, that `{placeholder}` tokens are structure rather than copy, and that the rule is
  defined once and shared by every checker that applies it.

## Impact

- **Surfaces touched:** `scripts/` only — the i18n gate and its unit test.
- **Files:**
  - `scripts/lib/i18nLeak.ts` (new) — the single definition of `hasEnglishWord`, `hasHebrew`,
    `stripPlaceholders`, `LATIN_WHITELIST`, `HEBREW_WHITELIST`, `HEBREW`.
  - `scripts/check-i18n.ts` — local predicate/whitelist definitions replaced by an import.
  - `scripts/test-i18n-parity.ts` — duplicate predicate/whitelist deleted, replaced by an import.
  - `scripts/test-i18n-leak.ts` (new) — the pure-logic tests, auto-discovered by
    `scripts/run-unit-tests.mjs`.
- **Not touched:** `apps/creator-web/src/i18n.ts`, `apps/play-web/src/i18n.ts`, any component,
  `scripts/e2e-verify.mjs`, `functions/`, `packages/shared/`.
- **Risk:** this loosens a hard gate, so the real hazard is a **false negative** — a genuine English
  leak that now slips through. Mitigated by scoping the strip to the canonical `{name}` form only,
  and by the paired anti-blinding assertions (English adjacent to a placeholder, a placeholder whose
  name is also used as real copy, an English sentence beginning with a placeholder) which all still
  flag. Reverting the strip turns 11 of those tests red — demonstrated, not assumed.
- **Testing:** pure-logic lane only (`npm test` → `scripts/test-i18n-leak.ts`), plus the gate
  itself (`npm run i18n:check:strict`). No emulator. Emulator-bound gates were not run: a live
  playtest stack is serving from this tree and no emulator, Vite, tunnel or backup process may be
  started or restarted.

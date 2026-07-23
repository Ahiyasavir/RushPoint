## Context

`npm run i18n:check` is the repo's i18n gate. Its PART A tier is **hard**: A1 key-set parity, A2
type parity, A3 "no English word in a Hebrew leaf", A4 "no Hebrew letter in an English leaf". PART A
failing means the change does not ship. CLAUDE.md states it in capitals: *never ship with a PART A
error*.

A3's predicate was, before `8729464`:

```ts
function hasEnglishWord(s: string): boolean {
  const noCodes = stripAll(s, LATIN_WHITELIST).replace(/[A-Za-z]*\d[A-Za-z\d]*/g, '');
  return /[A-Za-z]{2,}/.test(noCodes);
}
```

Three passes: strip brand/unit whitelist terms, strip digit-bearing sample codes (`FOX42`), then
look for 2+ consecutive Latin letters. Nothing in that pipeline knows what a `{placeholder}` is, so
`{launched}` contributed the letters `launched` and the string was reported as English.

At `8729464` the creator-web dictionary contained the plain string
`'{launched} קבוצות התחילו. {held} קבוצות ממתינות…'`, which the gate flagged twice. (Worth recording
for anyone re-deriving this later: an unrelated lane has since converted that entry to a function
using template interpolation — `` `${launched} קבוצות התחילו…` `` — so the literal `{launched}` token
is no longer in the tree and the failure is no longer reproducible from the dictionaries. The
defect and the fix are general; the specific trigger has moved on. This is precisely why the fix
needs its own unit test rather than relying on live copy to exercise it.)

Two further facts shaped this design:

- **The rule was defined twice.** `scripts/check-i18n.ts::hasEnglishWord` and
  `scripts/test-i18n-parity.ts::hasEnglish` were near-identical, along with their whitelists, and
  the only thing holding them together was a `// (Kept in sync with scripts/check-i18n.ts …)`
  comment. `8729464` had to patch both. A comment is not a mechanism.
- **Neither was ever unit-tested.** They were exercised only through whatever happened to be in the
  dictionaries. Coverage that depends on the data under test is not coverage.

## Goals / Non-Goals

**Goals**

- A `{placeholder}` in genuine Hebrew copy does not fail the hard gate.
- The gate is not blinded in the process: real English in Hebrew copy still fails, including English
  immediately adjacent to a placeholder.
- The A3/A4 rule has exactly one definition, shared by every checker that applies it.
- The rule is directly unit-tested, in both directions, without the test re-implementing the rule.
- The change's RED state is demonstrable — reverting the fix must turn specific tests red.

**Non-Goals**

- Changing any copy. No `i18n.ts` dictionary is touched.
- Widening the placeholder grammar beyond the canonical `{name}` form.
- Touching A1/A2 or the PART B hardcoded-string AST scan.
- Any product behavior: no callables, rules, shared types, or UI.
- Running emulator-bound gates. A live playtest stack serves from this tree.

## Decisions

### D0 — Placeholders are STRUCTURE, not copy (the rationale)

The gate asks one question of a Hebrew leaf: *would a user reading this see English?* A
`{placeholder}` never survives to the user. It is a slot the runtime fills — `{launched}` is
replaced by `7`, `{team}` by the team's own name — so its token name is authoring metadata that
lives in the same string only because interpolation happens to be spelled that way. Judging a
string's language by the identifiers in its slots is a category error: it is reading the schema,
not the sentence.

The corroborating detail is that `{n}` had always passed. Not because anyone reasoned about
placeholders, but because one letter is not 2+ letters. The rule was already, silently,
inconsistent about the same construct depending on how long its name happened to be. Stripping
placeholders makes `{n}` and `{launched}` pass **for the same stated reason**, which is the point:
the fix removes an inconsistency rather than adding an exception.

**This changes the semantics of a hard gate.** That is why the fix belonged in the SDD/TDD loop and
why this document exists. The gate now permits a class of string it previously rejected, so the
burden is to show the class is exactly the harmless one — hence D2.

### D1 — The strip is deliberately narrow: `/\{[A-Za-z0-9_]+\}/g`

ASCII letters, digits and underscore; no spaces; balanced braces. This is the form the dictionaries
use. The tempting generalisation — "anything between braces" — is precisely how a leak detector goes
blind: `{teams are waiting}` would become invisible copy. A narrow rule fails *loudly* on an
unrecognised form (it stays flagged), and a loud false positive is a recoverable failure mode. A
false negative is not: nobody investigates a gate that stayed green.

Known limits, pinned by tests as deliberate rather than accidental:

| Input | Result | Why it is acceptable |
|---|---|---|
| `{ launched }` (spaces) | still flagged | not the canonical form; not used in the dictionaries |
| `{team-name}` (hyphen) | still flagged | ditto; `-` is not a JS identifier char anyway |
| `{launched` (unclosed) | still flagged | an unbalanced brace is a typo, and a typo should be loud |
| `launched}` | still flagged | same |
| `{{launched}}` | not flagged | the inner canonical token matches; the residue `{}` has no letters |
| `{}` / `{42}` | not flagged | no Latin letters to find, with or without the strip |
| `{n}` / `{a1}` | not flagged | now for a stated reason rather than by accident |

Pinning the limits as tests means widening the grammar later cannot happen silently — it has to
break an assertion that says, in words, that the limit was chosen.

### D2 — Every "not flagged" case is paired with a "still flagged" case

The specific risk of this fix is not that it is wrong; it is that it is *too effective*. Deleting
the body of `hasEnglishWord` would also have made the gate green. So the test file is structured in
pairs, and the anti-blinding half carries the weight:

- `'הניקוד updated בהצלחה'` — plain English in Hebrew → flagged.
- `'הניקוד updated עבור {team}'` — English AND a placeholder in one string → flagged.
- `'{launched} teams started'` — placeholder first, English after → flagged.
- `'{launched} teams of {max}'` — English between two placeholders → flagged.
- `'{launched} כבר launched'` — the placeholder's NAME also appears as real copy. The strip is
  anchored on the braces, so the bare occurrence survives → flagged. This is the sharpest one: a
  naïve implementation that stripped the *word* rather than the *token* would pass every other test
  and fail this.
- `'הקוד שלכם הוא FOX'` — the digit-code path is not a general escape hatch; remove the digit and it
  is English again → flagged.

### D3 — One definition, in `scripts/lib/i18nLeak.ts`

Two copies of a hard gate's rule, reconciled by a comment, is a defect generator: `8729464` is the
evidence, having had to patch the same bug in two places. The predicates, whitelists and regexes
move to `scripts/lib/i18nLeak.ts`; both checkers import them.

- `scripts/lib/` is the established home for shared script logic (`emulatorBackup.mjs`,
  `bundleBudget.mjs`, `playA11yScan.ts` — so a `.ts` module there is already house style).
- `scripts/run-unit-tests.mjs` discovers only `scripts/test-*.ts` at the top level, so a helper in
  `scripts/lib/` is not mistaken for a test file.
- The whitelists were byte-identical in content and differed only in element order, so unifying
  them is behaviour-preserving. `check-i18n.ts` additionally exports/consumes the raw `HEBREW`
  regex for its PART B scan; that moved too, so PART B keeps using the same definition.
- `test-i18n-parity.ts` binds `const hasEnglish = hasEnglishWord` rather than renaming its call
  sites, keeping that file's diff to the removal of the duplicate.

The test file then asserts the *absence* of drift structurally: it reads both checkers' source and
fails if either reintroduces the placeholder regex, the `[A-Za-z]{2,}` rule, or the whitelist array.
A future copy-paste is caught by a test rather than by a comment nobody reads.

### D4 — Tests import the predicates; they never restate them

A test that re-declares `/\{[A-Za-z0-9_]+\}/g` and asserts it matches `{launched}` proves only that
the author can copy a regex. `scripts/test-i18n-leak.ts` imports `hasEnglishWord`, `hasHebrew` and
`stripPlaceholders` from the shared module and asserts on *strings and verdicts*. Extracting the
shared module was therefore not merely tidiness — before it, `hasEnglishWord` was a file-local
function in a script with top-level side effects and could not be imported at all. **Testability is
what forced the extraction.**

### D5 — House-style script test, in the pure-logic lane

These are pure string predicates: no emulator, no Firestore, no DOM. That is the
`scripts/test-*.ts` lane — `check(label, cond, detail)`, a `failures` counter, `process.exit`,
auto-discovered by `scripts/run-unit-tests.mjs` and therefore run by `npm test`. A vitest file under
`functions/` would have been the wrong home (nothing here is a Cloud Function) and a co-located test
under `apps/` would have put a checker's tests inside the thing being checked.

### D6 — A4 is pinned too, precisely because it was not changed

The fix touched only the English-word test. The way that silently breaks is if placeholder handling
leaks into the Hebrew test and starts hiding Hebrew inside braces. So A4 is asserted directly,
including `hasHebrew('teams {שלום}') === true` — a Hebrew word inside braces is still a Hebrew leak,
because the *rendered* output contains Hebrew regardless of the braces. A4 also has no 2+ rule:
a single Hebrew letter is a leak, and that asymmetry is now pinned rather than folklore.

## Test Strategy

Lane: pure-logic (`npm test`). File: `scripts/test-i18n-leak.ts`. No emulator.

**A3 — placeholders in Hebrew copy are clean**
The verbatim string that broke the gate; a single `{max}`; `{team}` as the only Latin content;
several placeholders in one string; `{team_name}` (underscore); `{n}` (single letter); `{a1}`
(alphanumeric); a placeholder-only string.

**A3 — anti-blinding (the load-bearing half)**
English in Hebrew; English + placeholder together; placeholder-then-English; English between two
placeholders; a full English sentence; a bare two-letter word; and the placeholder-name-also-used-
as-copy case from D2.

**A3 — genuinely clean Hebrew**
Pure Hebrew; Hebrew with digits and punctuation; a single stray Latin letter (not a word).

**Placeholder edge cases**
`stripPlaceholders` directly (removes the canonical form; leaves bare text alone); `{}`; `{42}`;
placeholders hugging punctuation and inside parentheses; `{{nested}}`; a bare `{` with no closer;
`{ n }` with spaces. Plus the five pinned KNOWN LIMITS from D1.

**Pre-existing behaviour that must survive**
Digit-code stripping (`FOX42`, `ABC123`, `game7`, a code beside a placeholder) with the paired
`FOX`-without-digit still flagged; and every entry of `LATIN_WHITELIST` swept in Hebrew context,
plus a whitelist entry beside a placeholder, plus a non-whitelisted brand-looking word still
flagged.

**A4 — the opposite direction**
Hebrew in English flagged; clean English not flagged; English carrying placeholders not flagged;
the whitelisted language name alone not flagged; Hebrew beside the whitelisted name flagged; a
single Hebrew letter flagged; Hebrew inside braces flagged (D6).

**Structural no-drift guard**
Both checkers import from `scripts/lib/i18nLeak.ts`; neither redefines the placeholder regex, the
`[A-Za-z]{2,}` rule, or the whitelist array.

**RED demonstration (mandatory for this retrofit).** With the placeholder strip removed from
`hasEnglishWord` and nothing else changed, exactly the 11 placeholder-clean assertions fail and
every anti-blinding, known-limit and A4 assertion still passes. That asymmetry is the evidence the
suite is sensitive to *this* fix specifically, and not merely to the file existing. Recorded
verbatim in `tasks.md`.

## Risks / Trade-offs

- **Loosening a hard gate risks a false negative.** Mitigated by D1's narrow grammar (unrecognised
  brace forms stay flagged) and D2's paired assertions. Residual: copy that genuinely wants to show
  a literal `{word}` to a user in Hebrew would now be exempt from the English check. Accepted — the
  dictionaries contain no such string, and a rendered literal `{launched}` would be a copy bug
  regardless of language.
- **Extraction touches the gate script itself.** If `scripts/lib/i18nLeak.ts` were wrong, the gate
  would be wrong everywhere at once. Mitigated by the extraction being a pure move (identical
  regexes, whitelists identical in content), by `i18n:check:strict` being run as a gate, and by the
  predicates now having direct tests — the module is the most-tested part of the gate, not the
  least.
- **Pinning known limits pins false positives.** `{ launched }` staying flagged is a real, if
  unlikely, annoyance. Accepted deliberately: a loud false positive is recoverable, and the pin
  makes widening a conscious act.
- **The original trigger is no longer reproducible from the dictionaries** (an unrelated lane
  converted the entry to template interpolation). The regression protection is therefore entirely
  in the unit test — which is the argument for the test, not against it.

## Migration Plan

None. `scripts/` only, no data, no runtime, no env vars, no product surface. `npm run i18n:check`
and `npm run i18n:check:strict` keep their names, tiers, exit codes and output format.

## Open Questions

- Should the canonical placeholder grammar be documented in CLAUDE.md's i18n section so authors know
  `{name}` (no spaces, no hyphens) is the supported form? Not done here — it is a docs change in a
  file other lanes are editing.
- `scripts/test-i18n-parity.ts` now overlaps `check-i18n.ts` heavily (A1 key parity, A3 leaks) and
  is arguably redundant with the authoritative gate. Merging them is out of scope for a retrofit;
  sharing the predicate removes the drift hazard, which was the urgent part.

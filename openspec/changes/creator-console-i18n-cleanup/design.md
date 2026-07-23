## Context

`apps/creator-web` is Hebrew-first: `i18n.ts` exports `translations = { he, en }` and the app
defaults to `he`, with English selectable in Settings. Two failure modes have repeatedly reached
users: a dictionary leaf written in the wrong language, and a component that hardcodes a string so
it never switches at all.

`scripts/check-i18n.ts` is the authoritative gate and it already encodes both, in two tiers:

- **PART A (hard errors, exit 1):** A1 identical recursive key sets HE↔EN · A2 identical leaf *type*
  per key (string-in-both or function-in-both) · A3 no English word in any HE leaf · A4 no Hebrew
  letter in any EN leaf. A3/A4 evaluate **function leaves** too, by calling them with a `Proxy`
  sample argument that coerces to `'0'`/`0` and answers any property access with `0`.
- **PART B (warnings; fail only under `--strict`):** a TypeScript-AST scan of both apps' `src/`,
  flagging string/template literals in UI-text positions — JSX text, the `placeholder` / `title` /
  `aria-label` / `alt` / `label` attributes, and arguments to calls matching
  `/(alert|confirm|prompt|toast|Err|Error|message|Message)$/`. A line is exempted by a trailing
  `// i18n-ignore`, by an inline `lang ===` / `lang ?` bilingual guard, or by being an email/URL.
  `i18n.ts`, `templates.ts`, `LegalPage.tsx` and friends are file-allowlisted as data.

Current state, each item verified in this working tree rather than assumed:

- **PART B is 0 repo-wide.** Both `npx tsx scripts/check-i18n.ts` and the `--strict` run print
  `✓ PART B (source scan): no hardcoded UI strings bypassing i18n.` and exit 0. The scoped screens
  are therefore at 0 before this change; there is no backlog left to burn down here.
- **Independently confirmed per scoped file**, because a green checker could also mean a blind spot:
  a Hebrew-codepoint grep over `RunConsolePage.tsx`, `DashboardPage.tsx`, `WalletPage.tsx`,
  `RunsOverviewPage.tsx` and `components/ui.tsx` returns **no matches at all** — all Hebrew arrives
  via `t.*`. A `(label|title|text|placeholder|…):` object-literal-copy grep returns nothing. A
  `cond ? 'str' : 'str'` grep returns only Tailwind class strings (`'bg-rp-go/20 text-rp-go'`) and
  enum discriminants (`'public'`/`'private'`, `'finished'`/`'live'`). The only remaining literals are
  template URLs, route paths and `${}` compositions of dictionary values such as
  `` `${w.proCtaMonthly} · ${w.proMonthly(PRO_MONTHLY_ILS)}` ``.
- **The one `// i18n-ignore` in scope is legitimate:** `WalletPage.tsx:165` on the `PRO` badge —
  brand text, already in the checker's own `LATIN_WHITELIST`.
- **The Hebrew dictionary is already on-brand.** `משחק שדה` appears 4×; `מירוץ` 0×. The single
  `הרפתקה` hit is `builder.storyIntroTitlePlaceholder: 'פרק 1: ההרפתקה מתחילה'` — a sample story
  chapter title using the ordinary noun, not the retired *מירוץ הרפתקה* brand, and it is Builder-owned.
- **Nothing enforces any of this.** `package.json`'s `verify` is
  `typecheck && lint && test && creator:build && play:build && i18n:check` — plain `i18n:check`,
  where PART B exits 0 regardless. `i18n:check:strict` appears in no script chain.
- **The `npm test` lane under-covers the dictionaries.** `scripts/test-i18n-parity.ts` checks A1 and
  A3 only, and its `leafStrings()` helper returns `[]` for a function, so **every function-valued
  entry is invisible to it**. A2 (type drift) and A4 (Hebrew in English) have **no** pure-logic
  coverage in either app.

So the defect this change fixes is not hardcoded strings — it is that the invariants which caught
them are enforced by a script no gate fails on, and mirrored only partially into the test lane.

Hard constraint: **a live playtest/dev stack is serving from this tree** (Vite 5180/5181, Firestore
emulator 8080). No emulator, Vite, tunnel or backup process may be started, stopped or restarted;
`npm run e2e`, `verify:emulator`, `test:rules`, `dev:all`, `playtest`, `simulate` and
`npm run shared:build` are all off-limits. Verification here is pure-logic and static only.

## Goals / Non-Goals

**Goals:**
- Turn the creator-web dictionary contract into an assertion in the `npm test` lane, covering the
  rules the pure-logic lane currently misses: **A2** leaf-type parity and **A4** Hebrew-in-English,
  plus **A3 over function leaves**.
- Keep the scoped console screens at **0** PART B findings and record that as a measured baseline,
  before and after.
- Pin the current brand vocabulary (*משחק שדה*) so the retired *מירוץ הרפתקה* cannot return.

**Non-Goals:**
- Adding, renaming or retranslating any dictionary key. Nothing in scope needed one.
- Editing `scripts/check-i18n.ts` or `scripts/test-i18n-parity.ts` — `scripts/` is another agent's.
- Editing root `package.json` to put `i18n:check:strict` in `verify`, however much it wants doing.
- Covering `apps/play-web`'s dictionary, which has the identical A2/A4/function-leaf gap.
- Any runtime or UI verification. The stack must not be touched.

## Decisions

### D1. The assertion lives in creator-web's vitest suite, not in `scripts/`

The natural home for a dictionary invariant test is `scripts/test-i18n-parity.ts`, next to the
existing A1/A3 checks. That file is out of ownership for this change.

`apps/creator-web` already runs vitest (`"test": "npx vitest run"`, `vitest.config.ts` with
`include: ['src/**/*.test.ts']`, `environment: 'node'`) and already hosts pure-logic suites under
`src/lib/__tests__/`. `npm test` is `node scripts/run-unit-tests.mjs && turbo run test`, and
`turbo run test` reaches the creator-web workspace — so a file dropped at
`src/lib/__tests__/i18nDictionary.test.ts` is picked up by the existing gate with **zero**
configuration change, no new dependency, and no edit outside this change's scope.

Alternative rejected: a new `scripts/test-*.ts`. Correct location, wrong owner, and it would collide
with a parallel agent's tree.

### D2. Re-derive the invariants; do not import the checker

The test re-implements `keysDeep` / `leafTypes` / `walkLeaves` and the whitelists rather than
importing `scripts/check-i18n.ts`. Three reasons: that script is a top-level program that runs its
whole scan and calls `process.exit()` on import, so it is not importable; it is out of ownership, so
depending on its internals invites breakage from the agent that owns it; and a test that imports the
implementation it is verifying only proves the implementation agrees with itself.

The cost is duplication — the whitelist and the digit-token rule are copied. That is accepted and
flagged in a comment: if the checker's whitelist widens and the test's does not, the test is the
**stricter** of the two, which fails safe (a red that asks a human to look), never silently permissive.

### D3. Function leaves are evaluated, using the checker's Proxy trick

Creator-web entries take positional primitives (`(n: number)`, `(name: string)`) *and* single
destructured objects (`({ done, total })`). One `Proxy` around a function satisfies every shape:
`Symbol.toPrimitive` → `'0'`/`0`, `toString` → `'0'`, `valueOf` → `0`, any other property → `0`, and
`Symbol.iterator` → `undefined` so a destructuring attempt fails loudly rather than hanging. Each
function is invoked with three such arguments; a non-string return is not copy and is skipped; a
**throw is a failure**, because a Hebrew formatter that explodes on a plausible argument is a real
Hebrew-mode crash.

This is the specific gap versus `scripts/test-i18n-parity.ts`, whose `leafStrings()` returns `[]` for
a function and therefore never sees roughly a fifth of the dictionary.

### D4. "English word" = 2+ consecutive ASCII letters after whitelisting and digit-token stripping

Copied from the checker so the two agree. Whitelist: `RushPoint`, `Creator Pro`, `Pro`, `QR`, `SOS`,
`GPS`, `Google`, `YouTube`, `PWA`, `English`, `rtl`, `ltr`, `₪`. Tokens containing a digit
(`FOX42`, `ABC123`) are sample codes, not copy, and are stripped first. Hebrew allowed inside
English: `עברית`, the language toggle's own label.

The whitelist is the one place this test can rot into a rubber stamp, so the test **asserts the
whitelist is load-bearing**: at least one HE leaf must actually contain a whitelisted Latin term.
If a future edit removes all of them the whitelist is dead weight and should shrink; if someone
widens it to silence a real leak, that intent is at least visible in a diff against an assertion.

### D5. `keysDeep` treats a function as a leaf, deliberately

A function's own properties (`length`, `name`) are not dictionary keys. `keysDeep` therefore stops at
`typeof obj === 'function'`, exactly as the checker does. Without this, HE and EN key sets would
compare function internals and A1 would be meaningless.

### D6. The brand assertion is a denylist of the retired phrase, not an allowlist of the new one

Asserting *משחק שדה* must appear N times would break on any legitimate copy edit and teaches nothing.
Asserting the retired *מירוץ הרפתקה* is **absent** is stable, has no false positives, and is exactly
the regression worth catching. The bare noun *הרפתקה* is deliberately **not** banned — it is an
ordinary Hebrew word and the Builder's sample chapter title uses it correctly.

### D7. The PART B baseline is recorded in the artifacts, not asserted in code

An assertion that "these five files contain no hardcoded strings" would mean re-implementing the
checker's TypeScript AST scan inside a unit test — a second, drifting copy of a 200-line analyzer.
The checker already does it, precisely. What is recorded instead is the **measured** before/after
number for the scoped files (0 → 0) in `tasks.md`, with the verbatim command output. The enforcement
gap that leaves — PART B failing only under `--strict`, which no gate runs — is named in the
proposal as a follow-up rather than papered over.

## Risks / Trade-offs

- **Duplicated whitelist (D2/D4).** Mitigated by D4's load-bearing assertion and by the duplication
  failing strict-safe. Accepted over an unimportable dependency on another agent's file.
- **A sample argument that is nonsense for some future entry.** A formatter expecting an array would
  see a Proxy whose `Symbol.iterator` is `undefined` and throw — which this test treats as a failure.
  That is a deliberate false-positive risk taken on purpose: it surfaces at the moment the entry is
  written, with a message naming the key, rather than in Hebrew mode in front of a user.
- **The test proves language, not quality.** Nothing here can tell natural Hebrew from a stiff gloss.
  Recorded as a human follow-up rather than implied to be covered.
- **PART B can still regress without a red gate.** Out of ownership to fix (root `package.json`).
  Named explicitly so it is a known open item, not an oversight.

## Test Strategy

Lane: **pure logic only** — creator-web vitest, `environment: 'node'`, no emulator, no DOM, no
network. Reached by `npm test` via `turbo run test`. New file:
`apps/creator-web/src/lib/__tests__/i18nDictionary.test.ts`, importing `translations` from
`../../i18n`.

**Structural parity**
- HE and EN produce identical sorted recursive key-path sets; a mismatch reports the missing keys by
  name in both directions, not just a count.
- Every key has the same leaf **type** in both languages (A2) — the drift that renders
  `function (n) { … }` on screen or throws when the UI calls a string.
- No leaf is empty or whitespace-only in either language.

**Language purity, over strings AND functions**
- Every HE leaf — string, and function output under the D3 Proxy — contains no English word after
  whitelisting and digit-token stripping (A3).
- Every EN leaf, same treatment, contains no Hebrew letter outside `עברית` (A4). This rule has no
  pure-logic coverage today.
- Every function leaf in both languages is callable without throwing, and returns a string for the
  entries that are copy.

**Whitelist integrity**
- At least one HE leaf genuinely contains a whitelisted Latin term, so the whitelist is exercised
  rather than an unchecked escape hatch (D4).

**Brand vocabulary**
- The retired *מירוץ הרפתקה* appears nowhere in the HE dictionary (D6).

**Deliberately not tested here, and why**
- Hardcoded-string detection (PART B): `scripts/check-i18n.ts` owns it; duplicating its AST scan
  would create a second analyzer to drift (D7).
- Naturalness of the Hebrew: not machine-checkable; human follow-up.
- Any runtime/UI behavior: the live stack must not be touched.

**Gates run for this change:** `npm run i18n:check` (PART A is a hard gate), `npm run
i18n:check:strict`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
`npm run play:build`. **Not run, by constraint:** `npm run e2e`, `verify:emulator`, `test:rules`,
`simulate`, `shared:build`, and anything that starts or stops the emulator, Vite or the tunnel.

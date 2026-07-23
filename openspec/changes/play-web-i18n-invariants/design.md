## Context

`apps/play-web/src/i18n.ts` exports `translations = { he: HE, en: EN }` with `EN` annotated
`typeof HE`, so a *missing* key is already a compile-time error. Everything else about the two
dictionaries is unchecked at compile time: a key can be a formatter in one language and a string in
the other only if the annotation is loosened, but the annotation says nothing about the *content* of
a message, the *arity* of a formatter, or whether the sentence it builds is even in the right
language.

Measured in this working tree rather than assumed:

- **478 recursive key paths per language. 58 of them are functions** — 12% of the dictionary by key
  count, and a much larger share by "sentences a player actually reads while playing", because the
  formatters are exactly the progress/distance/cost/share messages.
- **`scripts/test-i18n-parity.ts` sees none of them.** Its `leafStrings()` is
  `if (typeof obj === 'string') return [[prefix, obj]]; if (obj === null || typeof obj !== 'object')
  return [];` — a function is neither a string nor an object, so it returns `[]`. Its English-in-HE
  rule therefore covers 420 of 478 keys. Its A1 key-parity rule does cover functions (via
  `keysDeep`), and its hand-written `TASK_KEYS` / `FINAL_KEYS` / `FN_KEYS` lists check that a fixed
  set of ~55 keys exists and that 9 of them are functions — useful, but a frozen allowlist that says
  nothing about the other ~420 keys or about any key added after it was written.
- **`scripts/check-i18n.ts` does evaluate function leaves** (same Proxy technique) and covers A1–A4
  for both apps as hard errors. It does **not** cover arity drift, empty leaves, interpolation
  safety, or brand vocabulary, and it is a program that exits, not a test.
- **Coverage gap, stated precisely.** For play-web today: A2 leaf-type drift — script only;
  A4 Hebrew-in-EN — script only; A3 over function output — script only; arity, empty leaf,
  interpolation, brand — **nowhere**.
- **The dictionary itself is currently clean** under all eight invariants (45/45 assertions green on
  first run). This change is therefore about protection, not repair, and says so rather than
  manufacturing a fix.

Hard constraint: **a live playtest/dev stack serves from this tree** (Vite 5180/5181, Firestore
emulator 8080). No emulator, Vite, tunnel or backup process may be started, stopped or restarted;
`npm run e2e`, `verify:emulator`, `test:rules`, `dev:all`, `playtest`, `simulate` and
`npm run shared:build` are off-limits. Verification here is pure-logic and static only.

## Goals / Non-Goals

**Goals:**
- Put play-web's dictionary contract in the fast lane (`npm test`), covering everything the lane
  misses today: function-valued entries, leaf-type drift, arity drift, Hebrew-in-English, empty
  leaves, interpolation safety and brand vocabulary.
- Mirror the creator-web suite's approach and house style rather than inventing a second idiom, so
  the two are readable as one pair.
- Prove every assertion can go red, without touching the shared `i18n.ts`.

**Non-Goals:**
- Adding vitest (or any runner/config) to `apps/play-web`.
- Editing `scripts/check-i18n.ts` or `scripts/test-i18n-parity.ts`.
- Re-implementing the PART B hardcoded-string AST scan.
- Adding, renaming or retranslating any dictionary key.
- Any runtime or UI verification. The stack must not be touched.

## Decisions

### D1. A `scripts/test-*.ts` assertion script, not a new vitest suite in play-web

The creator-web sibling lives in vitest because `apps/creator-web` **already** has vitest: a
`vitest` devDependency, a `vitest.config.ts` with `include: ['src/**/*.test.ts']`, a `"test"` script,
and existing suites under `src/lib/__tests__/`. A file dropped there costs zero configuration.

`apps/play-web` has **none of that** — no `vitest` devDependency, no `vitest.config.ts`, no `test`
script in its `package.json`. Mirroring the creator-web *location* would mean adding a dependency, a
config file and a workspace script, and wiring a new workspace into `turbo run test` — precisely the
"new test framework or bundler config" this change is not allowed to add, and three more moving
parts for a lane that needs none of them.

The repo already has a first-class home for exactly this shape of test:
`scripts/run-unit-tests.mjs` globs `/^test-.*\.ts$/` in `scripts/` and runs each under `tsx`,
failing the run if any exits non-zero. It is the first half of `npm test`
(`node scripts/run-unit-tests.mjs && turbo run test`) and therefore of `npm run verify`. A new file
at `scripts/test-play-web-i18n-dictionary.ts` is picked up with **zero** configuration, no
dependency, and no edit to any file another lane owns. The neighbouring
`scripts/test-i18n-parity.ts` establishes the house idiom (a `check`/`ok` helper, a counter, a
verdict line, `process.exit`), which this file follows.

Approach and invariants are mirrored from the creator-web suite; only the *runner* differs, because
the repo's own wiring differs.

### D2. Re-derive the helpers; do not import the checker

`keysDeep` / `leafTypes` / `walkLeaves` and the whitelists are re-implemented rather than imported
from `scripts/check-i18n.ts`. That script is a top-level program: importing it runs its entire scan
and calls `process.exit()` at import time, so it is not importable. Beyond that, a test that imports
the implementation it is verifying only proves the implementation agrees with itself.

The cost is a duplicated whitelist. Accepted, and flagged in a comment: if the checker's whitelist
widens and this one does not, this suite is the **stricter** of the two, which fails safe — a red
that asks a human to look, never a silent pass.

### D3. Function leaves are evaluated, using the checker's Proxy technique

play-web entries take positional primitives (`(name: string)`, `(n: number)`) *and* single
destructured objects (`({ done, total })`, `({ dist, radius })`, `({ team, game, rankPart, timePart,
url })`). One `Proxy` around a function satisfies every shape: `Symbol.toPrimitive` → the token,
`toString` → the token as a string, `valueOf` → the token, any other property → the token, and
`Symbol.iterator` → `undefined` so an array-expecting entry throws **loudly** rather than hanging.

Each function is invoked with three such arguments. A non-string return is not copy. A **throw is a
failure**, because a Hebrew formatter that explodes on a plausible argument is a real Hebrew-mode
crash in front of a player. This is the exact gap versus `scripts/test-i18n-parity.ts`.

The suite additionally asserts that the number of function leaves it *reached* equals the number of
function leaves that *exist* — so if a future refactor makes `walkLeaves` skip functions again, the
regression is named directly instead of quietly shrinking coverage back to where it started.

### D4. "English word" = 2+ consecutive ASCII letters after whitelisting and digit-token stripping

Copied from the checker so the two agree. Whitelist: `RushPoint`, `Creator Pro`, `Pro`, `QR`, `SOS`,
`GPS`, `Google`, `YouTube`, `PWA`, `English`, `rtl`, `ltr`, `₪`. Tokens containing a digit (`FOX42`,
`ABC123`) are sample access codes, not copy, and are stripped first. Hebrew allowed inside English:
`עברית`, the language toggle's own label.

The whitelist is the one place this suite could rot into a rubber stamp, so it **asserts the
whitelist is load-bearing**: at least one HE leaf must genuinely contain a whitelisted Latin term. If
a future edit removes all of them the whitelist is dead weight and should shrink; if someone widens
it to silence a real leak, that intent is at least visible in a diff against an assertion.

### D5. `keysDeep` treats a function as a leaf, deliberately

A function's own properties (`length`, `name`) are not dictionary keys. `keysDeep` stops at
`typeof obj === 'function'`, exactly as the checker does. Without this, the two key sets would
compare function internals and the parity rule would be meaningless. Arity is checked separately and
explicitly (D6) rather than by leaking `length` into the key set.

### D6. Arity parity is a separate rule, because type parity does not imply it

`typeof he.x === typeof en.x === 'function'` is satisfied by a HE formatter taking `({done, total})`
whose EN twin takes nothing. The English UI then renders `Stop of` — grammatically intact, factually
empty, and invisible to every existing check. `Function.length` is compared per key path. It is a
coarse signal (it stops at the first defaulted or rest parameter) but it is free, deterministic, and
catches the drift that actually happens: a formatter rewritten in one language only.

### D7. Interpolation safety: two rules, one structural and one differential

- **Structural.** No produced message may contain a raw `{ident}` / `%s` / `%d` / `${` token, the
  word `undefined`, the word `NaN`, or `[object Object]`. These are the visible signatures of a
  message templated with the wrong syntax, or an argument destructured under the wrong shape.
- **Differential.** Every message is rendered twice, with two very different sample tokens. An entry
  that declares at least one parameter and produces a **byte-identical** message both times never
  used its argument — the interpolation was dropped. No correct formatter is byte-stable across
  arguments that differ by three orders of magnitude, so the false-positive surface is essentially
  nil, while the true positive (`(n) => 'Stop'`) is a real user-visible bug.

The differential form is chosen over "the sample value must appear in the output" because a
legitimate formatter may transform its argument — `updatedAgo({s})` divides by 60 and renders
minutes — and would fail a naive containment check while being entirely correct.

### D8. The brand rule is a denylist of the retired phrase, in both languages

Asserting *משחק שדה* must appear N times would break on any legitimate copy edit and teaches nothing.
Asserting the retired *מירוץ הרפתקה* — and its English counterpart "race adventure" — is **absent** is
stable, has no false positives, and is exactly the regression worth catching. The bare noun *הרפתקה*
is deliberately **not** banned: it is an ordinary Hebrew word and legitimate copy may use it. The
English direction is checked too, which the creator-web suite does not do — the retired brand had an
English half, and play-web's share text is the most-copied English string the product emits.

### D9. Detector self-checks run against local fixtures, never against the real dictionary

Each rule is fed a deliberately defective dictionary constructed inside the test file and must
report the offending key by name; the negative cases (brand terms, a sample access code, the `עברית`
toggle label, a correctly rendered message) must **not** be flagged. These cases stay red-able
forever, and they cost nothing.

The real `apps/play-web/src/i18n.ts` is **never** mutated to demonstrate a red. Other lanes are
editing that file concurrently in this tree; an earlier agent mutated a shared file mid-session to
prove a detector worked, and the restore window is a needless opportunity to clobber someone else's
work. Fixtures prove the same thing with none of the risk.

## Risks / Trade-offs

- **Duplicated whitelist (D2/D4).** Mitigated by the load-bearing assertion and by duplication
  failing strict-safe. Accepted over an unimportable dependency on another lane's file.
- **A sample argument that is nonsense for a future entry.** A formatter expecting an array sees a
  Proxy whose `Symbol.iterator` is `undefined` and throws — which this suite treats as a failure.
  A deliberate false-positive risk: it surfaces when the entry is written, naming the key, rather
  than in Hebrew mode in front of a player.
- **`Function.length` is coarse (D6).** A defaulted parameter hides later ones, so arity parity can
  under-report. It never *over*-reports, so it cannot produce a false red.
- **The differential interpolation rule (D7) could in principle false-positive** on a formatter that
  branches to the same output for both sample tokens. Both tokens are chosen far apart (7 vs 4242) to
  make that combination implausible, and the failure message names the key and its rendered value so
  a human can adjudicate in seconds.
- **The suite proves language, not quality.** Nothing here distinguishes natural Hebrew from a stiff
  gloss. Recorded as a human follow-up rather than implied to be covered.

## Test Strategy

Lane: **pure logic only** — a `tsx` assertion script, no emulator, no DOM, no network. New file:
`scripts/test-play-web-i18n-dictionary.ts`, importing `translations` from
`../apps/play-web/src/i18n`. Discovered by `scripts/run-unit-tests.mjs` (`/^test-.*\.ts$/`) and thus
run by `npm test` and `npm run verify`. House style: an `ok(cond, msg, detail)` helper, pass/fail
counters, a verdict line, `process.exit(failed === 0 ? 0 : 1)`.

**Structural parity**
- A1 — HE and EN produce identical sorted recursive key-path sets; a mismatch names the missing keys
  in both directions, not just a count. The set is asserted non-empty so a broken walker cannot pass
  vacuously.
- A2 — every key has the same leaf **type** in both languages, and every function entry declares the
  same **arity** (D6).
- A6 — no leaf is empty or whitespace-only in either language.

**Language purity, over strings AND function output**
- A3 — every HE leaf, string and function output alike, contains no English word after whitelisting
  and digit-token stripping.
- A4 — every EN leaf, same treatment, contains no Hebrew letter outside `עברית`. No pure-logic
  coverage of this direction existed for play-web.
- The Latin whitelist is asserted load-bearing (D4).

**Function entries are exercised (A5)**
- The dictionary is asserted to *have* function entries, and the count reached by the walker is
  asserted equal to the count that exists — the specific blind spot, guarded directly.
- No function entry throws on plausible arguments; every one returns a string message.

**Interpolation safety (A8)**
- No raw placeholder / `undefined` / `NaN` / `[object Object]` in any produced message (D7).
- Every argument-taking entry demonstrably consumes its argument, proven differentially (D7).

**Brand vocabulary (A7)**
- The retired *מירוץ הרפתקה* is absent from HE, "race adventure" is absent from EN, and the bare noun
  *הרפתקה* remains allowed (D8).

**Detector self-checks (D9)**
- Twenty cases over local fixtures: a key missing on one side; leaf-type drift; arity drift; a
  whitespace-only entry; English inside a Hebrew **function** entry; Hebrew inside an English entry
  including a function; a formatter that throws; each interpolation signature; an argument-taking
  entry that ignores its argument; both retired brand phrases. Plus the negatives — whitelisted brand
  terms, a sample access code, the `עברית` toggle label and a correctly rendered message must not be
  flagged.

**Deliberately not tested here, and why**
- Hardcoded-string detection (PART B): `scripts/check-i18n.ts` owns it and `npm run verify` now
  enforces it under `--strict`; duplicating its AST scan would create a second analyzer to drift.
- Naturalness of the Hebrew: not machine-checkable; human follow-up.
- Any runtime/UI behavior: the live stack must not be touched.

**Gates run for this change:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
`npm run creator:build`, `npm run i18n:check`, `npm run i18n:check:strict` (PART B must stay at zero
repo-wide, because `verify` now enforces strict). **Not run, by constraint:** `npm run e2e`,
`verify:emulator`, `test:rules`, `simulate`, `shared:build`, and anything that starts or stops the
emulator, Vite or the tunnel.

## Why

`apps/play-web` is the **participant** app. It is Hebrew-first, it runs on a player's phone, in the
field, mid-game, often on a connection with nothing to spare. When a string there is missing, wrong,
or in the wrong language, the player cannot switch to a laptop and work around it — they are standing
at a task they can no longer read. The same defect in the creator console is an annoyance; here it
ends someone's game.

The invariants that would catch it exist, but only partially, and only outside the test lane:

1. **`scripts/test-i18n-parity.ts` — the only `npm test` coverage — cannot see function-valued
   entries.** Its `leafStrings()` helper returns `[]` for a function. play-web's dictionary has
   **58 function-valued entries per language** out of 478 keys — `task.stopOf({done,total})`,
   `task.walkCloser({dist,radius})`, `final.shareText({team,game,rankPart,timePart,url})`,
   `play.lockedCompleteFirst({names})` — and every one of them is the *rendered sentence a player
   reads at the moment they are stuck*. All 58 are invisible to that script, in both languages.
2. **Leaf-TYPE drift and Hebrew-in-the-English-dictionary have no pure-logic coverage at all.** A key
   that is a formatter in Hebrew and a plain string in English renders `function (n) { … }` on
   screen, or throws when the UI calls it — a one-language crash.
3. **Function ARITY drift has no coverage anywhere**, in either app or in `check-i18n.ts`. A HE
   formatter taking `({done, total})` whose EN twin takes nothing silently renders a half-built
   sentence.
4. **Interpolation safety has no coverage anywhere.** Nothing asserts that a `{n}`-style argument is
   actually consumed, or that `undefined` / `NaN` / `[object Object]` never reach the screen. The
   project has already shipped a non-finite-number defect to a live leaderboard once.
5. `scripts/check-i18n.ts` does cover A1–A4 including function output — but it is a **lint-style
   program**, it owns the rules it enforces, and a regression there is not a red test in the fast
   lane that agents actually run between edits.

A sibling lane closed exactly this gap for the creator console
(`apps/creator-web/src/lib/__tests__/i18nDictionary.test.ts`, 17 vitest tests) and explicitly flagged
that play-web has the identical hole and no equivalent test. This change closes it, for the app where
it matters most.

## What Changes

**The play-web dictionary contract becomes an assertion in `npm test`.**
- A pure-logic assertion script — no emulator, no DOM, no network — pins the structural contract of
  `apps/play-web/src/i18n.ts`: identical recursive key sets in both languages, identical leaf *type*
  per key, identical *arity* for every formatter, no empty or whitespace-only message, Hebrew copy
  free of English words, and English copy free of Hebrew letters.
- Crucially it **calls** every function-valued entry and judges the message it produces — closing the
  blind spot where a Hebrew formatter could return an English sentence, or throw, and no test in the
  repo would notice. A formatter that throws on plausible arguments is treated as a failure, because
  that is a real crash in one language's UI.
- It adds **interpolation safety**, which nothing covers today: no raw `{placeholder}`, no
  `undefined`, no `NaN`, no `[object Object]` in any produced message, and an argument-taking entry
  must demonstrably *consume* its argument — proven by rendering it twice with different arguments
  and requiring the output to differ.
- It pins the current **brand vocabulary**: the retired *מירוץ הרפתקה* / "race adventure" wording
  cannot creep back into either dictionary. The product is a *field game* / *משחק שדה*.

**Every assertion is proven able to fail.** A suite that has never gone red has not been shown to
test anything. Each rule is fed a deliberately defective **local fixture** dictionary built inside
the test and must notice — including the negative cases, so the brand/units whitelist cannot decay
into a rubber stamp. The real `i18n.ts` is never mutated to demonstrate a red: it is a shared file
that other lanes are editing concurrently, and mutating it in place risks clobbering their work in
the restore window.

### Non-goals

- **No new copy and no changed copy.** Measured first: the dictionary is clean under all eight
  invariants, so no key is added, renamed, retranslated or removed. Inventing a copy change to
  justify the section would be fabrication.
- **No product behavior changes.** No screen, no component, no callable, no Firestore rule, no
  `packages/shared` type.
- **No new test framework, runner or bundler configuration.** play-web has no vitest wiring; this
  change deliberately does not add any (see design D1).
- **Does not edit `scripts/check-i18n.ts` or `scripts/test-i18n-parity.ts`.** They are read, never
  changed; the new script is purely additive.
- **Does not cover play-web's hardcoded-string surface (PART B).** `check-i18n.ts` owns that AST
  scan and `npm run verify` now enforces it under `--strict`; duplicating a 200-line analyzer inside
  a unit test would create a second copy to drift.
- **Does not verify anything at runtime.** A live playtest stack serves from this tree.

## Capabilities

### New Capabilities
- `play-web-dictionary-invariants`: The participant app guarantees, as an enforced test in the fast
  lane rather than an advisory report, that its two dictionaries are structurally identical down to
  the shape of every formatter, that each language's copy is genuinely in that language *including
  the sentences formatters build at runtime*, that no message can render a raw placeholder or a
  broken value, and that the app speaks the current brand vocabulary.

## Impact

- **Surfaces touched:** the pure-logic test lane only. **No** shared types, **no** callables, **no**
  Firestore rules, **no** UI, **no** dictionary values.
- **Files:** one new file, `scripts/test-play-web-i18n-dictionary.ts`, discovered automatically by
  the existing `scripts/run-unit-tests.mjs` glob (`/^test-.*\.ts$/`) and therefore reached by
  `npm test` → `npm run verify`. Zero configuration change, zero new dependency.
- **New dependencies / env vars:** none.
- **Backwards compatibility:** total. Nothing that ships to a user changes.
- **Risk:** the language-purity rules need the same brand/units whitelist the checker uses
  (`RushPoint`, `Pro`, `QR`, `SOS`, `GPS`, `₪`, `English`, `rtl`/`ltr`, …) or they red on legitimate
  Latin text inside Hebrew copy. Mitigated by mirroring the checker's whitelist and its
  digit-bearing-token rule, and by asserting the whitelist stays load-bearing so it cannot silently
  widen into a rubber stamp. The argument-consumption rule is the other false-positive risk; it is
  scoped to *identical output for two very different arguments*, which no correct formatter produces.
- **Concurrency:** other lanes are adding keys to `apps/play-web/src/i18n.ts` during this change
  (tags, map/area, stuck-player copy). The new script is structural — it asserts *properties of every
  key*, never a fixed key list — so their additions are covered on arrival rather than colliding.
- **Testing:** pure-logic lane only. `npm run e2e`, `verify:emulator`, `test:rules`, `simulate`,
  `npm run shared:build` and any emulator/Vite/tunnel start-stop are deliberately NOT run — a live
  playtest stack is serving from this tree. Stated rather than assumed.
- **Left for a human:** native-speaker review of the participant Hebrew copy. The tests prove the
  Hebrew is *Hebrew*, complete, on-brand and correctly interpolated; they cannot prove it reads well
  to a fourteen-year-old holding a phone in the dark.

## Why

RushPoint's creator console is **Hebrew-first**: `apps/creator-web` boots in Hebrew and English is
the opt-in in Settings. The recurring, user-visible defect is a component that hardcodes a UI string
— it then renders English while the app is set to Hebrew (or the reverse) and never switches.
`npm run i18n:check` PART B is the detector for exactly that, and the project has carried a known
backlog of roughly 119 PART B findings across the Builder and the consoles.

This change was scoped to clear that backlog for the run/dashboard/wallet console screens. Measuring
first — as the workflow requires — changed what the change is about:

1. **The PART B backlog for the scoped screens is already zero.** `npx tsx scripts/check-i18n.ts`
   and `--strict` both report `✓ PART B (source scan): no hardcoded UI strings bypassing i18n.` for
   the *entire* repo, not just these files. Independently confirmed per file: `RunConsolePage.tsx`,
   `DashboardPage.tsx`, `WalletPage.tsx`, `RunsOverviewPage.tsx` and `components/ui.tsx` contain
   **no Hebrew characters at all** (every Hebrew string reaches them through `t.*`), no
   `label:`/`title:`-style object-literal copy, and no `cond ? 'Yes' : 'No'` inline copy — the
   ternary hits in those files are Tailwind class strings and enum discriminants. The single
   `// i18n-ignore` in scope is `WalletPage.tsx:165` for the `PRO` badge, which is brand text. The
   "~119 findings" figure is **stale**; a previous cleanup landed it.
2. **Nothing stops it from coming back.** `i18n:check:strict` — the only mode where PART B *fails* —
   is in no gate. `npm run verify` runs plain `i18n:check`, where PART B is a printed warning and
   the process still exits 0. So the backlog can silently regrow to 119 again without a single red
   gate.
3. **The pure-logic lane under-checks the dictionaries.** `scripts/test-i18n-parity.ts` (the only
   `npm test` coverage) asserts key-set parity and English-in-Hebrew leakage — but only over
   `leafStrings`, which **skips function-valued entries entirely**. Roughly a fifth of the creator
   dictionary is functions (`w.proMonthly(n)`, `t.run.stopOf(a, b)`, …), and their rendered output
   is what the user actually reads. It also never checks the two mirror invariants at all:
   **Hebrew leaking into the English dictionary** (checker rule A4) and **leaf type drift**, where a
   key is a string in one language and a function in the other (rule A2) — a drift that makes the
   Hebrew UI render `function (n) { … }` or crash on call.

So the honest statement of the problem is not "119 strings to fix". It is: **the cleanup already
happened and is completely unprotected.** Rules A2 and A4 and every function-valued leaf live only
in a lint-style script that no gate enforces as a failure.

## What Changes

**The dictionary invariants become a test, not a report.**
- A pure-logic assertion — no emulator, no DOM — pins the structural contract of the creator-web
  dictionaries: identical key sets in both languages, identical leaf *types* per key, Hebrew copy
  free of English words, English copy free of Hebrew letters, and no empty or whitespace-only leaf.
- Crucially it evaluates **function-valued entries** and asserts on their rendered output, closing
  the gap where a Hebrew formatter could return an English sentence and no test would notice.
- It runs in the creator-web vitest suite, so it is reached by `npm test` → `turbo run test` and
  therefore by `npm run verify`. A regression fails a **test**, not a warning line.

**The retired brand cannot creep back into Hebrew copy.**
- The product is a **field game / משחק שדה**. The pre-rebrand wording *מירוץ הרפתקה* ("race
  adventure") is asserted absent from the Hebrew dictionary, so a future copy edit that reaches for
  the old vocabulary fails a test instead of shipping mixed branding.

**The scoped screens' PART B state is recorded as a verified baseline, not assumed.**
- `RunConsolePage.tsx`, `DashboardPage.tsx`, `WalletPage.tsx`, `RunsOverviewPage.tsx` and
  `components/ui.tsx` are confirmed at **0** PART B findings, before and after. That zero is now the
  asserted contract rather than an accident nobody was watching.

### Non-goals

- **No new copy and no changed copy.** No dictionary key is added, renamed, retranslated or removed.
  There was no hardcoded string left to route through `t.*` in scope, so inventing translations
  would be fabrication.
- **No product behavior changes.** No callables, no Firestore rules, no `packages/shared` types, no
  play-web, no UI markup.
- **Out of scope by ownership:** the Builder (`BuilderPage`/`TaskEditor`/`templates.ts`), the Gallery
  and task-library pages and their map components, `apps/play-web/**`, `packages/shared/**`,
  `functions/**`, and everything under `scripts/` — all owned by other agents in parallel. In
  particular `scripts/check-i18n.ts` and `scripts/test-i18n-parity.ts` are **read, never edited**;
  the new assertion is additive and lives in creator-web.
- **Does not add `i18n:check:strict` to `npm run verify`.** That edits root `package.json`, outside
  this change's ownership. It is recorded as a follow-up recommendation, not done silently.
- **Does not touch the play-web dictionary**, even though the same A2/A4/function-leaf gap exists
  there. Same ownership reason; called out so it is not mistaken for coverage.

## Capabilities

### New Capabilities
- `creator-console-i18n`: The Hebrew-first creator console guarantees, as an enforced test rather
  than an advisory report, that every user-visible string switches language — no screen hardcodes UI
  copy, the two dictionaries are structurally identical, each language's copy is genuinely in that
  language (including the output of function-valued entries), and the console speaks the current
  brand vocabulary.

## Impact

- **Surfaces touched:** `apps/creator-web` test lane only. **No** shared types, **no** callables,
  **no** Firestore rules, **no** play-web, **no** `scripts/`, **no** dictionary values.
- **Files:** one new test file `apps/creator-web/src/lib/__tests__/i18nDictionary.test.ts`, picked up
  by the existing `apps/creator-web/vitest.config.ts` (`include: ['src/**/*.test.ts']`) and therefore
  by `npm test`. No production file required a change — the scoped screens were already clean.
- **New dependencies / env vars:** none.
- **Backwards compatibility:** total. Nothing that ships to a user changes.
- **Risk:** the language-purity assertions need the same brand/units whitelist the checker uses
  (`RushPoint`, `Pro`, `QR`, `SOS`, `GPS`, `₪`, `English`, `rtl`/`ltr`, …) or they produce false
  reds on legitimate Latin text inside Hebrew copy. Mitigated by mirroring the checker's whitelist
  and its digit-bearing-token rule, and by asserting the whitelist itself is exercised so it cannot
  silently widen into a rubber stamp.
- **Testing:** pure-logic lane only. `npm run e2e`, `verify:emulator`, `test:rules`, `simulate` and
  any emulator/Vite/tunnel restart are deliberately NOT run — a live playtest stack is serving from
  this tree. That is stated rather than assumed.
- **Left for a human:** native-speaker review of the existing Hebrew console copy. The tests prove
  the Hebrew is *Hebrew* and structurally complete; they cannot prove it reads naturally.

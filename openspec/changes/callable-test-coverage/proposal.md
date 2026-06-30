# Proposal — Callable & component test-coverage hardening

## Why

The 2026-06-30 audit found the **test pyramid is inverted and thin in the middle**. There is a strong
top (`scripts/e2e-verify.mjs` exercises the full lifecycle vs the emulator) and a reasonable bottom
(co-located vitest for `batchUtil`, `gallery`, `assignNextTask`, `sanitizeTask`, `sanity.guard`, plus
many `scripts/test-*.ts` pure-logic scripts). But the **middle is missing**:

- **Callable-level unit coverage is sparse.** Most callables are only exercised happy-path by e2e;
  their **error branches** (auth failure, bad input, not-found, wrong-state, billing rollback) have no
  fast, isolated regression test. A refactor that silently breaks an error branch passes `npm test`.
- **Eleven `__planned__/v21-*.todo.test.ts` files are pure `test.todo` placeholders** — roadmap intent
  with **zero executing assertions**. They inflate the file count but verify nothing; vitest reports
  them as "todo," easy to mistake for coverage.
- **No component-level tests** beyond a single `BuilderRedesign.test.ts` — the participant `TaskRunner`
  answer/submit logic and the sanitizer→client contract are only checked manually.

This change **raises the floor of the middle layer** without boiling the ocean: it (a) adds isolated
unit tests for the **error/edge branches** of the highest-risk callables (billing, scoring, run
lifecycle, answer submission), (b) establishes a **repeatable pattern** for callable unit tests with a
mocked Admin SDK so future callables come with one, and (c) **converts the already-relevant `test.todo`
stubs** for shipped behavior into executing assertions (or deletes stubs for unshipped rows so the
file count stops lying). It is test-only — **no production behavior changes**.

## What Changes

> Test-only. No product behavior changes. Raises regression coverage of existing behavior.

**P0 — error-branch unit tests for high-risk callables**
- New co-located vitest specs assert the **failure** branches (not just happy path) of:
  `launchRun` (insufficient credits → `failed-precondition`; credit **rolls back** on a post-billing
  failure), `submitTaskAnswer` (wrong-state / finished run / over-`attemptLimit`), `finalizeRun`
  (idempotency / already-finalized), `joinRun` (bad code / closed run), and the scoring entry points
  (`calculateScore`/`taskScore`) at their boundary inputs.

**P0 — a reusable callable-unit-test harness**
- A small `functions/src/testutil/` helper provides a **mocked Admin SDK / context** (auth uid,
  Firestore doc stubs) so a callable can be unit-tested in isolation, fast, no emulator. Documented so
  every new callable adds an error-branch test cheaply.

**P1 — honest placeholders**
- For roadmap rows whose behavior **is shipped**, convert the matching `test.todo` lines into real
  assertions. For rows **not** shipped, leave `test.todo` (they're the RED blueprint) — but add a
  header comment clarifying "blueprint, not coverage," and ensure `npm test` counts real vs todo
  distinctly so coverage isn't overstated.

**P1 — one participant-flow component test**
- A `TaskRunner` test (or a sanitizer→render contract test) covering the answer-submit happy path +
  the "answer key never reaches the client" guarantee, establishing the component-test pattern.

## Capabilities

### New Capabilities
- `test-coverage`: high-risk callables have isolated error-branch regression tests; a documented
  mocked-Admin harness exists for callable unit tests; placeholder `test.todo` stubs no longer
  masquerade as coverage.

### Modified Capabilities
<!-- None — test-only; establishes the testing baseline. No runtime spec changes. -->

## Surfaces touched

- **Tests (new):** co-located `functions/src/**/<callable>.test.ts` for the high-risk callables;
  `functions/src/testutil/mockAdmin.ts` (**new** harness); one
  `apps/play-web/src/components/TaskRunner.test.tsx` (or sanitizer contract test).
- **Test config:** ensure vitest picks up the new specs (already does for `functions/`); add a play-web
  vitest config **only if** a component runner isn't already present (else keep UI verification manual
  per project convention and put the contract test in `functions/` against the sanitizer).
- **`__planned__/v21-*.todo.test.ts`:** convert shipped-row todos to assertions; annotate the rest.
- **No production source changes.** No callables, types, rules, or env vars touched.

## Non-goals

- **No 100% coverage target / coverage gate** — this raises the floor on the riskiest paths, it does
  not mandate a percentage (that can come later in CI).
- **No full component test runner for both apps** — the project verifies UI via preview tools; this
  adds at most one contract-style component test to establish the pattern, not a UI suite.
- **No new e2e scenarios for unshipped features** — unshipped roadmap rows stay `test.todo`.
- **No change to `npm test` lane structure** — new specs run inside the existing vitest lane.
- **No refactor of production code "to make it testable"** beyond what the mock harness needs (if a
  callable can't be unit-tested without a refactor, note it; don't change behavior here).

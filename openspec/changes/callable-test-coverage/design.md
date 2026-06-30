# Design — Callable & component test-coverage hardening

## Current behavior (authoritative refs — from the audit)

- **Real, executing vitest specs (the good bottom layer):** `functions/src/batchUtil.test.ts`,
  `functions/src/gallery/index.test.ts`, `functions/src/routing/assignNextTask.test.ts`,
  `functions/src/runs/sanitizeTask.test.ts`, `functions/src/sanity.guard.test.ts` — plus the many
  `scripts/test-*.ts` pure-logic scripts run by `scripts/run-unit-tests.mjs`.
- **The full top layer:** `scripts/e2e-verify.mjs` (`npm run e2e`) — create→update→launch→join→
  start→play→review→leaderboard→finalize, partial stages, locationless routing, finished-run
  rejection, paid hints. Happy-path-dominant.
- **The hollow middle:** the 11 `functions/src/__planned__/v21-*.todo.test.ts` files are **entirely
  `test.todo`** (e.g. `v21-security-and-reliability` rows 3/4/18/19/21) — they execute **no**
  assertions. They are a RED-phase blueprint, not coverage, but `npm test` lists them as tests.
- **No callable-isolated error-branch tests:** e.g. `launchRun` insufficient-credit and rollback,
  `submitTaskAnswer` finished-run rejection, `finalizeRun` re-finalize idempotency are only implicitly
  (and partially) covered by e2e happy paths.
- **No component tests** beyond `BuilderRedesign.test.ts`.

## Files to touch

| File | Change |
|---|---|
| `functions/src/testutil/mockAdmin.ts` | **NEW.** A minimal mocked Admin SDK: in-memory `db` with `doc()/get()/set()/update()/runTransaction()`, a fake `context.auth`, and helpers to seed a wallet/game/run/team. Lets a callable run in isolation, no emulator. |
| `functions/src/runs/launchRun.test.ts` | **NEW.** Error branches: insufficient credits → `failed-precondition`; a forced post-billing failure leaves `eventCredits` **unchanged** (rollback). |
| `functions/src/runs/submitTaskAnswer.test.ts` | **NEW.** Finished run → rejected; over-`attemptLimit` → `resource-exhausted`; wrong-state task → rejected; correct answer → scored. |
| `functions/src/runs/finalizeRun.test.ts` | **NEW.** Re-finalizing an already-finalized run is idempotent / rejected (no double bonus). |
| `functions/src/runs/joinRun.test.ts` | **NEW.** Unknown/closed access code → typed error; valid code → team created. |
| `functions/src/scoring/*.test.ts` | **NEW.** Boundary inputs for `calculateScore`/`taskScore` (zero/large/negative-guard, each preset). |
| `functions/src/testutil/README.md` | **NEW.** One page: "how to write a callable error-branch test" (the repeatable pattern). |
| `apps/play-web/.../TaskRunner.test.tsx` **or** `functions/src/runs/sanitizeTask.test.ts` (extend) | The sanitizer→client contract: answer keys/`secretCode`/`hint`/`numericAnswer`/`steps[].answer` are stripped; happy-path answer submit. Prefer extending the **existing** sanitizer test if a play-web component runner isn't configured. |
| `functions/src/__planned__/v21-*.todo.test.ts` | Convert shipped-row todos to assertions; add a "blueprint, not coverage" header to the rest. |

## The mocked-Admin harness (the reusable pattern)

```ts
// functions/src/testutil/mockAdmin.ts (sketch)
export function makeDb(seed?: Record<string, unknown>) {
  const store = new Map<string, any>(Object.entries(seed ?? {}));
  const doc = (path: string) => ({
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (v: any, o?: any) => store.set(path, o?.merge ? { ...store.get(path), ...v } : v),
    update: async (v: any) => store.set(path, { ...store.get(path), ...v }),
  });
  const runTransaction = async (fn: any) => fn({ get: (r: any) => r.get(), set: (r: any, v: any) => r.set(v) });
  return { store, doc: (p: string) => doc(p), runTransaction };
}
export const ctx = (uid?: string) => ({ auth: uid ? { uid } : undefined } as any);
```

- **Why mock, not emulator:** these tests assert **branch logic** (which `HttpsError` fires, whether a
  credit rolled back), which needs determinism and speed, not a real Firestore. The emulator stays the
  job of `e2e-verify.mjs` (integration). This keeps the new specs in the fast `npm test` lane.
- **Honest-by-construction:** the harness seeds only what a test needs; a callable that reaches for an
  unseeded path fails loudly — surfacing hidden dependencies.
- **The pattern is documented** so every future callable adds an error-branch test for ~10 lines.

## Honest placeholders

- Each `v21-*.todo.test.ts` gets a top comment: *"RED-phase blueprint (Appendix B rows X). `test.todo`
  here is intended future coverage, NOT a passing assertion."*
- Where the behavior is **already shipped** (e.g. paid hints, partial stages — covered by e2e), convert
  the corresponding todo into a real pure/vitest assertion or delete it if redundant with an existing
  spec, so the todo list reflects only **genuinely pending** work.

## Test strategy (this change *is* tests — so: how we prove the tests are right)

- Every new spec is written **RED-first**: assert the branch, run, confirm it fails *for the stated
  reason* against the current code (or passes if the behavior already holds — then it's a regression
  pin), before relying on it. For rollback/idempotency specs, first assert the *buggy* outcome to prove
  the test can fail, then the correct one (the project's documented RED discipline).
- The harness itself gets a tiny self-test (`mockAdmin.test.ts`) so a broken mock can't silently make
  callable tests pass.
- **No production code changes** ⇒ `npm run e2e`, `creator:build`, `play:build`, `i18n:check` must
  remain green unchanged; they're run as the regression guard that this change is purely additive.

## No new runtime surface

- No callables, types, `firestore.rules`, indexes, or env vars are added or changed. Pure test
  additions inside the existing vitest + aggregator lanes.

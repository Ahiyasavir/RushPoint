# Design — Continuous-integration pipeline

## Current behavior (authoritative refs — from the audit)

- **No CI exists:** there is no `.github/workflows/` directory. All gates are manual.
- **The documented required gates** (CLAUDE.md "Required gates" + `openspec/config.yaml`):
  `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run play:build` ·
  `npm run e2e` · `npm run i18n:check` (+ `npm run test:rules` for rules changes).
- **Known runner requirements (from the dev scripts):**
  - The Firebase emulator needs **Java ≥ 21** (`scripts/dev-emulator.mjs` auto-switches locally).
  - Cloud Functions **must be built before** the emulator starts (stale `functions/lib` was a past
    failure).
  - `npm test` runs two lanes: `scripts/run-unit-tests.mjs` (tsx pure-logic scripts) then vitest in
    `functions/`. No emulator needed for `npm test`.
  - `npm run e2e` / `npm run test:rules` **do** need the emulator suite running.
  - Clients connect over `127.0.0.1` (Windows IPv6 note) — irrelevant on Linux CI but harmless.

## Files to touch

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | **NEW.** Two jobs: `fast` (no emulator) and `emulator` (e2e + rules). Triggers: `pull_request`, `push` to `main`. Concurrency-cancel superseded runs. |
| `.github/CONTRIBUTING.md` (or workflows README) | **NEW (docs).** Which checks to mark **required** in branch protection so `main` can't merge red. |
| `package.json` | Optional: a single `ci:fast` aggregate **only if** it reduces duplication; otherwise call existing scripts directly. |

## Workflow shape (`ci.yml`)

```yaml
name: CI
on:
  pull_request:
  push: { branches: [main] }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }

jobs:
  fast:                      # the no-emulator gate set
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run creator:build
      - run: npm run play:build
      - run: npm run i18n:check
      # On UI-touching PRs, also enforce strict (zero new hardcoded strings):
      - run: npm run i18n:check:strict

  emulator:                  # e2e + rules need Java 21 + Firebase emulators
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }
      - run: npm ci
      - run: npm --workspace functions run build   # build functions BEFORE the emulator (footgun)
      - run: npm run e2e          # boots emulator, runs scripts/e2e-verify.mjs
      - run: npm run test:rules   # @firebase/rules-unit-testing vs the emulator
```

- **Two jobs, not one:** the `fast` lane gives quick feedback (typecheck/lint/build/test) and the
  heavier `emulator` lane runs in parallel — a failing typecheck doesn't wait on the emulator boot.
- **JDK 21** via `setup-java` mirrors `dev-emulator.mjs`'s local auto-switch — the emulator won't start
  on older Java.
- **Functions built first** in the emulator job — encodes the documented "stale `functions/lib`"
  lesson so CI can't hit it.
- **`cache: npm`** + the built-in setup-node cache covers `~/.npm`; optionally cache the Firebase
  emulator binaries (`~/.cache/firebase/emulators`) to shave boot time.
- **Emulator runs keyless:** the repo's client configs bake in emulator-safe defaults, so no Stripe/
  MapTiler/Firebase secrets are required for `e2e`/`test:rules`. (Jobs needing real keys are a non-goal.)
- **i18n strict** is listed; if running it unconditionally is too strict for legacy findings, gate the
  `:strict` step on a changed-files filter for `**/i18n.ts` / `**/components/**` so only UI PRs must be
  clean (matches the repo rule "new UI adds zero findings").

## How `e2e` boots the emulator in CI

`npm run e2e` (and `dev-emulator.mjs`) start the emulator suite themselves. In CI we either (a) rely on
the existing script if it starts + tears down the emulator around the e2e run, or (b) wrap with
`firebase emulators:exec --only firestore,auth,functions,storage "node scripts/e2e-verify.mjs"` so the
emulator lifecycle is owned by the CLI and exits cleanly. The design task verifies which the current
`e2e` script does and uses `emulators:exec` if the script assumes an already-running suite.

## Test strategy (how we prove the pipeline itself works)

- **The workflow is validated by running it:** open the change's PR and confirm both jobs go green —
  the workflow *is* its own proof. Each step is an existing, already-green local gate, so a red step is
  a real signal, not flakiness.
- **Negative check:** intentionally push a trivial type error on a scratch branch and confirm the
  `fast` job **fails** (proves the gate actually blocks), then revert. (Documented in the tasks, run
  once.)
- **No app code changes** ⇒ all local gates remain green; CI simply runs them in a clean room.
- **Determinism:** pin action versions (`@v4`) and Node 20 / Java 21 so runs are reproducible.

## No new runtime surface

- No application source, types, `firestore.rules`, indexes, or env vars. CI consumes existing scripts.
- No repository secrets required (emulator lane is keyless). Branch-protection "required checks" is a
  GitHub setting documented in `CONTRIBUTING.md`, not code.

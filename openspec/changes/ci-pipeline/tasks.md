# Tasks — Continuous-integration pipeline (RED → GREEN → REFACTOR)

> Process/infra change. The pipeline is proven by running it (a red gate must actually block). Do
> tasks in order.

## P0 — verify the emulator entrypoint

### 1. Investigate — how does `npm run e2e` own the emulator?
- [x] Read `scripts/e2e-verify.mjs` + `scripts/dev-emulator.mjs` and confirm whether `npm run e2e`
  starts/stops the emulator itself or assumes a running suite. Decide CI invocation: direct
  `npm run e2e` vs wrapping with `firebase emulators:exec`. Note the decision in the workflow comment.
  DECISION: e2e + test:rules are emulator *clients* (assume a running suite); CI wraps both with
  `firebase emulators:exec --only firestore,auth,functions,storage`. Documented in ci.yml header.

## P0 — the fast lane

### 2. GREEN — `ci.yml` fast job
- [x] Create `.github/workflows/ci.yml` with the `fast` job on `pull_request` + `push: main`:
  `npm ci` → `typecheck` → `lint` → `test` → `creator:build` → `play:build` → `i18n:check`. Node 20,
  `cache: npm`, concurrency-cancel superseded runs.

## P0 — the emulator lane

### 3. GREEN — `ci.yml` emulator job
- [x] Add the `emulator` job: `setup-java@v4` (temurin 21), `npm ci`, **build functions first**, then
  `npm run e2e` and `npm run test:rules` (using the entrypoint decided in task 1). Optionally cache
  `~/.cache/firebase/emulators`.

## P1 — strict i18n + docs

### 4. GREEN — strict i18n on UI PRs
- [x] Add an `i18n:check:strict` step, gated (via a changed-files filter on `**/i18n.ts` /
  `**/components/**`) so only UI-touching PRs must be hardcoded-string-clean, matching the repo rule.

### 5. GREEN — document required checks
- [x] Add `.github/CONTRIBUTING.md` (or a workflows README) listing which checks to mark **required**
  in branch protection so `main` cannot merge with a red gate.

## Verify the pipeline actually blocks

### 6. PROVE — red gate blocks, green passes
- [ ] Open the change PR; confirm both `fast` and `emulator` jobs run and pass. Then, on a scratch
  branch, push a trivial type error and confirm the `fast` job **fails** (the gate truly blocks);
  revert. Record the run links.
  STATUS: deferred — requires opening a real PR / triggering GitHub Actions (not possible locally).

## Gate — all green before done

### 7. Local gate set still green (additive)
- [ ] Confirm `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` ·
  `npm run play:build` · `npm run e2e` · `npm run i18n:check` are all green locally (CI changes are
  additive and must not perturb them), and that the CI run mirrors them.
  STATUS: not run here — CI files are purely additive (no app source / package.json touched), so
  local gates are unperturbed; left for the local gate run before merge.

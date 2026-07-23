## Why

`npm run verify:emulator` is unrunnable on this machine whenever a playtest is up.

`npm run playtest:forever` boots a long-lived stack that owns the whole default emulator block
(Firestore 8080 · Auth 9099 · Functions 5001 · UI 4000 · Storage 9199, plus hub 4400 / logging 4500)
and the two dev servers on 5180/5181. Every emulator-bound gate hardcodes those exact ports:

- `scripts/emulator-exec.mjs` launches `firebase emulators:exec` against `firebase.json`, whose
  `emulators` block is the default one.
- `scripts/e2e-verify.mjs:68-69`, `:93-96`, `:961` hardcode `127.0.0.1:9099 / :8080 / :5001 / :9199`.
- `scripts/test-rules.mjs:58,63`, `scripts/test-storage-rules.mjs:65`,
  `scripts/simulate-run.mjs:61-63`, `scripts/simulate-adversarial.mjs:58-60`,
  `scripts/simulate-browser-run.mjs:65-67` and `scripts/lib/firestore-admin.mjs:7-8` do the same.

So the only way to run the gate today is to kill the playtest, which may be serving a live event.
The gate is therefore skipped, and unverified code accumulates. That is a durability gap in the
tooling, not in the product. `scripts/test-storage-rules.mjs` carries a comment admitting it was
**written but never executed** for exactly this reason.

## What Changes

**One env var moves the entire emulator block to a second, non-overlapping port range.**

- New pure module `scripts/lib/emulatorPorts.mjs` — the single source of truth. Zero I/O (no `fs`,
  no `child_process`, no `process.env` read of its own): the environment is passed in, exactly like
  `scripts/lib/tunnelRestart.mjs` and `scripts/lib/emulatorReap.mjs`.
  - `resolveEmulatorPortOffset(env)` → `{ requested, offset, notice }`, total and never throwing.
  - `resolveEmulatorPorts(env)` → `{ ui, hub, logging, functions, hosting, firestore,
    firestoreWebsocket, auth, storage }`, all finite integers inside 1024..65535.
  - `resolveEmulatorHostEnv(env)` → the `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` /
    `FIREBASE_STORAGE_EMULATOR_HOST` triple.
  - `buildOffsetFirebaseConfig(baseConfig, ports)` → a firebase.json-shaped object with the shifted
    `emulators` block, used to generate the temporary config the CLI is pointed at.
- **`RUSHPOINT_EMULATOR_PORT_OFFSET` unset, empty, `0`, or garbage ⇒ today's exact ports.** The
  default path is byte-for-byte unchanged: `scripts/emulator-exec.mjs` does not even pass a
  `--config` flag at offset 0, so CI and anyone not opting in run the identical command line.
- A requested offset is **snapped up to a multiple of 1000** (minimum 1000, maximum 56000). This is
  not cosmetic: no pairwise difference between two default emulator ports is a multiple of 1000, so
  a multiple-of-1000 offset provably cannot land any shifted port on top of a live default-block
  port. A naive offset of `1019` would put the shifted Firestore emulator on `9099` — the live
  stack's Auth port.
- `scripts/emulator-exec.mjs` generates `firebase.emulator-offset.json` **at the repo root** and
  passes `--config`. Root placement is mandatory, not stylistic: firebase-tools derives the project
  root from `dirname(configPath)` (`lib/detectProjectRoot.js`), so a config under `.firebase/` would
  break every relative path in it (`functions` source, `firestore.rules`, `storage.rules`). This
  mirrors the existing generated `firebase.tunnel.json` (already gitignored).
- Every emulator-bound gate script routes its ports through the resolver instead of a literal.
- The orphan reaper is **not** touched: `scripts/lib/emulatorReap.mjs` decides purely on process
  lineage plus recorded exec sessions and never reads a port number (ports appear only in comments
  and in a fixture field the planner ignores). It keeps failing closed for an offset run exactly as
  it does today.
- **Out of scope by design:** `npm run dev:all`, `npm run playtest*` and `scripts/free-ports.mjs`
  keep the default block unconditionally. The offset is for the *gate* lane only; a second live
  stack is not what this solves.

## Impact

- Affected specs: `emulator-port-offset` (new)
- Affected code: `scripts/lib/emulatorPorts.mjs` (new), `scripts/test-emulator-ports.ts` (new),
  `scripts/emulator-exec.mjs`, `scripts/e2e-verify.mjs`, `scripts/test-rules.mjs`,
  `scripts/test-storage-rules.mjs`, `scripts/simulate-run.mjs`, `scripts/simulate-adversarial.mjs`,
  `scripts/simulate-browser-run.mjs`, `scripts/lib/firestore-admin.mjs`, `.gitignore`, `CLAUDE.md`
- **Not** affected (deliberately): `scripts/lib/emulatorReap.mjs`, `scripts/lib/reapEmulatorExec.mjs`,
  `scripts/free-ports.mjs`, `scripts/dev-emulator.mjs`, `scripts/playtest-forever.mjs`,
  `firebase.json`, `packages/shared/src/playtest.ts` (`EMULATOR_PORTS` there is the tunnel proxy's
  routing table for the live playtest stack, which stays on the default block).
- **Deliberately still on the default block** (they exist to drive or observe the LIVE dev/playtest
  stack, so following an offset would be a bug, not a feature): `scripts/proxy.mjs`,
  `scripts/print-playtest-links.mjs`, `scripts/emulator-backup.mjs`, `scripts/free-ports.mjs`,
  `scripts/dev-emulator.mjs`, `scripts/mirror.mjs`, `scripts/seed-local.mjs`,
  `scripts/seed-emulator.ts`, `scripts/reset-teams.mjs`, `scripts/seed-games-youth.mjs`,
  `scripts/gen-play-screenshots.mjs`, `scripts/qa-game.mjs`, `scripts/sansana-game.mjs`,
  `scripts/export-emails.mjs`, `scripts/backfill-active-task.mjs`,
  `scripts/backfill-public-tasks.mjs`, `scripts/simulate-tournament.mjs` (archived v1),
  `scripts/verify-skip.mjs`, `scripts/test-atomic-release.mjs` (unwired in CI).
- `scripts/simulate-browser-run.mjs` routes its Node half through the resolver but **refuses to
  start** under a non-zero offset: the browser half drives the real play-web dev server, whose
  Firebase client pins the default ports in product code, so an offset run would have the browser
  writing games and runs into the live playtest stack. Failing closed beats corrupting it.
- No product code changes. No callable, rule, type or UI is touched.

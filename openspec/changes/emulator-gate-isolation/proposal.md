## Why

`emulator-port-offset` moved the gate's emulator block to a non-overlapping port range so
`npm run verify:emulator` can run beside a live `playtest:forever` stack. Ports no longer collide —
but an offset gate run is still being **killed from outside**, mid-suite:

- `npm run e2e` under offset 1000 died with `Firestore Emulator has exited with code: 1` while
  `firestore-debug.log` contained **no** SEVERE / Exception / error line. The JVM did not crash; it
  was terminated. (On Windows, `taskkill /F` terminates with exit code 1.)
- The CLI printed `It seems that you are running multiple instances of the emulator suite for
  project rushpoint-pwa-7daaa. This may result in unexpected behavior.`
- Two separate offset runs died at different points.

Two independent defects explain this, and both are structural — the port offset cannot be relied on
until they are fixed.

**1. The two suites share one global, project-id-keyed rendezvous file.**
In the pinned `firebase-tools@15.18.0`, `lib/emulator/hub.js:24-32` puts the Emulator Hub *locator*
at `os.tmpdir()/hub-<projectId>.json` — keyed by **project id and nothing else**. Neither the port
block, the config file, nor the working directory take part in the name, so the offset gate and the
playtest are the same "instance" as far as the CLI is concerned. `lib/emulator/hub.js:157-166`
writes it on hub start, and `lib/emulator/hubClient.js:10` + `lib/emulator/controller.js:730-745`
are how **`firebase emulators:export` chooses which suite to talk to**: it reads that file and posts
`/_admin/export` to whatever origin it names. `emulators:export` has *no* host or port flag — the
locator is the only routing mechanism there is.

The playtest runs `emulators:export` twice over: `scripts/emulator-backup.mjs:246` every 120 s and
`scripts/playtest-forever.mjs:262` before every teardown. Whenever the locator names the gate's hub,
those exports are aimed at the **gate's** Firestore — the exact "`firebase emulators:export` at the
one live emulator wedges it" failure `scripts/free-ports.mjs:26-29` already documents. The locator
comes to name the gate whenever the gate's hub starts while the file is absent or names a dead pid
(the playtest hub deletes it on clean exit, `hub.js:167-176`), i.e. during any playtest restart —
and `hub.js:158-162` then makes it *sticky*: the returning playtest sees a live pid, prints the
"multiple instances" warning and **declines to reclaim the file**. Note also that the two suites do
not even run the same CLI: the live locator on this machine reads `"version":"15.23.0"` (the PATH
`firebase` used by `scripts/dev-emulator.mjs:138`) while the gate pins 15.18.0
(`scripts/emulator-exec.mjs:75`). Only the project id joins them.

**2. `scripts/free-ports.mjs` kills emulators by command-line pattern, with no port or session
awareness.** `killStaleHelpersWindows()` (`scripts/free-ports.mjs:54-82`) `taskkill /F /T`s every
process whose command line contains `.cache\firebase\emulators`, `emulators:exec`,
`functionsEmulatorRuntime` or `scripts/emulator-exec.mjs`. An offset gate run matches all four. So
any playtest restart — and `scripts/playtest-forever.mjs:455` runs `free-ports` at the top of every
supervisor loop iteration — destroys an in-flight gate no matter which ports it is on. That makes
the port-offset feature unreliable by construction, independently of defect 1.

## What Changes

**A. The offset gate gets its own hub locator, by relocating only its temp directory.**

- New pure module `scripts/lib/emulatorIsolation.mjs` (imports nothing, like
  `scripts/lib/emulatorPorts.mjs` and `scripts/lib/emulatorReap.mjs`):
  - `hubLocatorFileName(projectId)` — pins the firebase-tools contract (`hub-<projectId>.json`,
    `hub-demo-no-project.json` when the project is missing) as a literal the tests assert, so a CLI
    upgrade that changes it fails a unit gate instead of a 2am playtest.
  - `planEmulatorIsolation({ offset, repoRoot, env })` → `{ isolated, tmpDir, envOverrides, reason }`.
- `scripts/emulator-exec.mjs`, **when and only when the effective offset is non-zero**, creates
  `<repo>/.firebase/emulator-offset-tmp/offset-<n>` and passes `TEMP` / `TMP` / `TMPDIR` pointing at
  it to the spawned CLI. `os.tmpdir()` (and Windows `GetTempPath`, which is what the emulator JVMs
  read) resolve from those variables, so the gate's hub writes
  `…/offset-1000/hub-rushpoint-pwa-7daaa.json` and the playtest's `emulators:export` — which reads
  the *user* temp dir — can no longer resolve to it. Neither suite can see or overwrite the other's
  locator. Rollback is one variable: `RUSHPOINT_EMULATOR_ISOLATE_DISABLE=1`.
- Chosen over giving the offset run its own project id: the project id is woven through seed data,
  `accessCodes`, service-account resolution and every gate script, and a second id would have to be
  threaded through all of them. Relocating one environment variable achieves the same isolation with
  no second identity in the codebase.

**B. `scripts/free-ports.mjs` becomes session- and port-aware.**

- New pure module `scripts/lib/staleHelperSweep.mjs` — same pure-decision / impure-shell split the
  repo already uses for `emulatorReap.mjs` + `reapEmulatorExec.mjs`.
  `planStaleHelperSweep({ processes, patterns, sessions, sweptPorts, selfPid, protectedPids })`
  returns a **total** `{ kill, keep }` verdict for every input process.
- A pattern match is now necessary but not sufficient. A matching process is KEPT when it is the
  sweeper itself or one of its ancestors, when its lineage reaches a **still-running**
  `emulators:exec` session recorded in `.firebase/emulator-exec-sessions.json`, when its command
  line carries an offset marker (`firebase.emulator-offset.json` /
  `RUSHPOINT_EMULATOR_PORT_OFFSET`), or when it is an emulator bound to a `--port` that is **not**
  in the block being swept.
- **Today's behaviour is preserved exactly where it matters:** the playtest's own default-block
  emulators carry `--port 8080` / `--port 9099`, have no offset marker and belong to no running exec
  session, so they are still killed. Only a *different, live* port block is spared.

**C. No product code changes.** No callable, rule, type, UI string or scoring path is touched.

## Impact

- Affected specs: `emulator-gate-isolation` (new)
- Affected code: `scripts/lib/emulatorIsolation.mjs` (new),
  `scripts/lib/staleHelperSweep.mjs` (new), `scripts/test-emulator-gate-isolation.ts` (new),
  `scripts/emulator-exec.mjs`, `scripts/free-ports.mjs`, `CLAUDE.md`
- **Not** affected (deliberately): `scripts/lib/emulatorPorts.mjs`, `scripts/lib/emulatorReap.mjs`,
  `scripts/lib/reapEmulatorExec.mjs`, `scripts/dev-emulator.mjs`, `scripts/playtest-forever.mjs`,
  `scripts/emulator-backup.mjs`, `firebase.json`, `.firebaserc`. The playtest keeps the default port
  block, the default temp dir and the shared locator — it is the incumbent, and the *gate* is what
  moves out of its way.
- `.gitignore` needs no entry: the new temp directory lives under `.firebase/`, already ignored.
- At offset 0 `scripts/emulator-exec.mjs` still generates no config, passes no `--config` and now
  also overrides no environment variable — the spawned command line and the child environment are
  character-identical to today's.

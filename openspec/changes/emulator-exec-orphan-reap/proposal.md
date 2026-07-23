## Why

An emulator gate that has **finished** can still block the next one. `firebase emulators:exec`
(wrapped by `scripts/emulator-exec.mjs`, used by `npm run e2e`, `npm run test:rules` and every phase
of `npm run verify:emulator`) leaves processes alive after the command it wrapped has exited — the
firebase-tools parent, the emulator JVMs, the functions-runtime workers. A leftover holds 8080 /
9099 / 5001 / 4000, and the **next** run dies on "port taken" or hangs waiting for a hub that belongs
to a dead run. Observed on this machine: a rules run was blocked for roughly an hour by exactly this.

The repo already knows this failure class. `scripts/free-ports.mjs` was extended to kill orphaned
playtest **backup loops** by command line (`STALE_CMDLINE_PATTERNS`), and that list already carries
`emulators:exec`, `functionsEmulatorRuntime` and `.cache/firebase/emulators`. Two things are still
missing, and they are what this change is about:

1. **The matching is a blunt substring sweep with no ownership test.** Any process whose command line
   contains one of those strings is killed, regardless of which repository, which checkout, or which
   *kind* of emulator session it belongs to. A live `emulators:start` dev stack serving from this
   very tree matches `.cache\firebase\emulators` just as well as a dead exec's JVM does. Today the
   only reason that is survivable is that `free-ports.mjs` runs exclusively as `predev:all` /
   `preplaytest`, i.e. at a moment when killing the live stack is the point. The moment the same
   reaping is wanted at any *other* moment — which is precisely what an end-of-run reap is — blunt
   substring matching stops being acceptable.
2. **Nothing reaps at the END of an exec run.** Cleanup happens only on the next `dev:all` /
   `playtest` launch. A gate that finishes at 02:00 leaves its debris until someone starts a dev
   stack, so the run that is actually blocked is the *next gate*, which never calls `free-ports`.

## What Changes

**An orphaned emulator process left by a finished `emulators:exec` run is reaped, and nothing else
ever is.**

- **Reaping becomes a decision, not a substring match.** Which processes are orphans is decided by a
  pure, testable function over a snapshot of the process table (`pid`, `ppid`, command line, start
  time, held ports) plus a record of this repo's exec sessions. Enumerating processes and killing
  them stays a thin shell around that decision.
- **The decision fails closed.** A process is reaped only when it is *positively identified* as an
  emulator process belonging to a **finished `emulators:exec` session of this repository**. Anything
  that cannot be positively attributed — an unrelated `java`, an IDE, another checkout's emulator, a
  process whose lineage cannot be established — is kept. "Unknown" always means keep.
- **A live emulator session is structurally protected, not accidentally spared.** Lineage that leads
  to an `emulators:start` / dev-stack root is an explicit *keep* verdict, so the currently-serving
  dev/playtest stack can never be selected — even though it is the same firebase-tools, the same JVMs
  and the same jar path as the orphans being reaped.
- **An exec run cleans up after itself.** The exec wrapper records its session while it runs and
  reaps that session's leftovers when the wrapped command exits (success, failure, or signal), so a
  finished run cannot block the next one. Cleanup no longer depends on someone later starting a dev
  stack.
- **`free-ports.mjs` gets the same guarded reap** in addition to its existing sweep, so debris left
  by a run that died without unwinding (a killed terminal, a crash) is still collected on the next
  launch.

### Non-goals

- **No product behavior changes.** No callables, no Firestore rules, no `packages/shared` types, no
  creator-web, no play-web, no UI, no i18n.
- **Does not change the port sweep.** `free-ports.mjs`'s existing netstat/lsof port-based kill and
  its `STALE_CMDLINE_PATTERNS` list keep working exactly as they do; the guarded reap is added
  alongside them, not in place of them.
- **Does not make `emulators:exec` itself more reliable** (no CLI version change, no JVM tuning) —
  it only cleans up after it.
- **Not a general process manager.** It reaps emulator processes of *this* repository's exec
  sessions and nothing else. It is not a "kill all java" tool, and deliberately cannot become one.
- **Does not run against real processes in this task.** A live playtest stack is serving from this
  working tree; the reaper's runtime behavior is verified only through pure-logic tests over
  synthetic process tables, and that limitation is recorded rather than glossed over.

## Capabilities

### New Capabilities

- `emulator-exec-orphan-reap`: Emulator processes left behind by a finished `firebase
  emulators:exec` run are identified and terminated, so a completed gate cannot hold the emulator
  ports and block the next one. Selection is a pure decision that fails closed: only processes
  positively attributed to a finished exec session of this repository are eligible, and a live
  emulator session, another repository's session, or any unidentifiable process is never selected.

## Impact

- **Surfaces touched:** `scripts/` only — dev/ops infrastructure. **No** shared types, **no**
  callables, **no** Firestore rules, **no** creator-web/play-web, **no** i18n.
- **Files:** `scripts/lib/emulatorReap.mjs` (new — the pure decision function, zero imports),
  `scripts/lib/reapEmulatorExec.mjs` (new — the thin impure shell: enumerate, decide, kill, plus the
  session-record read/write), `scripts/emulator-exec.mjs` (record the session; reap on exit),
  `scripts/free-ports.mjs` (call the guarded reap alongside the existing sweep), and a new
  `scripts/test-emulator-reap.ts` picked up by the `npm test` aggregator.
- **New state on disk:** `.firebase/emulator-exec-sessions.json` — a small, additive, gitignored
  record of exec sessions (root pid, start, end). Safe to delete; its absence only makes the reaper
  *more* conservative.
- **New env vars (all optional, defaulted):** `RUSHPOINT_REAP_DISABLE` (skip the reap entirely),
  `RUSHPOINT_REAP_MIN_AGE_MS` (ignore very young processes), `RUSHPOINT_REAP_DEBUG` (print the full
  keep/reap verdict table without killing anything).
- **Risk:** this code kills processes. Mitigated by making the selection pure, total and
  keep-biased; by requiring positive attribution to a *finished exec session of this repo* rather
  than mere pattern presence; and by tests that assert, as hard invariants on **every** case, that
  an unrelated java process, an IDE, another repo's emulator, the reaper's own process tree and the
  currently-live dev stack are never selected.
- **Testing:** pure-logic lane only (`scripts/test-emulator-reap.ts`, no emulator, synthetic process
  tables only — no real process is ever enumerated or signalled by the tests). Runtime behavior
  against real emulator processes is **not** verified here, because a live playtest stack is serving
  from this tree and no emulator may be started, stopped or killed.

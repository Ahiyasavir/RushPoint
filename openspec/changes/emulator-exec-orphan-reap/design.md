## Context

`scripts/emulator-exec.mjs` is the single wrapper every emulator-bound gate goes through. It pins
firebase-tools, forces Java ≥ 21 and a 4 GB JVM cap, then `spawn`s, with `shell: true`:

```
npx --yes firebase-tools@15.18.0 emulators:exec --only <...> --project rushpoint-pwa-7daaa "<script>"
```

`package.json` calls it once per heavy phase of `verify:emulator` (`e2e-verify`, `test-rules`,
`simulate-run`, `simulate-adversarial`) and once for `verify:browser`. `npm run e2e` and
`npm run test:rules` run their scripts directly against an already-running emulator, so the debris
that blocks *them* is debris left by an earlier exec phase.

The tree that an exec run creates is deep: the shell → `npx` → the firebase-tools CLI → the emulator
JVMs (jars under `~/.cache/firebase/emulators`, **outside** the repo) → `functionsEmulatorRuntime`
workers. When the CLI is killed or exits badly, arbitrary members of that tree survive. Two facts
matter for the design:

- **The JVMs carry no repository identity in their command line.** Their jar path is user-global.
  Attribution therefore cannot come from the command-line text alone; it has to come from *lineage*.
- **On Windows a process is not reparented when its parent dies.** The orphan's `ppid` still holds
  the (now absent) parent's pid. That absent-parent pid is exactly the signal "my session is over",
  and it is readable from a plain process snapshot.

What already exists and must not regress: `scripts/free-ports.mjs` sweeps a fixed port list
(netstat/`taskkill` on Windows, `lsof`/`kill` on POSIX) and kills stale helpers by
`STALE_CMDLINE_PATTERNS` substring, including `emulators:exec`, `functionsEmulatorRuntime`,
`.cache/firebase/emulators` and `scripts/emulator-exec.mjs`. That sweep runs only as `predev:all` /
`preplaytest`, where killing everything emulator-shaped is intended. This change does not touch it.

**Verified read-only observation on this machine** (enumeration + the pure plan only — nothing was
signalled): of 390 live processes, exactly one is the running Firestore emulator JVM
(`java.exe … -jar C:\Users\savir\.cache\firebase\emulators\cloud-firestore-emulator-*.jar`), and
**its parent process is already gone** — its `ppid` names a pid absent from the snapshot. In other
words the currently-serving emulator is, structurally, indistinguishable from the orphans this change
reaps: same binary, same jar, same missing parent. The *only* thing that separates them is whether
that absent parent pid is a recorded exec-session root of this repo. That is the strongest available
argument for D3/D6 (attribution by recorded session, never by pattern) and against ever widening the
match. With no sessions recorded yet, the plan's verdict for the whole machine was `WOULD REAP: 0`.

Hard constraint: **a live playtest stack is serving from this tree** (Vite on 5180/5181, Firestore
on 8080). No emulator, Vite, tunnel or backup process may be started, stopped or killed, and none of
`npm run e2e`, `verify:emulator`, `test:rules`, `dev:all`, `playtest` may be run. Every verification
here is pure-logic over synthetic fixtures; the reaper is never pointed at the real process table.

## Goals / Non-Goals

**Goals:**
- A finished `emulators:exec` run cannot leave a process that blocks the next run.
- The choice of what to kill is a **pure total function** of (process snapshot, session records,
  repo root, protected pids) so it can be tested adversarially without touching a real process.
- Fail closed: no positive attribution to a finished exec session of *this* repo ⇒ never selected.
- The currently-live dev/playtest stack is protected by a **structural rule**, not by luck.
- Cleanup also happens on the next launch (`free-ports.mjs`), for runs that died without unwinding.

**Non-Goals:**
- No product code, callables, rules, UI or i18n.
- No change to the existing port sweep or `STALE_CMDLINE_PATTERNS`.
- No change to firebase-tools version, JVM options, or how exec runs are launched.
- No cross-repository or system-wide process management.
- No runtime verification in this task (see Test Strategy / Risks).

## Decisions

### D1 — A pure decision function, an impure shell that can only enumerate and kill

`scripts/lib/emulatorReap.mjs` exports

```js
planEmulatorExecReap({ processes, repoRoot, selfPid, protectedPids, sessions, nowMs, minAgeMs })
  → { reap: [{ pid, reason, commandLine }], keep: [{ pid, reason }] }
```

where each entry of `processes` is `{ pid, ppid, commandLine, startedAt, ports }` and each entry of
`sessions` is `{ rootPid, startedAt, endedAt }` (`endedAt: null` ⇒ still running). The module
imports **nothing** — no `child_process`, no `fs`, no `Date.now()` — mirroring
`scripts/lib/emulatorBackup.mjs`, whose purity is what makes its retention rules testable.

`scripts/lib/reapEmulatorExec.mjs` is the shell: enumerate the process table (PowerShell
`Get-CimInstance Win32_Process` for `ProcessId`/`ParentProcessId`/`CommandLine`/`CreationDate` on
Windows; `ps -eo pid,ppid,lstart,args` on POSIX), read the session file, call the pure function, and
kill only what comes back in `reap`. It contains no selection logic whatsoever — every `if` about
*whether* to kill lives in the pure module.

*Why this split is non-negotiable here:* the only way to test kill logic in a working tree that must
not lose a process is to make the logic answerable without processes. Every case below is a literal
array of objects.

### D2 — Every verdict is explicit; the function is total and returns `keep` as well as `reap`

`keep ∪ reap` is exactly the input and `keep ∩ reap` is empty, and each verdict carries a `reason`
string. A process that falls through every rule is *kept* with `reason: 'unattributed'`, never
silently dropped.

*Why return the keeps at all:* a kill list alone cannot be audited. With explicit keeps, the tests
assert the *reason* the live stack survived — `live-emulator-session`, not "it happened not to
match" — and `RUSHPOINT_REAP_DEBUG` can print the whole verdict table. A rule that spares the right
process for the wrong reason is one refactor away from a disaster.

### D3 — Attribution is by lineage to a **`emulators:exec` root of this repo**, never by pattern alone

Three roles are classified from the command line:

- **exec root** — mentions `emulators:exec` or `scripts/emulator-exec.mjs`, *and* is attributable to
  this repo (its command line contains the repo root path, in either slash flavour, compared
  case-insensitively — or its pid appears in the session file this repo wrote).
- **live root** — mentions `emulators:start`, `dev-emulator.mjs`, `playtest`, or `firebase.json`-
  driven dev launches. A live root and everything under it is **kept, unconditionally**.
- **emulator-ish** — mentions `.cache/firebase/emulators`, `functionsEmulatorRuntime`,
  `firebase-tools`, `cloud-firestore-emulator`, `firebase-database-emulator`, `emulator-ui`. This is
  a *necessary* condition for reaping, never a sufficient one.

A process is eligible only if it is emulator-ish (or is itself an exec root) **and** its lineage
resolves to an exec root of this repo. Lineage resolves in two ways:

1. **In-snapshot ancestry** — walk `ppid` upward through the snapshot (depth-capped, cycle-guarded).
2. **Session-record ancestry** — the walk ends at a pid that is *absent* from the snapshot (its
   parent died) but equals a recorded session's `rootPid`, and the process's `startedAt` falls inside
   that session's window. This is the case that matters: it is precisely the orphan.

*Why not simply "kill anything matching `emulators:exec`", like the existing sweep:* because the
existing sweep is only ever fired at a moment when the live stack is meant to die too. An end-of-run
reap fires while a dev stack may be serving, and the live stack's JVMs are *identical in every
command-line respect* to the orphans. Lineage is the only signal that separates them.

*Why not attribute by cwd:* a process's working directory is not in a plain `ps`/CIM snapshot on
either platform without extra per-pid probing, and a JVM's cwd is not reliably the repo anyway.

### D4 — Pid reuse is defended by the session time window, and ambiguity resolves to keep

A recorded `rootPid` can be reused by an unrelated process after the session ends. A candidate is
therefore accepted through rule 2 of D3 only when `startedAt ∈ [session.startedAt, session.endedAt +
grace]` — it must have been born *during* the session it claims. A process with an unknown or
non-finite `startedAt` fails this test and is kept.

Every other ambiguity resolves the same way: unparseable command line → keep; missing `ppid` → keep;
lineage that leaves the snapshot without matching a session → keep; a session that is still running
(`endedAt: null`) whose root is still present → keep everything under it. Killing one process too
few costs a port conflict a human can see and fix; killing one too many can destroy a live run.

### D5 — A live session is protected by a rule that runs *before* eligibility, not after

The live-root check is evaluated on the whole lineage and short-circuits to `keep` with
`reason: 'live-emulator-session'`. It cannot be reached by an exec-root rule that happens to match
later, and it does not depend on the caller remembering to pass the live stack's pids.

Additionally the caller may pass `protectedPids` (at minimum the reaper's own pid and its ancestors,
which the shell always supplies); those pids and their descendants are kept with `reason: 'self'` /
`'protected'`. `selfPid` protection is applied first of all, because the reap runs *inside* the exec
wrapper's own process tree at exit — without it, the reaper would be a plausible member of its own
kill list.

*Why belt and braces:* D5's two mechanisms are independent. Lineage protection needs the live stack
to be visible in the snapshot; `protectedPids` needs the caller to know the pids. Either alone would
be a single point of failure for the worst possible outcome.

### D6 — The session record is a small, additive, self-healing JSON file

`.firebase/emulator-exec-sessions.json` holds `{ sessions: [{ rootPid, startedAt, endedAt, cmd }] }`,
capped to the most recent 20 entries. The wrapper appends a record when it spawns and stamps
`endedAt` when the child exits; `free-ports.mjs` reads it. A missing, empty, truncated or unparseable
file is treated as "no sessions" — which only removes the D3-rule-2 attribution path and makes the
reaper *more* conservative. The file is inside the already-gitignored `.firebase/` directory and is
safe to delete at any time.

*Why a file rather than an env var handed down the tree:* the orphan case is exactly the case where
the parent is gone, so the knowledge has to outlive the process that had it. Environment variables
are also not readable from a plain process snapshot on Windows.

### D7 — Reap at exec exit, and again on the next launch

`emulator-exec.mjs` runs the reap in its `child.on('exit')` handler — after stamping `endedAt`, and
before propagating the exit code — so the run that created the debris is the run that clears it,
whatever the wrapped command's outcome. `free-ports.mjs` additionally calls the guarded reap next to
its existing sweep, covering the case the exit handler never ran (killed terminal, machine crash).

The reap is best-effort and never changes an exit code: a failure inside it is caught, warned about,
and swallowed. A cleanup step that can fail a green gate would get disabled within a week.

`RUSHPOINT_REAP_DISABLE=1` skips it; `RUSHPOINT_REAP_DEBUG=1` prints the verdict table and kills
nothing (the escape hatch for the first real-world observation, which this task cannot perform).

### D8 — `minAgeMs`: young processes are never reaped

A default `RUSHPOINT_REAP_MIN_AGE_MS` of 5000 ms means a process that started moments ago is kept
regardless of everything else. This makes an interleaved start (a fresh exec run beginning while a
previous one unwinds) safe by construction, and costs nothing: a genuine orphan is, by definition,
still there a few seconds later, and `free-ports.mjs` will catch it on the next launch anyway.

## Test Strategy

**Lane:** pure logic only — a new `scripts/test-emulator-reap.ts`, auto-discovered by
`scripts/run-unit-tests.mjs` (`npm test`) and written in the house style of
`scripts/test-emulator-backup.ts`: `ok(cond, msg)`, `passed`/`failed` counters, a final summary line
and `process.exit(failed === 0 ? 0 : 1)`. **No emulator. No filesystem. No process enumeration. No
signals.** Every case is a synthetic array of `{ pid, ppid, commandLine, startedAt, ports }`, with
command lines transcribed from what this repo actually spawns.

RED first: the test is written and run against the un-extended `scripts/lib/`, where
`planEmulatorExecReap` does not exist — confirming failure for the right reason before any
implementation.

**Safety invariants asserted on EVERY case** (a shared helper, so no case can forget them):
- `keep ∪ reap === input` and `keep ∩ reap === ∅` (total, non-overlapping);
- the reaper's own pid and its ancestors are never in `reap`;
- no process whose lineage contains a live root is ever in `reap`;
- every reaped entry carries a non-empty `reason`.

**Never-reaped cases** (the fail-closed contract — each asserted with its explicit keep reason):
- a plain `java -jar something-else.jar` with no emulator signature;
- the user's IDE (`Code.exe`, `idea64.exe`) and a `node` language server;
- **another repository's** emulator: identical firebase-tools/JVM command lines, exec root path under
  a different repo root;
- **the currently-live dev stack**: `dev-emulator.mjs` → firebase-tools `emulators:start` → a
  `.cache/firebase/emulators` JVM → `functionsEmulatorRuntime` workers, holding 8080/9099/5001/4000,
  asserted kept with `reason: 'live-emulator-session'` — and asserted again with the exact same tree
  present *alongside* a genuine orphan tree, proving the orphan is reaped and the live stack is not;
- an exec session that is still running (`endedAt: null`, root present);
- a process younger than `minAgeMs`;
- an emulator-ish process whose lineage leaves the snapshot and matches no session (`unattributed`);
- a process whose recorded session matches by pid but whose `startedAt` is **outside** the session
  window (pid reuse);
- a process with a missing/`NaN` `startedAt`, a missing `ppid`, or an empty command line;
- everything, when `processes` is empty / `sessions` is empty / arguments are undefined (no throw).

**Reaped cases:**
- the classic orphan: a `.cache/firebase/emulators` JVM plus two `functionsEmulatorRuntime` workers
  whose `ppid` is a **finished** session's absent `rootPid`, born inside the session window, holding
  8080/5001 — all three reaped;
- a surviving exec root itself (`emulators:exec` process still present, session marked ended);
- a deep chain (shell → npx → CLI → JVM → worker) where only the leaf survives in the snapshot;
- multiple finished sessions: only the members of the finished ones are reaped.

**Determinism/robustness:** shuffled input yields the same verdicts (compared as sets); a `ppid`
cycle and a self-parenting process terminate without hanging and are kept.

**Gates run:** `npm run typecheck`, `npm run lint`, `npm test`. `npm run e2e`, `npm run test:rules`,
`npm run verify:emulator` and every other emulator-touching gate are **NOT** run — they would start
or kill an emulator, which is forbidden while the live stack serves. No UI is touched, so
`npm run i18n:check` does not apply.

## Risks / Trade-offs

- **[This code kills processes — a wrong selection can destroy live work]** → selection is pure,
  total and keep-biased (D2/D4); eligibility requires positive lineage attribution to a finished exec
  session of this repo (D3); live sessions are protected by two independent mechanisms evaluated
  first (D5); and the never-reaped invariants are asserted on every single test case, not as a few
  standalone cases.
- **[The live emulator JVM looks exactly like an orphan]** → confirmed on this machine (see Context):
  its parent is already absent, so lineage-based live detection does **not** protect it — the session
  record does. This is why a missing/empty session record must mean "reap nothing" (D6) rather than
  "fall back to patterns", and why the recorded-root match is additionally gated on the candidate's
  birth falling inside that session's window (D4).
- **[Runtime behavior is unverified]** → no emulator may be started here, so the shell's kill path has
  never executed. Enumeration and the plan *have* been exercised read-only against the real process
  table (390 processes, `WOULD REAP: 0`), but no process was signalled. Mitigated by keeping the shell free of decisions, by
  `RUSHPOINT_REAP_DEBUG=1` (verdicts, no kills) as the intended first real-world exercise, and by
  `RUSHPOINT_REAP_DISABLE=1` as a one-variable rollback. Flagged explicitly in tasks and in the
  report rather than assumed.
- **[Pid reuse could point attribution at an innocent process]** → the session-window birth check
  (D4) plus `minAgeMs` (D8); an unknown start time fails closed.
- **[The process-table snapshot could be unavailable or malformed]** → the shell treats any
  enumeration failure as an empty snapshot, so the reap becomes a no-op instead of guessing.
- **[Reaping at exec exit could interfere with a concurrently starting run]** → `minAgeMs` (D8) plus
  the requirement that a session be *finished*; a still-running session's whole tree is kept.
- **[The reap could fail a passing gate]** → it is best-effort, wrapped in try/catch, and never
  alters the wrapped command's exit code (D7).
- **[Attribution depends on Windows not reparenting orphans]** → true for Windows, which is where the
  incident occurred and where the repo is developed; on POSIX an orphan reparents to pid 1, so the
  in-snapshot walk ends at a pid that is not a session root and the process is **kept**. That is the
  conservative direction, and `free-ports.mjs`'s existing pattern sweep still covers POSIX.

## Migration Plan

No data migration. The only new state is the additive `.firebase/emulator-exec-sessions.json`, which
is gitignored and safe to delete. Behavior takes effect on the next `emulators:exec` run and the next
`free-ports.mjs` invocation; nothing currently running is affected, because this change starts,
stops and kills nothing at install time. Rollback is `RUSHPOINT_REAP_DISABLE=1`, or reverting the two
new `scripts/lib/` files and the two call sites.

## Open Questions

- Should `free-ports.mjs`'s blunt `STALE_CMDLINE_PATTERNS` entries for the emulator (`emulators:exec`,
  `functionsEmulatorRuntime`, `.cache/firebase/emulators`) eventually be *replaced* by the guarded
  reap? They are correct for `predev:all`/`preplaytest`, where killing the live stack is intended, so
  they are kept for now; narrowing them is a separate change with its own risk.
- Should the reaper escalate (SIGTERM, wait, then SIGKILL) instead of terminating the tree outright?
  The current shell mirrors the existing `taskkill /F /T` behavior for consistency.
- Should `verify:emulator` fail loudly when a reap actually had to kill something, on the grounds
  that a leaking exec run is itself a defect worth surfacing? Today it is a warning line.

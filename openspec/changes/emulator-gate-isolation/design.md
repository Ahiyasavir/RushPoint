# Design — emulator-gate-isolation

## 1. The verification: what firebase-tools actually shares between two suites

Everything below is read from the pinned CLI on this machine,
`~/AppData/Local/npm-cache/_npx/d8c7a9f2cf6d12f5/node_modules/firebase-tools` (`package.json`
version `15.18.0` — the version `scripts/emulator-exec.mjs:75` pins).

### 1.1 The locator path is keyed by project id and nothing else

`lib/emulator/hub.js:24-32`

```js
static getLocatorFilePath(projectId) {
    const dir = os.tmpdir();
    if (!projectId) { projectId = EmulatorHub.MISSING_PROJECT_PLACEHOLDER; }
    const filename = `hub-${projectId}.json`;
    const locatorPath = path.join(dir, filename);
    return locatorPath;
}
```

`EmulatorHub.MISSING_PROJECT_PLACEHOLDER = "demo-no-project"` (`hub.js:184`). The port block, the
`--config` file and the working directory contribute **nothing** to the name. Two suites for the
same project id are one file, always.

A full grep of the CLI for `os.tmpdir()` finds exactly four uses
(`commands/crashlytics-symbols-upload.js:16`, `deploy/functions/runtimes/node/index.js:201`,
`emulator/functionsEmulatorShared.js:195`, `emulator/hub.js:26`); only the hub one is project-keyed
shared state. There is no other cross-suite rendezvous.

### 1.2 It is written on hub start, and is *sticky* once another live suite owns it

`lib/emulator/hub.js:157-176`

```js
async writeLocatorFile() {
    const projectId = this.args.projectId;
    const prevLocator = EmulatorHub.readLocatorFile(projectId);
    if (prevLocator && prevLocator.pid && isProcessLive(prevLocator.pid)) {
        utils.logLabeledWarning("emulators",
          `It seems that you are running multiple instances of the emulator suite for project ${projectId}. ...`);
        return;                                   // ← does NOT write, and registers NO cleanup
    }
    const locatorPath = EmulatorHub.getLocatorFilePath(projectId);
    fs.writeFileSync(locatorPath, JSON.stringify(this.buildLocator()));
    const cleanup = () => { ... fs.unlinkSync(locatorPath) ... };
    process.on("SIGINT", cleanup); process.on("SIGTERM", cleanup); process.on("exit", cleanup);
}
```

`buildLocator()` (`hub.js:145-155`) records `{ version, origins, pid }` — the origins being that
suite's **hub port**. So the file is a hard pointer to one specific port block.

This is the correction to the original hypothesis. The second suite to boot does **not** overwrite
the file; it warns and gives up. Ownership is therefore decided by whoever starts while the file is
absent or names a dead pid, and it never changes hands afterwards. That window opens on every
playtest restart, because the exiting hub deletes the file (`hub.js:169-172`) — and once the gate
owns it, the returning playtest is the one that prints the "multiple instances" warning and keeps
serving with the gate's pointer in place.

Observed live on this machine while writing this change:

```
C:\Users\ahiya\AppData\Local\Temp\hub-rushpoint-pwa-7daaa.json
{"version":"15.23.0","origins":["http://127.0.0.1:4400","http://[::1]:4400"],"pid":5644}
```

`15.23.0` is the PATH `firebase` that `scripts/dev-emulator.mjs:138` invokes — a *different* CLI
version from the gate's pinned 15.18.0. Even the version does not separate them.

### 1.3 `emulators:export` routes solely through that file

`lib/emulator/controller.js:730-745` (`exportEmulatorData`, the action behind
`lib/commands/emulators-export.js`)

```js
const hubClient = new EmulatorHubClient(projectId);          // hubClient.js:10 → readLocatorFile(projectId)
if (!hubClient.foundHub()) { throw new FirebaseError(`Did not find any running emulators ...`); }
origin = await hubClient.getStatus();                        // tries locator.origins in order
...
await hubClient.postExport({ path: exportAbsPath, initiatedBy, targets });   // POST <origin>/_admin/export
```

`lib/commands/emulators-export.js` registers only `--force` and `--only`. **There is no `--host` and
no `--port`.** So an export is aimed at whichever suite the locator names, full stop.

The playtest fires that command from two places, neither of which can be told which suite it means:

- `scripts/emulator-backup.mjs:246` — every `EMU_BACKUP_INTERVAL_MS` (default 120 s).
- `scripts/playtest-forever.mjs:262` — before every teardown.

Both of them *gate* on the hardcoded default hub `127.0.0.1:4400`
(`emulator-backup.mjs:68`, `playtest-forever.mjs:206`) and then export via the locator. The
readiness probe and the export target are resolved by two different mechanisms and can disagree
completely: "the playtest is up" is checked on 4400, and the export then lands on 5400.

### 1.4 What that does to the gate, and why the log was clean

A `/_admin/export` against a Firestore emulator takes its export lock and streams the whole dataset
out. The repo already knows this failure: `scripts/free-ports.mjs:26-29` documents accumulated
backup loops "all firing `firebase emulators:export` at the one live emulator" wedging it, and
`scripts/emulator-backup.mjs:70-76` documents that an ill-timed export "wedges Firestore and
cascade-kills the whole playtest stack". A wedged Firestore under an `emulators:exec` run then dies
by termination, not by exception — which is exactly the evidence: `Firestore Emulator has exited
with code: 1` with a `firestore-debug.log` containing no SEVERE line. On Windows a `taskkill /F`
(what `scripts/free-ports.mjs:70` and `scripts/lib/reapEmulatorExec.mjs:133` both issue) also
terminates with exit code 1.

### 1.5 What was NOT the cause

- **The reaper.** `planEmulatorExecReap` keeps anything whose lineage reaches a live root
  (`emulatorReap.mjs:276`) and anything not attributed to a *finished* session of this repo
  (`:279-282`). A running gate is attributed to a session with `endedAt == null`, which
  `isFinishedSession` (`:98-101`) rejects. It cannot select an in-flight gate.
- **Port collision.** `resolveEmulatorPorts` shifts all nine ports by a multiple of 1000 and
  `buildOffsetFirebaseConfig` pins hub and logging explicitly (`emulatorPorts.mjs:208-233`), so the
  gate binds nothing the playtest holds. A collision would also fail at boot, not mid-suite.

## 2. Fix A — one relocated temp directory

`os.tmpdir()` is the only input to `getLocatorFilePath` we can influence without changing the
project id. On Windows Node resolves it from `TEMP`, then `TMP`; on POSIX from `TMPDIR`, then `TMP`,
then `TEMP`. The emulator JVMs read `java.io.tmpdir`, which on Windows comes from `GetTempPath`
(`TMP`, then `TEMP`) and on POSIX from `TMPDIR`. Setting all three covers every consumer. Verified
empirically on this machine:

```
$ node -e "console.log(require('os').tmpdir())"
C:\Users\ahiya\AppData\Local\Temp
$ TEMP=<scratch> node -e "console.log(require('os').tmpdir())"
<scratch>
```

So `scripts/emulator-exec.mjs` sets `TEMP` / `TMP` / `TMPDIR` on the **child environment only**,
pointing at `<repo>/.firebase/emulator-offset-tmp/offset-<n>`:

- Per-offset, so two different offsets are also isolated from each other.
- Under `.firebase/`, which is already gitignored and is where this repo keeps emulator state.
- Created by the launcher; `GetTempPath` does not create directories.

Consequences, deliberate:

| | before | after |
|---|---|---|
| gate hub locator | `%TEMP%\hub-rushpoint-pwa-7daaa.json` (shared) | `…\offset-1000\hub-rushpoint-pwa-7daaa.json` |
| playtest `emulators:export` target | possibly the gate | can only ever be the playtest |
| playtest hub locator | possibly stolen by the gate | never touched by the gate |
| "multiple instances" warning | printed | gone — the CLIs no longer see each other |

If the gate owns the locator at the moment isolation lands, the playtest's next export fails loudly
with `Did not find any running emulators for project …` and the backup loop logs a failure
(`emulator-backup.mjs:391-394`) → health degrades → the banner fires. That is strictly better than
silently wedging the gate, and it self-heals on the playtest's next hub start.

### Why not a second project id

`rushpoint-pwa-7daaa` appears in `.firebaserc`, `scripts/emulator-exec.mjs:76`,
`scripts/emulator-backup.mjs:62`, `scripts/playtest-forever.mjs:262`, `scripts/dev-emulator.mjs`,
the seed scripts and every gate's admin-SDK bootstrap, and it is the id the emulator's own data
export is keyed by. Introducing a second identity would fork all of that and would silently give the
gate a *different dataset shape* than the one CI runs against. Relocating one environment variable
isolates the rendezvous without inventing a second identity.

### Why not "just don't run the backup loop during a gate"

That is an operator procedure, not a mechanism; it has to be remembered every time, and the
playtest's supervisor restarts the loop on its own. The whole point of `emulator-port-offset` was
that the gate must be runnable **without touching the live stack**.

## 3. Fix B — a session- and port-aware stale-helper sweep

`scripts/free-ports.mjs` exists to make a *relaunch* of the default stack possible, so it must keep
killing default-block debris. The only thing that changes is that a pattern match stops being
sufficient.

`planStaleHelperSweep` is pure (imports nothing) and total: `keep ∪ kill === input`,
`keep ∩ kill === ∅`, every process gets an explicit reason. Verdict order — every protection is
evaluated before the kill rule so none can be overridden:

| # | rule | verdict |
|---|---|---|
| 1 | the sweeper itself | keep `self` |
| 2 | an ancestor of the sweeper | keep `self-ancestor` |
| 3 | explicitly protected pid | keep `protected` |
| 4 | matches no stale pattern | keep `no-pattern-match` |
| 5 | lineage reaches a **running** exec session root, or is such a root, or is an ancestor of one | keep `live-exec-session` |
| 6 | command line carries an offset marker | keep `offset-port-block` |
| 7 | `--port <n>` with `n` outside the block being swept | keep `foreign-port-block` |
| 8 | otherwise | **kill** |

Notes on the shape of each protection:

- **Rule 5 walks the ancestry both ways.** Downward covers the emulator JVMs and
  `functionsEmulatorRuntime` workers (descendants of the `emulators:exec` root recorded by
  `recordExecSessionStart`, `emulator-exec.mjs:134`). Upward covers
  `node scripts/emulator-exec.mjs …`, which matches a stale pattern but is the session root's
  *parent*. The walk also attributes a process whose recorded root pid is **absent** from the
  snapshot, because on Windows an orphan keeps naming its dead parent — the same trick
  `resolveLineage` uses (`emulatorReap.mjs:150-158`).
- **Rule 5 uses `endedAt == null` as "running"**, the exact inverse of `isFinishedSession`
  (`emulatorReap.mjs:98-101`), so the two modules can never disagree about whether a session is
  live. A *finished* session's leftovers stay killable — that is the reaper's whole job and
  free-ports must keep doing it too.
- **An unfinished session record expires.** `endedAt` is stamped by `emulator-exec.mjs`'s exit
  handler, so a gate killed by a power cut, a closed terminal or a `SIGKILL` never stamps it and its
  record reads "running" forever. Left unbounded, rule 5 would make that run's debris *permanently*
  unkillable by `free-ports` — the exact wedge `free-ports` exists to clear. `isRunningSession`
  therefore takes an optional `nowMs` (supplied by the shell, never read by the module) and ignores
  an unfinished record older than `MAX_RUNNING_SESSION_AGE_MS` = 6 h: far longer than the whole
  `verify:emulator` gauntlet, far shorter than forever. A future-dated record and a record with no
  start time both stay live, so clock skew can never *unlock* a kill.
- **Rule 7 is the port awareness the mission asks for**, and it is the one signal that survives a
  missing session record: the Firestore emulator JVM is spawned with `--port <n>`, so a JVM on 9080
  is provably not part of a sweep of `{…, 8080, …}`. A JVM on `--port 8080` is *not* protected, so
  the playtest's own emulators die exactly as they do today.
- **Descendants of protected pids are deliberately NOT protected** (unlike
  `planEmulatorExecReap`'s `protectedClosure`). `free-ports` is spawned *by* the playtest supervisor
  (`playtest-forever.mjs:197`), so protecting the descendant closure of its ancestors would protect
  the entire playtest stack and make the sweep a no-op — the opposite of what it is for.

### Fail-closed, in the direction that matters here

"Fail closed" for `emulatorReap` means *do not kill when unsure*, because it runs unattended after
every gate. `free-ports` has the opposite default by design: it is an explicit, operator-initiated
"clear the decks for the default stack". Making unattributed processes survivable there would
silently break the playtest launcher. So the fail-closed direction added here is scoped precisely to
the new axis: **when a process shows any positive sign of belonging to a different, live port block,
do not kill it.** Everything else keeps today's verdict.

## 4. What only a live run can prove

- That an offset gate now survives a full `verify:emulator` beside the playtest.
- That the "multiple instances" warning no longer appears in the gate's output.
- That `%TEMP%\hub-rushpoint-pwa-7daaa.json` keeps naming the playtest's hub (port 4400) for the
  whole duration of a gate run, and that `.firebase/emulator-offset-tmp/offset-1000/` gains its own
  `hub-rushpoint-pwa-7daaa.json` while the gate is up.
- That `node scripts/emulator-backup.mjs --status` stays `healthy` across a gate run.

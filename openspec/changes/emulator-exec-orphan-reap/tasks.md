## 1. RED — failing tests first

- [x] 1.1 Create `scripts/test-emulator-reap.ts` in the house style of
      `scripts/test-emulator-backup.ts` (`ok(cond, msg)`, `passed`/`failed`, final summary,
      `process.exit`), importing `planEmulatorExecReap` from `./lib/emulatorReap.mjs`. Synthetic
      fixtures ONLY — the test MUST NOT enumerate, read or signal any real process, and MUST NOT
      touch the filesystem.
- [x] 1.2 Add a shared invariant helper asserting on EVERY case that `keep ∪ reap === input`,
      `keep ∩ reap === ∅`, every reaped entry has a non-empty `reason`, the reaper's own pid and its
      ancestors are never reaped, and no process whose lineage contains a live root is ever reaped.
- [x] 1.3 Encode the NEVER-REAPED cases: unrelated java; IDE / language server; another repository's
      emulator session; the currently-live dev stack (dev-emulator → `emulators:start` → JVM →
      `functionsEmulatorRuntime`, holding 8080/9099/5001/4000) both alone and alongside a genuine
      orphan tree; a still-running exec session; a process younger than `minAgeMs`; an emulator-ish
      process whose lineage leaves the snapshot with no matching session; pid reuse (session root
      matches but `startedAt` outside the window); missing/`NaN` `startedAt`; missing `ppid`; empty
      command line; and empty/undefined inputs.
- [x] 1.4 Encode the REAPED cases: the classic orphan (JVM + two `functionsEmulatorRuntime` workers
      whose `ppid` is a finished session's absent root, born in-window); a surviving `emulators:exec`
      root of a finished session; a deep chain where only the leaf survives; and multiple sessions
      where only the finished ones' members are reaped.
- [x] 1.5 Encode determinism/robustness: shuffled input yields the same verdicts as sets; a `ppid`
      cycle and a self-parenting process terminate and are kept.
- [x] 1.6 Run `npx tsx scripts/test-emulator-reap.ts` and confirm it FAILS for the right reason
      (`planEmulatorExecReap` does not exist yet). Record the failure verbatim.

## 2. GREEN — the pure decision

- [x] 2.1 Create `scripts/lib/emulatorReap.mjs` with ZERO imports (no `fs`, no `child_process`, no
      `Date.now()`), exporting `planEmulatorExecReap({ processes, repoRoot, selfPid, protectedPids,
      sessions, nowMs, minAgeMs })` → `{ reap, keep }`, plus the small classification helpers
      (`classifyProcessRole`, `resolveLineage`) it is built from.
- [x] 2.2 Implement classification: exec root / live root / emulator-ish, with case-insensitive,
      both-slash-flavour path matching against `repoRoot`.
- [x] 2.3 Implement lineage resolution: depth-capped, cycle-guarded `ppid` walk through the snapshot,
      falling back to session-record attribution when the walk ends at an absent pid that equals a
      recorded `rootPid` and the process was born inside that session's window.
- [x] 2.4 Implement the verdict ordering — self/protected → live lineage → not-emulator-ish →
      unattributed → running session → too young → reap — so live-session protection can never be
      overridden by a later match, and every fall-through is an explicit keep.
- [x] 2.5 Re-run `npx tsx scripts/test-emulator-reap.ts` and confirm GREEN.

## 3. GREEN — the impure shell

- [x] 3.1 Create `scripts/lib/reapEmulatorExec.mjs`: enumerate the process table (PowerShell
      `Get-CimInstance Win32_Process` → `ProcessId`/`ParentProcessId`/`CommandLine`/`CreationDate` on
      Windows; `ps -eo pid,ppid,lstart,args` on POSIX), treating ANY enumeration failure as an empty
      snapshot. No selection logic in this file.
- [x] 3.2 Add the session record helpers in the same shell:
      `recordExecSessionStart` / `recordExecSessionEnd` / `readExecSessions` over
      `.firebase/emulator-exec-sessions.json`, capped at the 20 most recent entries, treating a
      missing/empty/unparseable file as "no sessions".
- [x] 3.3 Add `reapOrphanEmulatorProcesses()`: build the snapshot, read the sessions, call
      `planEmulatorExecReap` with `selfPid` + ancestors as `protectedPids`, and terminate ONLY the
      returned reap set (`taskkill /PID <pid> /F /T` on Windows, `kill -9` on POSIX). Honour
      `RUSHPOINT_REAP_DISABLE` (skip), `RUSHPOINT_REAP_MIN_AGE_MS` (default 5000) and
      `RUSHPOINT_REAP_DEBUG` (print the full verdict table, kill nothing). Wrap everything so it can
      never throw into its caller.

## 4. GREEN — wiring

- [x] 4.1 Wire `scripts/emulator-exec.mjs`: record the session on spawn, stamp its end in the
      `exit` handler, then run the guarded reap before propagating the child's exit code — without
      altering that exit code and without failing the run if the reap errors.
- [x] 4.2 Wire `scripts/free-ports.mjs`: call the guarded reap alongside the existing port sweep and
      stale-helper cleanup. Do NOT change the existing `PORTS` list or `STALE_CMDLINE_PATTERNS`.

## 5. REFACTOR & gates

- [x] 5.1 Review the new modules for duplication with `scripts/free-ports.mjs`'s existing
      enumeration and kill code and with `scripts/lib/emulatorBackup.mjs`'s conventions; keep the
      pure module import-free and the shell decision-free.
- [x] 5.2 Document the new env vars (`RUSHPOINT_REAP_DISABLE`, `RUSHPOINT_REAP_MIN_AGE_MS`,
      `RUSHPOINT_REAP_DEBUG`) and the session file in the header comments of the two new modules and
      of `scripts/emulator-exec.mjs`.
- [x] 5.3 Run `npm run typecheck`, `npm run lint` and `npm test`. Record the output verbatim.
      **`npm run lint` and `npm test` PASS. `npm run typecheck` FAILS on a PRE-EXISTING, unrelated
      error in another agent's in-flight chat work** — see the verification notes below.
- [x] 5.4 Record explicitly that emulator-dependent gates (`npm run e2e`, `npm run test:rules`,
      `npm run verify:emulator`) and the reaper's RUNTIME behavior against real processes are
      UNVERIFIED, because a live playtest stack is serving from this tree and no emulator, Vite,
      tunnel or backup process may be started, stopped or killed. First real-world exercise should be
      `RUSHPOINT_REAP_DEBUG=1` (verdicts only, no kills).

## 6. Verification notes (what was and was NOT proven)

**RED, verbatim** (`npx tsx scripts/test-emulator-reap.ts`, before `scripts/lib/emulatorReap.mjs`
existed):

```
Error: Cannot find module './lib/emulatorReap.mjs'
Require stack:
- C:\Users\savir\Projects\Rushpoint\scripts\test-emulator-reap.ts
```

**GREEN:** `✅ ALL EMULATOR-REAP TESTS PASSED (62)`.

**Gates run (non-emulator only):**
- `npm run lint` → `✖ 53 problems (0 errors, 53 warnings)` · `Tasks: 1 successful, 1 total` — PASS
  (0 errors; all warnings pre-existing in creator-web).
- `npm test` → pure-logic aggregator `✓ All 121 pure-logic unit file(s) passed.` (including the new
  `ALL EMULATOR-REAP TESTS PASSED (62)` and the pre-existing `ALL EMULATOR-BACKUP TESTS PASSED (84)`
  / `ALL EMULATOR-RETENTION TESTS PASSED (164)`), then vitest `Tasks: 4 successful, 4 total`
  (functions 267 passed, creator-web 180 passed) — PASS.
- `npm run typecheck` → **FAILS**, on a file this change never touches:
  `apps/creator-web/src/pages/RunConsolePage.tsx(577,13): error TS2322 … Property 'selfUid' does not
  exist on type …` — a half-applied `ChatConsole`/`ChatPanel` prop change in a **concurrent agent's**
  uncommitted chat work (`git status` shows RunConsolePage.tsx, ChatPanel.tsx, chat.ts et al.
  modified by someone else). This change touches only `scripts/` and `openspec/`; nothing it adds is
  TypeScript that participates in a workspace `tsc` project. Not fixed here — it is not this
  change's code.

**NOT verified — and why:**
- `npm run e2e`, `npm run test:rules`, `npm run verify:emulator`, `npm run dev:all`,
  `npm run playtest` were NOT run: a live playtest stack (Vite 5180/5181, Firestore 8080) is serving
  from this working tree and no emulator/Vite/tunnel/backup process may be started, stopped or killed.
- **The kill path has never executed.** No process was signalled by anything in this change. The
  end-of-exec reap in `scripts/emulator-exec.mjs` and the launch-time reap in `scripts/free-ports.mjs`
  are wired but have never run against a real orphan, because producing one requires running an
  emulator.
- **What WAS exercised against reality, read-only:** `enumerateProcesses()` + `planEmulatorExecReap`
  over the real process table (390 processes, 0 recorded sessions) → `WOULD REAP: 0`, verdicts
  `not-an-emulator-process` 331 / `protected-descendant` 51 / `self-ancestor` 5 / `self` 1 /
  `unattributed` 1. The single `unattributed` is the **currently-live Firestore emulator JVM**, whose
  own parent is already absent — i.e. it is shape-identical to an orphan and is protected solely by
  the absence of a matching session record. No kill function was called.
- First real-world exercise should be `RUSHPOINT_REAP_DEBUG=1` on a machine where an emulator may be
  started, confirming the verdict table before any kill is enabled.

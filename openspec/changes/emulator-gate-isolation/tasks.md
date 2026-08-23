# Tasks — emulator-gate-isolation

## INVESTIGATE

- [x] 1. Verify or refute the hub-locator hypothesis against the pinned `firebase-tools@15.18.0`
      source in `node_modules`. Record the exact file:line where the locator path is derived, where
      it is written, and where `emulators:export` reads it, plus the correction that the *second*
      suite to boot declines to overwrite it. Written up in `design.md` §1.

## RED

- [x] 2. Write `scripts/test-emulator-gate-isolation.ts` against the not-yet-existing
      `scripts/lib/emulatorIsolation.mjs` and `scripts/lib/staleHelperSweep.mjs`:
      the locator file-name literal (`hub-<projectId>.json`, `hub-demo-no-project.json` when
      missing); offset 0 / invalid / negative / disabled ⇒ no isolation and an EMPTY override map;
      a positive offset ⇒ a private per-offset directory under `.firebase/` set on `TEMP`, `TMP`
      and `TMPDIR`; totality against adversarial inputs; a source scan proving both modules import
      nothing. For the sweep: a matching orphan dies; the sweeper and its ancestors survive; a
      live exec session's root, ancestors, in-snapshot descendants and absent-root orphans all
      survive; an offset-marked command line survives; `--port` outside the swept block survives;
      `--port` inside it dies; a FINISHED session's leftovers die; the default-block playtest JVM
      still dies; and `keep ∪ kill === input`, `keep ∩ kill === ∅` for every case. Auto-discovered
      by `scripts/run-unit-tests.mjs`. Record the RED output.

## GREEN

- [x] 3. Create `scripts/lib/emulatorIsolation.mjs` — pure, imports nothing:
      `ISOLATION_DISABLE_ENV`, `TEMP_DIR_ENV_KEYS`, `HUB_LOCATOR_MISSING_PROJECT`,
      `hubLocatorFileName(projectId)`, `planEmulatorIsolation({ offset, repoRoot, env })`,
      `describeEmulatorIsolation(plan)`.
- [x] 4. Create `scripts/lib/staleHelperSweep.mjs` — pure, imports nothing:
      `OFFSET_MARKER_PATTERNS`, `MAX_RUNNING_SESSION_AGE_MS`, `commandLinePort(commandLine)`,
      `isRunningSession(session, { nowMs, maxAgeMs })`,
      `planStaleHelperSweep({ processes, patterns, sessions, sweptPorts, selfPid, protectedPids,
      nowMs })`. An unfinished session record must expire, or a crashed gate would make its debris
      permanently unclearable.
- [x] 5. `scripts/emulator-exec.mjs`: when (and only when) the effective offset is non-zero, plan
      the isolation, `mkdirSync` the private temp dir and apply the overrides to the child env.
      Print the effective directory. Offset 0 changes nothing about the command line **or** the
      child environment.
- [x] 6. `scripts/free-ports.mjs`: enumerate once via `enumerateProcesses()` (already exported by
      `scripts/lib/reapEmulatorExec.mjs`), read the exec-session record via `readExecSessions()`,
      ask `planStaleHelperSweep` what may die, and kill exactly that. No selection logic left in
      the script. The `cloudflared.exe` / `ngrok.exe` image-name sweeps and the port-based
      `freeWindows()` / `freeUnix()` sweep are untouched.
- [x] 7. Document the isolation lane in `CLAUDE.md` beside the other hard-won dev-script notes.

## REFACTOR / VERIFY

- [x] 8. `node --check` both new modules and both edited scripts.
- [x] 9. `npx tsx scripts/test-emulator-gate-isolation.ts` green.
- [x] 10. `npx tsx scripts/test-emulator-ports.ts` and `npx tsx scripts/test-emulator-reap.ts` still
      green — proof that the offset resolver and the reaper are unchanged.
- [x] 11. Prove the offset-0 path is untouched by direct source inspection: at offset 0
      `emulator-exec.mjs` never calls `planEmulatorIsolation`'s consumers, never writes a config and
      never mutates `env` beyond `JAVA_TOOL_OPTIONS` (unchanged from before).
- [ ] 12. Parent lane: `npm run typecheck` · `npm test`. Not runnable from this lane.
      (`npx openspec validate emulator-gate-isolation --strict` was also planned here but the
      `openspec` CLI is not installed in this repo or globally, so the artifacts were validated by
      reading them against `openspec/config.yaml` instead.)
- [ ] 13. Parent lane (live): `RUSHPOINT_EMULATOR_PORT_OFFSET=1000 npm run verify:emulator` beside
      the playtest; confirm no "multiple instances" warning, that
      `%TEMP%\hub-rushpoint-pwa-7daaa.json` keeps naming port 4400 throughout, that
      `.firebase/emulator-offset-tmp/offset-1000/hub-rushpoint-pwa-7daaa.json` appears while the
      gate is up, and that `node scripts/emulator-backup.mjs --status` stays healthy.

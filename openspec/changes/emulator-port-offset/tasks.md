# Tasks — emulator-port-offset

## RED

- [x] 1. Write `scripts/test-emulator-ports.ts` against the not-yet-existing
      `scripts/lib/emulatorPorts.mjs`: the no-op pin (empty env / `{}` / `''` / `'0'` / garbage all
      equal a hand-written literal table of today's nine ports), a positive offset shifts every port
      by exactly the effective offset, the snap-to-1000 rule, the 1000..56000 bounds, adversarial
      inputs (`undefined`, `null`, `''`, `'   '`, `'abc'`, `'NaN'`, `'Infinity'`, `'-5'`, `'1e3'`,
      `'12.5'`, `'0x10'`, `'999999999'`, a raw number, an object) never throw and always yield legal
      integer ports, no two resolved ports collide, the shifted block is disjoint from the default
      block and from `{3000, 5180, 5181}`, `buildOffsetFirebaseConfig` does not mutate its input and
      preserves every non-emulator section, and `resolveEmulatorHostEnv` matches the resolved map.
      Auto-discovered by `scripts/run-unit-tests.mjs`, so no registration. Record the RED output.

## GREEN

- [x] 2. Create `scripts/lib/emulatorPorts.mjs`: `BASE_EMULATOR_PORTS`, `PORT_OFFSET_ENV`,
      `MIN_PORT_OFFSET`, `MAX_PORT_OFFSET`, `OFFSET_STEP`, `resolveEmulatorPortOffset(env)`,
      `resolveEmulatorPorts(env)`, `resolveEmulatorHostEnv(env)`, `emulatorAddress(port, host)`,
      `buildOffsetFirebaseConfig(baseConfig, ports)`, `describeEmulatorPorts(ports, offsetInfo)`.
      Pure: no `fs`, no `child_process`, no `process` read.
- [x] 3. `scripts/emulator-exec.mjs`: resolve the offset, and when it is non-zero read
      `firebase.json`, write `firebase.emulator-offset.json` at the repo root and append
      `--config firebase.emulator-offset.json`. At offset 0 change nothing about the spawned command
      line. Print the effective ports and any notice.
- [x] 4. Route `scripts/e2e-verify.mjs` (:68-69 env hosts, :93-96 connect calls, :961 storage URL)
      through the resolver.
- [x] 5. Route `scripts/test-rules.mjs` and `scripts/test-storage-rules.mjs` (rules-unit-testing
      `host`/`port` blocks) through the resolver.
- [x] 6. Route `scripts/simulate-run.mjs`, `scripts/simulate-adversarial.mjs` and
      `scripts/simulate-browser-run.mjs` through the resolver.
- [x] 7. Route `scripts/lib/firestore-admin.mjs` env-host defaults through the resolver.
- [x] 8. Add `firebase.emulator-offset.json` to `.gitignore`.
- [x] 9. Document the offset lane in `CLAUDE.md` next to the other hard-won dev-script notes.

## REFACTOR / VERIFY

- [x] 10. Confirm `scripts/lib/emulatorReap.mjs` and `scripts/lib/reapEmulatorExec.mjs` read no port
      and are left untouched; record the audit in `design.md` §6.
- [x] 11. `npx tsx scripts/test-emulator-ports.ts` green.
- [ ] 12. Parent lane: `npm run typecheck`, `npm test`, then the first real offset run
      `RUSHPOINT_EMULATOR_PORT_OFFSET=1000 npm run verify:emulator` alongside the live playtest.
      Not runnable here (no emulator may be started from this lane).
- [ ] 13. **NOT RUNNABLE HERE.** `npx openspec validate emulator-port-offset --strict` — the
      `openspec` CLI is not installed in this repo or globally, so the artifacts were validated by
      reading them against `openspec/config.yaml`. Leave open until the CLI is available.

> **TDD order is mandatory.** Every group starts with a RED task (a failing test that encodes the
> new behavior, run and confirmed failing *for the right reason*), then the minimum code to go
> GREEN, then REFACTOR. Groups 1–3 are pure logic and independent of each other. Group 4 is wiring
> and depends on 1–3. Group 5 is the gate.
>
> **Parallel-agent caution:** other agents are live on this tree. Groups 1–3 touch only
> `scripts/lib/*.mjs` + `scripts/test-*.ts` (low conflict). Group 4 touches
> `scripts/ngrok-tunnel.mjs`, `scripts/dev-emulator.mjs`, `scripts/emulator-backup.mjs` and root
> `package.json` — re-read each file immediately before editing. Never run `npm run verify` or
> `verify:emulator` while another agent is running one (`shared:build` rewrites
> `packages/shared/dist` in place).

## 1. Tunnel failure classifier (pure lane)

- [x] 1.1 RED: extend `scripts/test-tunnel-restart.ts` with `classifyTunnelFailure`,
  `isPermanentTunnelFailure` and `tunnelFailureReport` imported from `./lib/tunnelRestart.mjs`.
  Include a **verbatim fixture of the real ngrok output captured on 2026-07-22** (from
  `.firebase/playtest-forever.log`) containing `ERR_NGROK_334` and
  `The endpoint 'https://…' is already online` → expect `'domain-contention'`. Add an auth fixture
  (`ERR_NGROK_107`) → `'auth'`; `ECONNREFUSED` / `dial tcp` → `'network'`; `''`, `null`,
  `undefined`, and an ordinary exit tail → `'unknown'` without throwing.
  `isPermanentTunnelFailure`: true for contention/auth, false otherwise.
  `tunnelFailureReport('domain-contention', { domain, identity })` → `permanent === true` and the
  joined `lines` mention the domain, state the URL is serving a **different machine**, and name the
  fix. Run `npm test` → confirm it FAILS because the exports don't exist.
- [x] 1.2 GREEN: add the three exports to `scripts/lib/tunnelRestart.mjs` per design D1 — regex
  table for the classifier, `isPermanentTunnelFailure` over the two permanent kinds, and
  `tunnelFailureReport` as a pure `{ permanent, headline, lines[] }` builder (no `console.*`
  inside). Leave `restartDelayMs` / `isQuickFailure` untouched. `npm test` → green.
- [x] 1.3 GREEN: add `machineIdentity({ hostname, importSource, importMs })` (design D2) returning
  a single line, tolerating a missing/NaN `importMs`. Extend the test in 1.1's file to cover it
  first (RED), then implement. `npm test` → green.
- [x] 1.4 REFACTOR: confirm the module still has **zero** I/O, `Date.now()`, `os.*` or `spawn`
  imports — every value is injected — matching its existing header comment. Update that header to
  name this change alongside `playtest-tunnel-auto-restart`. `npm test` still green.

## 2. Import picker — same-clock comparison (pure lane)

- [x] 2.1 RED: extend `scripts/test-emulator-backup.ts` with `resolveImportTimestamps` from
  `./lib/emulatorBackup.mjs`. **The regression that encodes the incident:** a backup whose
  folder-name timestamp is OLDER than the primary's mtime but whose metadata mtime is NEWER (a
  crash-time snapshot that finished writing after the last planned export) — feed the result into
  the existing `selectFreshestImport` and assert `'backup'`. Also assert the fallback: with
  `backupMetaMs` null/undefined, `backupMs` comes from `snapshotTimeMs(backupName)`; and that an
  available mtime on one side is never compared against a folder name on the other. Run `npm test`
  → confirm FAILS (export missing).
- [x] 2.2 GREEN: add `resolveImportTimestamps({ primaryMetaMs, backupMetaMs, backupName })` to
  `scripts/lib/emulatorBackup.mjs` per design D3, returning `{ primaryMs, backupMs }`. Do not
  change `selectFreshestImport` — it was never the bug. `npm test` → green.
- [x] 2.3 REFACTOR: extend the doc comment on `selectFreshestImport` to state explicitly that both
  inputs MUST come from the same clock, pointing at `resolveImportTimestamps` — so the next caller
  can't reintroduce the mismatch. No behavior change; `npm test` green.

## 3. Tiered retention (pure lane)

- [x] 3.1 RED: extend `scripts/test-emulator-backup.ts` with `selectTieredPrune`. Build a synthetic
  set spanning ~10 days at 2-minute spacing and assert: everything inside `recentMs` is retained;
  exactly one (the newest) per distinct UTC hour across `hourlyHours`; one per distinct UTC day
  across `dailyDays`; **the newest snapshot overall is always retained**; unparseable names
  (`snapshotTimeMs` → NaN) are never pruned; `[]` in → `[]` out; and the retained count stays
  bounded (≈46 for the defaults) on the 10-day input. Run `npm test` → FAILS.
- [x] 3.2 GREEN: implement `selectTieredPrune(names, { nowMs, recentMs, hourlyHours, dailyDays })`
  per design D4 with defaults 30 min / 24 h / 7 d, `nowMs` injected. Keep
  `selectSnapshotsToPrune` exactly as-is. `npm test` → green.
- [x] 3.3 REFACTOR: verify the existing `selectSnapshotsToPrune`, `selectRestoreTarget`,
  `snapshotTimeMs` and `didExportSucceed` assertions all still pass untouched — the retained API
  must not regress. `npm test` green.

## 4. Wiring (no new pure logic)

- [x] 4.1 `scripts/ngrok-tunnel.mjs`: on child exit, classify the captured stderr/stdout tail via
  `classifyTunnelFailure`. For a **permanent** kind, print the full `tunnelFailureReport` block on
  **every** retry (not once); for transient kinds keep today's terse reconnect line. Preserve the
  existing `restartDelayMs` backoff and the never-`process.exit(1)` invariant
  (`ngrok-tunnel.mjs:23-30`) — a permanent failure must still not collapse the stack.
- [x] 4.2 `scripts/dev-emulator.mjs`: stat the backup's `firebase-export-metadata.json` (already
  known to exist at `:73`) and route both timestamps through `resolveImportTimestamps` before
  `selectFreshestImport`. Print `machineIdentity(...)` at boot with the resolved import source.
- [x] 4.3 `scripts/emulator-backup.mjs`: swap `prune()` to `selectTieredPrune`, keeping
  `EMU_BACKUP_KEEP` honoured as an explicit override so its meaning doesn't silently change.
  Log what was pruned and what the retained span now covers.
- [x] 4.4 Snapshot coverage for `dev:all`. **Implemented differently from the design's D5, on
  purpose — read this before "fixing" `package.json`.** D5 proposed adding `"npm:emulator:backup"`
  as a sixth `concurrently` entry on `dev:all`; the shipped solution instead makes
  `scripts/dev-emulator.mjs` own the loop (`:144-181`): `RUSHPOINT_BACKUP` flipped from opt-IN to
  opt-OUT, so the loop starts by default for **every** consumer of `npm run emulator`
  (`dev:all`, `emulator` on its own, anything else), not just the one script that was edited.
  It also carries the interlock a `concurrently` entry could not: `shouldStartBackupLoop` reads
  `.firebase/backups/STATUS.json` and declines to start a SECOND loop when a recent heartbeat
  names a live pid — which is exactly the `npm run playtest` case, since `playtest` already runs
  its own `BACKUP` process. Fails open (an extra loop is noisy and recoverable; no loop is silent).
  Net effect: `dev:all` is protected, and `package.json`'s `dev:all` is deliberately still
  `EMU,SEED,CREATOR,PLAY` with no `--kill-others-on-fail`.
- [ ] 4.5 **NOT DONE — deliberately deferred.** Manual wiring check: run `npm run dev:all` and
  confirm a `BACKUP` prefix appears and a snapshot lands in `.firebase/backups/`. Ctrl+C to stop so
  `--export-on-exit` fires. Deferred because a live `playtest:prod` stack currently owns the
  emulator ports and the ngrok domain, and it is serving the recovered game; starting `dev:all`
  would fight it for :8080/:9099 and could disrupt a live session. Run this at the next natural
  stack restart. The `--latest` path it depends on was verified working against the live tree.

## 5. Gate

- [x] 5.1 Gates run sequentially. **Green:** `npm run typecheck` (5/5 workspaces) ·
  `npm run lint` (0 errors, 42 pre-existing style warnings) · `npm run test:unit`
  (108/108 pure-logic files, exit 0 — includes the 39 tunnel + 71 backup assertions added here).
  **Not run, with reasons:**
  - `npm run creator:build` / `npm run play:build` — this change touches no app source (only
    `scripts/`, `package.json`, `openspec/`), and both invoke `shared:build`, which rewrites
    `packages/shared/dist` in place; other agents are live on this tree, so running them risked
    the documented `dist`-race false failure for zero signal.
  - `npm run e2e` — adds **no** signal (no callable added or changed, so the callable-coverage
    guard is unaffected) and would write test games/runs into the **live emulator currently
    serving the recovered game** over the tunnel. Not worth polluting the dataset this session
    just rescued.
  - `npm run i18n:check` — **N/A**, confirmed: no UI file touched, no user-facing string added
    (the new strings are terminal operator output in `scripts/`, which `t.*` does not cover).

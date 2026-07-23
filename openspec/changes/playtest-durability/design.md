# Design — playtest-durability

## Constraints that shape this

- All new logic must be **pure** and land in the existing **no-emulator** lane. The two libs
  involved (`scripts/lib/tunnelRestart.mjs`, `scripts/lib/emulatorBackup.mjs`) are already written
  that way — no `Date.now()`, no I/O, no `spawn` — with values injected by the caller. Keep that
  property; it is what makes this testable at all.
- The supervisor (`scripts/playtest-forever.mjs`) runs the stack under
  `concurrently --kill-others-on-fail`. **Nothing added here may exit non-zero on a recoverable
  condition** — a backup or tunnel problem must never collapse the playtest stack. This is the
  same hazard already documented at `ngrok-tunnel.mjs:23-30`.
- `scripts/*.mjs` are plain ESM JavaScript; the tests are `.ts` run by `tsx` through
  `scripts/run-unit-tests.mjs`. Importing an `.mjs` from a `test-*.ts` is the established pattern
  (`scripts/test-tunnel-restart.ts` already does it).
- No callable, no shared type, no Firestore path, no rule, no UI string. The server-write-only,
  `FIRESTORE_PATHS`, answer-key-secrecy and `.set({merge})`/array footgun rules are **not engaged**
  by this change. `npm run i18n:check` is **N/A** (no user-facing text).

---

## D1 — Classify tunnel failures instead of treating them all as drops

**File:** `scripts/lib/tunnelRestart.mjs` (new exports, existing two untouched)

The root defect is that `ngrok-tunnel.mjs` has exactly one failure model: "it dropped, back off and
retry". Domain contention is categorically different — it is **permanent**. No amount of retrying
resolves it, and while it persists the shared URL is serving *someone else's* machine.

```js
export function classifyTunnelFailure(text) → 'domain-contention' | 'auth' | 'network' | 'unknown'
```

Matched against the child's combined stderr/stdout tail:

| kind | signals | permanent? |
|---|---|---|
| `domain-contention` | `ERR_NGROK_334`, `is already online` | yes |
| `auth` | `ERR_NGROK_105`, `ERR_NGROK_107`, `authentication failed`, `invalid.*authtoken` | yes |
| `network` | `ECONNREFUSED`, `dial tcp`, `no such host`, `context deadline exceeded` | no |
| `unknown` | anything else | no |

```js
export function isPermanentTunnelFailure(kind) → boolean          // 'domain-contention' | 'auth'
export function tunnelFailureReport(kind, { domain, identity }) → { permanent, headline, lines[] }
```

`tunnelFailureReport` is a **pure string builder** — it returns the block to print, so the wording
itself is unit-testable rather than buried in `console.error` calls. For `domain-contention` the
block must state all three of: the cause (another ngrok agent holds this domain), the consequence
(**the shared URL is serving a different computer's data — not this one**), and the fix (stop the
other machine's tunnel; this one reclaims the domain on its next retry).

**Why a classifier rather than just a better log line:** the *permanence* is what changes behavior.
Permanent failures must keep re-announcing on every retry instead of being said once and scrolling
away — that is precisely how this went unnoticed for days.

**Behavioral rule (in `ngrok-tunnel.mjs`):** on a permanent kind, print the full block on **every**
retry, not just the first. Transient kinds keep today's single terse reconnect line. The existing
`restartDelayMs` backoff is unchanged — backoff controls *retry cadence*, not *visibility*.

## D2 — Machine identity marker

**File:** `scripts/lib/tunnelRestart.mjs`

```js
export function machineIdentity({ hostname, importSource, importMs }) → string
```

One line, e.g. `this machine: DESKTOP-ABC · dataset: backup-2026-07-22T19-02-42-662Z @ 19:02:42Z`.
Pure: the caller injects `os.hostname()` and the already-resolved import source/timestamp that
`dev-emulator.mjs` computed. Printed at emulator boot and embedded in every contention block, so
"which computer is this URL?" is answerable from the terminal without forensics.

## D3 — Import picker: compare like with like

**File:** `scripts/dev-emulator.mjs` (the caller — this is where the bug is), plus a new pure helper
in `scripts/lib/emulatorBackup.mjs`.

Today:

- `dev-emulator.mjs:69` → `primaryMs = statSync(primaryMeta).mtimeMs` — a **file mtime**
- `dev-emulator.mjs:74` → `backupMs = snapshotTimeMs(basename(backupCand))` — a **folder-name**
  timestamp, i.e. when the snapshot *started*, not when it finished being written

`selectFreshestImport` itself is correct; it is fed mismatched clocks. Two real consequences:

1. A folder-name timestamp is always **earlier** than the same snapshot's write time, so a backup
   is systematically under-valued in the comparison.
2. Any rewrite of the primary export's metadata — including one that wrote an **empty or partial**
   dataset — refreshes its mtime to "now", so it wins unconditionally, becomes the import baseline,
   and `--export-on-exit` then persists it over the good data. That is a silent dataset swap.

```js
export function resolveImportTimestamps({ primaryMetaMs, backupMetaMs, backupName }) → { primaryMs, backupMs }
```

Rule, encoded and tested: **when both metadata mtimes are available, both sides are compared by
metadata mtime.** The folder-name timestamp is used for `backupMs` *only* as a fallback when the
backup's metadata mtime can't be read, and never mixed with an available mtime on the other side.
`dev-emulator.mjs` then stats `join(backupCand, 'firebase-export-metadata.json')` (it already
verifies that file exists at `:73`) and passes both mtimes through this helper.

`snapshotTimeMs` stays — it is still the right tool for *sorting names* (D4) and for the fallback.

## D4 — Tiered retention

**File:** `scripts/lib/emulatorBackup.mjs`

`selectSnapshotsToPrune(names, keepN)` is kept as-is (still exported, still tested — other callers
and `--latest` rely on the name-sort semantics). A new policy function is added alongside:

```js
export function selectTieredPrune(names, { nowMs, recentMs, hourlyHours, dailyDays }) → string[]
```

Retain, by descending priority, then prune everything else:

- every snapshot inside the **recent window** (`recentMs`, default 30 min) — dense, covers "I broke
  it 10 minutes ago"
- the **newest snapshot in each distinct UTC hour** for `hourlyHours` (default 24)
- the **newest snapshot in each distinct UTC day** for `dailyDays` (default 7)
- the **newest snapshot overall is always retained**, unconditionally — a policy that can prune
  everything is a data-loss bug, so this is an explicit invariant, not an emergent one

Bounded by construction: ~15 + 24 + 7 ≈ 46 snapshots ≈ 60 MB at the observed ~1.3 MB/snapshot,
versus today's 10 (~18 minutes). `nowMs` is injected — the function stays pure and deterministic.

Names that fail to parse (`snapshotTimeMs` → `NaN`) are **retained, never pruned** — an unparseable
folder is not proof it's disposable.

`scripts/emulator-backup.mjs` swaps its `prune()` call to `selectTieredPrune`, keeping `KEEP_N`
honoured as an override so `EMU_BACKUP_KEEP` doesn't silently change meaning for anyone setting it.

## D5 — `dev:all` gets the snapshot loop

> ⚠ **SUPERSEDED BY THE IMPLEMENTATION.** The rest of D5 is the design as proposed; it is NOT what
> shipped. `package.json`'s `dev:all` was deliberately left as `EMU,SEED,CREATOR,PLAY`. Instead
> `scripts/dev-emulator.mjs:144-181` owns the loop: `RUSHPOINT_BACKUP` became an **opt-OUT**, so
> every consumer of `npm run emulator` is protected rather than only the one script edited here,
> and `shouldStartBackupLoop` uses `.firebase/backups/STATUS.json` (recent heartbeat + live pid) to
> refuse a SECOND loop — which is what keeps `npm run playtest`, which runs its own `BACKUP`
> process, from ending up with two exporters on one emulator. See tasks.md 4.4.

**File:** root `package.json`

```
dev:all = concurrently --names EMU,SEED,BACKUP,CREATOR,PLAY … "npm:emulator" "npm:dev:seed" "npm:emulator:backup" "npm:creator" "npm:play"
```

`emulator:backup` already self-gates on `wait-on tcp:127.0.0.1:8080` and the loop additionally waits
for the Emulator Hub before its first export (`emulator-backup.mjs:105-112`), so it cannot snapshot
a mid-boot emulator — the failure mode that previously wedged Firestore.

Deliberately **not** using `--kill-others-on-fail` for `dev:all` (it doesn't today, and must not
start): a backup hiccup must never take down a dev session.

The `RUSHPOINT_BACKUP` gate at `dev-emulator.mjs:98` is left in place — it is the *in-process*
spawn path used when `dev-emulator.mjs` runs standalone, distinct from the `concurrently` BACKUP
process. Both paths guard against double-starting via the same wait-for-ready logic.

---

## Test strategy

Everything here is pure logic ⇒ **no emulator**, both files in the existing aggregator lane
(`npm test` → `scripts/run-unit-tests.mjs` + vitest).

**`scripts/test-tunnel-restart.ts`** (extend; already covers `restartDelayMs`/`isQuickFailure`)

- `classifyTunnelFailure` against a **verbatim fixture of the real failure captured today** from
  `.firebase/playtest-forever.log` — the actual multi-line ngrok output containing
  `ERR_NGROK_334` and `The endpoint 'https://…' is already online` → `'domain-contention'`.
  Using the real captured text, not a hand-written approximation, is the point: it proves the
  matcher fires on what ngrok genuinely emits.
- auth fixture → `'auth'`; `ECONNREFUSED`/`dial tcp` → `'network'`; empty string, `null`,
  `undefined`, and an ordinary clean-exit tail → `'unknown'` (never throws).
- `isPermanentTunnelFailure`: true for contention/auth, false for network/unknown.
- `tunnelFailureReport('domain-contention', …)`: `permanent === true`, and the rendered lines
  mention the domain, say the URL is serving a **different machine**, and name the fix. Asserting
  on content, so the warning can't be quietly watered down later.
- `machineIdentity`: includes hostname and dataset marker; tolerates a missing/NaN `importMs`.

**`scripts/test-emulator-backup.ts`** (extend)

- **The RED test for D3** — the regression that encodes the incident. Construct a backup whose
  folder-name timestamp is *older* than the primary's mtime, but whose **metadata mtime is newer**
  (exactly what happens after a crash: the backup finished writing after the last planned export).
  `resolveImportTimestamps` + `selectFreshestImport` must choose `'backup'`. Fed today's mixed
  clocks it chooses `'primary'` — this must fail before the fix, for that reason.
- Fallback: with `backupMetaMs` absent, `backupMs` falls back to the folder-name timestamp.
- `selectTieredPrune`: a synthetic set spanning ~10 days at 2-minute spacing retains everything in
  the recent window, exactly one per hour across `hourlyHours`, one per day across `dailyDays`;
  the newest is always retained; unparseable names are never pruned; an empty list returns `[]`.
- Existing `selectSnapshotsToPrune` / `selectRestoreTarget` / `didExportSucceed` assertions must
  keep passing unchanged (no behavior regression in the retained API).

**Not covered by automated tests, and stated plainly:** that `ngrok-tunnel.mjs` actually *prints*
the block on every retry, and that `dev:all` really starts BACKUP, are wiring — verified by
inspection plus one manual run (`dev:all` shows a `BACKUP` prefix and writes a snapshot). Genuine
two-machine domain contention cannot be reproduced in CI; the classifier fixture is the proxy, and
that is the honest limit of this change's automated coverage.

## Rollout / risk

- Pure additions plus one changed comparison and one changed npm script. No data migration.
- The retention change **only ever retains more** than today, so it cannot delete something the
  current policy would have kept.
- Risk if `selectTieredPrune` is wrong: unbounded disk growth (visible, recoverable) rather than
  data loss — the failure direction is deliberately chosen to be the safe one.

## Gate coordination (parallel agents)

Other agents are active on this working tree. `npm run verify` and `npm run verify:emulator` both
invoke `shared:build`, which rewrites `packages/shared/dist` **in place**; running them
concurrently produces a spurious `No matching export … from './runs/index'`. Gates for this change
must be run **sequentially**, and not while another agent is running a gauntlet.

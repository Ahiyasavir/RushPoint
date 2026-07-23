# Playtest durability — never silently serve the wrong machine, never silently lose data

## Why

On 2026-07-22 a creator was told, with high confidence, that their game
(`משחק שדה לסניף בני עקיבא רמות`) had been destroyed by a database swap. It had not. The game
was intact the whole time — 3 stages, 8 tasks, 8 finished runs — sitting in the emulator on a
*second* computer.

The actual failure: **two machines shared one reserved ngrok domain.** ngrok free allows a single
online agent per domain, so machine B held the endpoint and machine A's tunnel crash-looped with
`ERR_NGROK_334 — endpoint already online`. `scripts/ngrok-tunnel.mjs` does not recognise that
error. It classified a permanent, unrecoverable ownership conflict as an ordinary disconnect and
retried forever, printing only `tunnel exited (code 1) — reconnecting in 30s…`.

Because every machine runs its own Auth emulator, **the same Google account resolves to a
different uid on each machine.** So the shared URL kept resolving to the other computer's dataset,
the creator signed in and saw an empty account, and a forensic sweep of the browser cache found
"ghost" creator uids present in no export — which read as evidence of a destroyed database. The
diagnosis chain was sound; the premise (that the URL pointed at this machine) was never checked,
because nothing in the tooling made it checkable.

Three latent data-loss defects were found while investigating, all verified:

1. **`dev:all` has no crash protection at all.** `dev:all` = `EMU,SEED,CREATOR,PLAY` — no BACKUP
   process — and the snapshot loop is gated behind `RUSHPOINT_BACKUP` ([`dev-emulator.mjs:98`]),
   which nothing sets. Every `dev:all` session runs with zero snapshots.
2. **The import picker compares two different clocks.** [`dev-emulator.mjs:69`] takes the primary
   export's *file mtime*; [`:74`] takes the backup's *folder-name* timestamp. A rewritten or
   partial primary export gets a fresh mtime, always wins the comparison, becomes the imported
   baseline — and `--export-on-exit` then persists it over the good data.
3. **Retention is ~18 minutes.** `KEEP_N = 10` at a 2-minute interval. A loss noticed an hour
   later is already unrecoverable.

## What changes

**Tunnel identity becomes observable and contention becomes loud.** A playtest operator can tell,
without guessing, whether the public URL is served by *this* machine:

- Domain contention (`ERR_NGROK_334` / "already online") is classified as its own failure kind,
  distinct from an ordinary drop. It produces a loud, repeating, unmissable warning that names the
  cause ("another machine holds this domain"), names the consequence ("the shared URL is serving a
  DIFFERENT computer's data"), and names the fix — instead of a generic reconnect line.
- Contention does not back off into silence: a conflict that persists stays visible for as long as
  it lasts, rather than scrolling away once.
- The stack prints a **machine identity marker** (hostname + dataset fingerprint) at boot and on
  every contention warning, so "which computer is this URL?" is answerable from the terminal.

**Snapshot coverage stops being opt-in.** `npm run dev:all` gets the same crash-safe snapshot loop
`playtest` already has, so ordinary development is protected by default.

**Recovery survives being noticed late.** Retention becomes tiered — a dense recent window plus
sparser hourly/daily keepers — so the history spans hours and days instead of 18 minutes, without
unbounded disk growth.

**The import picker compares like with like.** Both candidates are timestamped by the same rule, so
a stale or partial export can never out-rank a newer backup and become the new baseline.

## Non-goals

- **No recovery tooling for the incident itself.** The affected game was already extracted; this
  change is purely preventive.
- **No move off ngrok free**, no paid plan, no multi-endpoint pooling. The fix is to make
  contention *visible*, not to make two machines able to share one domain.
- **No change to what the tunnel serves**, to the proxy's routing, or to any app bundle.
- **No automatic killing** of a competing tunnel, local or remote. The tool reports; the operator
  decides.
- **No change to `--export-on-exit`**, to the emulator's own import format, or to seeding.
- **No production/Firebase-hosting behavior change.** `hosting:tunnel` / `hosting:firebase` are
  untouched.
- Does **not** address the orphaned game `6ytbnuS0Bf32jpTHmlw7` (game doc absent, one run
  subcollection surviving, 5 access codes still pointing at it). Real, but a separate concern.

## Surfaces touched

Dev tooling only — `scripts/` and root `package.json`:

- `scripts/lib/tunnelRestart.mjs` — new pure failure classifier (new export)
- `scripts/lib/emulatorBackup.mjs` — tiered retention + same-clock import selection
- `scripts/ngrok-tunnel.mjs` — consume the classifier; loud contention reporting
- `scripts/dev-emulator.mjs` — same-clock timestamps; identity marker
- `package.json` — `dev:all` gains the BACKUP process

**No callable is added or changed** (no `services/calls.ts` wrapper, no `e2e-verify.mjs` coverage
guard impact). **No shared types, no Firestore rules, no index, no env var, no UI** — so
`npm run i18n:check` is not implicated. All new logic is pure and lands in the existing
no-emulator test lane (`scripts/test-tunnel-restart.ts`, `scripts/test-emulator-backup.ts`).

## Why

The always-on public playtest and the mandated verification gate **write to the same directory**.

`npm run playtest:prod` (driven forever by `scripts/playtest-forever.mjs`) serves the *pre-built*
output of both apps through `vite preview`, behind the single-origin reverse proxy
(`scripts/proxy.mjs`) that routes `/creator*` to :5180 and **everything else** to play-web on :5181:

| Script | Command | Writes | Serves |
|---|---|---|---|
| `npm run playtest:build` | `vite build --mode playtest` | `apps/creator-web/dist` · `apps/play-web/dist` | — |
| `npm run playtest:creator:preview` | `vite preview --mode playtest` | — | `apps/creator-web/dist` |
| `npm run playtest:play:preview` | `vite preview` | — | `apps/play-web/dist` |
| `npm run creator:build` (inside `npm run verify`) | `vite build` | `apps/creator-web/dist` | — |
| `npm run play:build` (inside `npm run verify`) | `vite build` | `apps/play-web/dist` | — |

`npm run verify` is the gate every agent and the owner are told to run constantly. Every single run
of it overwrites the exact bytes the live tunnel is serving to real participants, with a build made
for a **different deployment target**. Two independent breakages follow, and **neither produces an
error anywhere**: every process stays healthy and every request returns `200`.

**1. Base-path clobber (confirmed live today; cost the owner a broken creator app).**
`apps/creator-web/vite.config.ts:13` sets `base: mode === 'playtest' ? '/creator/' : '/'`.
`creator:build` runs without `--mode playtest`, so the emitted `index.html` references
`/assets/index-*.js`. Under the playtest proxy `/assets/…` is not `/creator*`, so it is routed to
**play-web**, which answers `200` with its own SPA HTML. The creator's JavaScript never loads and
the live creator console is a **blank page**. It was repaired once today by re-running
`npm run playtest:build`, but the trap is still armed and re-arms itself on the next `npm run verify`.

**2. Backend clobber (found while investigating this; not previously recorded).**
`isEmulatorBuild` (`packages/shared/src/env.ts:14`) is `env.DEV === true || env.MODE === 'playtest'`.
A `--mode playtest` build is a *production* build (`DEV === false`) that deliberately keeps the
emulator wiring, which is the only reason a real phone on the tunnel can talk to the local backend.
`npm run play:build` builds mode `production`, so the clobbered `apps/play-web/dist` drops all
emulator wiring and points participants' phones at **real Firebase**, where anonymous auth is
disabled (`auth/admin-restricted-operation`). Nobody can join.

A third, milder hazard exists even between two *correct* builds: rewriting the served directory
changes every content-hashed asset filename, so a participant whose `index.html` is already loaded
starts 404-ing mid-game.

The root cause is not the base expression, and not any one script. It is that **one directory is
both the gate's output and the live site's document root**.

## What Changes

**The playtest build gets its own output directory, so the two builds can no longer collide.**

- `apps/creator-web/vite.config.ts` and `apps/play-web/vite.config.ts` set
  `build.outDir = mode === 'playtest' ? 'dist-playtest' : 'dist'`.
- `playtest:creator:preview` / `playtest:play:preview` serve `--outDir dist-playtest` **explicitly**
  on the command line, so the served path never depends on config-merge subtleties.
  `vite preview --outDir <dir>` is supported on the pinned Vite (5.4.21) — see `design.md` §2 for
  the source evidence.
- `scripts/playtest-forever.mjs`'s `distReady()` probes the playtest directories, since those are
  what the prod stack actually serves.
- `.gitignore` ignores both `dist-playtest` directories.
- **Nothing about the gate changes.** `creator:build` / `play:build` still produce a real production
  build in `dist`; `npm run bundle:budget` still measures `apps/play-web/dist`; `firebase.json`
  hosting still deploys `dist`; `npm run dev:all` and creator at `http://localhost:5180/` are
  untouched (they never used `--mode playtest`).

**A guard that fails loudly instead of silently**, because the failure mode this change removes is
invisible by construction and a future refactor could re-introduce it:

- New pure module `scripts/lib/buildArtifactGuard.mjs`:
  - `ARTIFACT_CONTRACT` — the declared (app, outDir, base, audience) table. Declared, never inferred.
  - `extractRootRefs(html)` — the root-absolute `src`/`href` of every `<script>` / `<link>`.
  - `checkBuiltBase({ html, expectedBase })` — every root-absolute asset reference must start with
    the intended base, an artifact with **no** asset references is a failure, and a base-`/` artifact
    carrying a reserved proxy prefix (`/creator/`) is a failure. This is exactly the blank-page
    condition, decided from bytes on disk.
  - `checkPlaytestScriptWiring(scripts)` — the `package.json` wiring itself: the gate builds must not
    carry `--mode playtest`, the playtest build must, and both playtest previews must serve
    `--outDir dist-playtest`. This is what stops a well-meaning edit from re-pointing the live
    preview at the gate's directory.
- New `scripts/test-build-artifact-guard.ts` (auto-discovered by `scripts/run-unit-tests.mjs`, so it
  is in `npm test`): synthetic-fixture tests for the pure decisions, plus the real `package.json`
  wiring assertion (`package.json` is source, not build output, so reading it is deterministic).
- New `scripts/check-build-base.mjs` (`npm run base:check`), appended to `npm run verify` after the
  two builds: applies `checkBuiltBase` to whichever `apps/*/dist*/index.html` exist on disk. A
  directory that has never been built is skipped, never failed.

**Documentation of the hazard** in `CLAUDE.md` (a new gotcha entry) and `PLAYTEST.md` (a dedicated
section), because this is precisely the class of hard-won, invisible-failure knowledge those files
exist to record.

## Impact

- Affected specs: `playtest-build-isolation` (new)
- Affected code: `apps/creator-web/vite.config.ts`, `apps/play-web/vite.config.ts`, `package.json`
  (scripts only), `.gitignore`, `scripts/playtest-forever.mjs`,
  `scripts/lib/buildArtifactGuard.mjs` (new), `scripts/test-build-artifact-guard.ts` (new),
  `scripts/check-build-base.mjs` (new), `CLAUDE.md`, `PLAYTEST.md`
- Not affected: `firebase.json` hosting roots, `scripts/check-bundle-budget.mjs`, `npm run dev:all`,
  `scripts/proxy.mjs`, any application source file, any Cloud Function, any Firestore path
- Operational note: the running playtest keeps serving its current `dist` until the supervisor next
  rebuilds. The first `npm run playtest:build` after this change populates `dist-playtest`; only a
  restart of `playtest:prod` (or the supervisor's own rebuild cycle) switches the preview onto it.

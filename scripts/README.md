# `scripts/` — what each program is for

Index written 2026-09-08. The authority on **how the gates fit together** is
[CLAUDE.md](../CLAUDE.md); this file answers the narrower question *"what is this file and am I
allowed to delete it?"*.

Three rules that hold across the folder:

- **`scripts/test-*.ts` is the pure-logic gate and is AUTO-DISCOVERED.** `run-unit-tests.mjs` runs
  every file matching that glob (287 of them today), one tsx process each, ~7 at a time. Dropping a
  new `test-<thing>.ts` in here puts it in `npm test` with no registration step. Nothing else in
  this folder is auto-discovered.
- **`scripts/lib/` holds the PURE decision cores** that the runnable programs import, so the
  decisions are unit-testable without a shell, an emulator or a network. A new guard belongs there,
  with its `test-*.ts` beside it.
- **A program marked `[one-off]` below already ran, against real data, and is kept only as the
  record of what was done.** Do not re-run one without reading it first — several write to the LIVE
  project. They use paths relative to `scripts/`, so they break if moved.

## Gates — run by `npm run verify` / `npm test`

| Script | npm | What it decides |
|---|---|---|
| `run-unit-tests.mjs` | `test:unit` | The pure-logic lane: discovers and runs every `test-*.ts`. |
| `check-i18n.ts` | `i18n:check` · `i18n:check:strict` | Hebrew copy is Hebrew, English copy is English, and no component hardcodes an unswitchable UI string. The leak predicate lives in `lib/i18nLeak.ts`. |
| `check-bundle-budget.mjs` | `bundle:budget` | play-web's first-load byte budget, and that the heavy deps stay out of the entry chunk. |
| `check-build-base.mjs` | `base:check` | Each built `index.html` asset base equals the path that directory is served from. |
| `check-backend-origin.mjs` | `origin:check` | Each deployed bundle really carries its declared `VITE_API_ORIGIN`, and no app has a `.env.local`. |
| `check-marketing-output.ts` | (in `verify:artifacts`) | The built marketing site: language, landmarks, labels, links. |
| `check-env-present.mjs` | `env:check` | Fail-fast tripwire on the DEPLOY path: refuses to build if a source `.env` is missing or still on the emulator fallback. |

## Emulator-bound suites — `npm run verify:emulator`

| Script | npm | What it decides |
|---|---|---|
| `e2e-verify.mjs` | `e2e` | The full lifecycle as isolated scenarios, plus the sanitizer allowlist, the authz denial matrix, the leaderboard oracle and the callable-coverage guard. |
| `test-rules.mjs` · `test-storage-rules.mjs` | `test:rules` · `test:rules:storage` | Firestore and Storage security rules. |
| `run-rules-suites.mjs` | `test:rules:both` | Both rules suites inside ONE lighter emulator boot. |
| `check-doc-cache-emulator.ts` | (in `verify:emulator`) | Single-process integration check for the document read cache. |
| `simulate-run.mjs` | `simulate` | N teams play a real game concurrently, then leaderboard invariants + station counters are audited. |
| `simulate-adversarial.mjs` | `simulate:adversarial` | The same, with a share of the teams cheating. |
| `simulate-browser-run.mjs` | `simulate:browser` · `verify:browser` | Playwright + synthetic GPS: the real client, not a callable harness. |
| `simulate-tournament.mjs` | `simulate:v1` | **Archived** v1 tournament sim. |

## Local development

| Script | npm | Purpose |
|---|---|---|
| `dev-emulator.mjs` | `emulator` | Boots the Emulator Suite: finds a JDK >= 21, builds functions first, imports/exports `.firebase/emulator-data`. |
| `free-ports.mjs` | `predev:all`, `preplaytest` | Kills stale Vite/emulator processes. Spares anything a still-running gate session owns. |
| `seed-local.mjs` | `dev:seed` | Seeds only if empty: demo creator, demo game, a live run + access code. |
| `seed-emulator.ts`, `seed-games-youth.mjs`, `seed-site-templates.ts`, `seed-quick-setup-demo*.mjs`, `sansana-game.mjs`, `qa-game.mjs` | `qa:seed`, `qa:simulate`, `seo:build` | Extra fixtures: youth games, the site's ready-made templates, the Quick Setup demos, the Sansana night game, the QA playground. |
| `emulator-exec.mjs` | (in the gauntlets) | Hardened `firebase emulators:exec`; honours `RUSHPOINT_EMULATOR_PORT_OFFSET`. |
| `emulator-backup.mjs` · `emulator-restore.mjs` | `emulator:backup`, `emulator:restore*` | Crash-safe rotating snapshots of emulator data. |
| `reset-teams.mjs` | `reset:teams` | Clears teams from a local run so a fixture can be replayed. |
| `preflight-game.ts` | `preflight` | Checks that one authored game is launch-ready. |
| `dump-task-bank.ts` | — | Dumps the mission bank as a reviewable markdown table. |

## Playtest over a tunnel

| Script | npm | Purpose |
|---|---|---|
| `proxy.mjs` | (in `playtest*`) | Single-origin reverse proxy fronting both apps and the backend. |
| `ngrok-tunnel.mjs` | `playtest:ngrok` | Fixed-URL tunnel in front of the proxy. |
| `print-playtest-links.mjs` | (in `playtest*`) | Prints the real creator + join links. |
| `playtest-forever.mjs` | `playtest:forever`, `playtest:stop` | Supervisor that keeps the playtest up independently of any editor. |
| `playtest-autostart.ps1` · `.vbs` · `playtest-oldpc-setup.*` | `autostart:*` | Unattended setup and boot on the spare Windows machine that hosts the tunnel. |
| `hosting-mode.mjs` | `hosting:tunnel`, `hosting:firebase` | Switches Firebase Hosting between the tunnel stub and the real sites. |

## Deploy, store and operations

| Script | npm | Purpose |
|---|---|---|
| `deploy-functions.mjs` | `deploy:fn` | Deploys ONE function instead of rebuilding all of them. |
| `cost-preflight.mjs` | `cost:preflight` | Cost sanity check before an expensive deploy. |
| `gen-pwa-icons.mjs` | `icons` | Renders both apps' raster PWA icons from each app's single source SVG. |
| `gen-play-assets.mjs` · `gen-play-screenshots.mjs` · `check-play-store.ts` · `patch-twa-target-sdk.mjs` · `gen-assetlinks.mjs` | `play:*` | Google Play TWA: listing assets, screenshots, the pre-submission gate, the Android target SDK patch, and Digital Asset Links. See [PLAY_STORE.md](../PLAY_STORE.md). |
| `build-landing-pages.ts` | `seo:build` | Writes the static SEO landing pages and the participant origin's sitemap. |
| `export-emails.mjs` | `emails:export` | Mailing-list export. |
| `sync-sheets.mjs` · `push-sheet.mjs` · `mirror.mjs` | `sync`, `push:sheet`, `mirror`, `dev:mirror` | Google Sheet to Firestore mirroring: one-shot, and the live watcher. |
| `backfill-public-tasks.mjs` | `backfill:public-tasks` | Repairs legacy `publicTasks` docs. **Dry-run by default**; runbook in DEPLOY.md section 11. |
| `diagnose-task-media.mjs` | `diagnose:task-media` | Finds and recovers task media whose Firestore reference was lost. |
| `check-upload-health.mjs` | `upload:check`, `upload:check:local` | End-to-end upload check against a real running API origin. |
| `grant-admin-claim.mjs` | — | Grants the `admin` custom claim to a uid. |
| `measure-location-cost.mjs` + `fs-ops-report.mjs` | `measure:location`, `fsops:report` | The Firestore op counter: drives the ping patterns and aggregates the `fsops` log records. |
| `run-prod-sim.sh` · `prod-sim-prepare.mjs` · `prod-sim-watchdog.sh` · `simulate-prod.mjs` | `simulate:prod` | Load simulation against the real VPS rather than the emulator. |

## One-off programs, kept as a record

These already ran. None is wired to an npm script and nothing imports them.

| Script | What it did |
|---|---|
| `apply-nogar-fixes-prod.cjs` · `apply-nogar-round2-prod.cjs` · `apply-nogar-round3-prod.cjs` | [one-off] Three rounds of reviewed content fixes to the LIVE "משחק לנוער" (11-13) template. Round 1 is referenced by [docs/quick-setup-audit-playbook.md](../docs/quick-setup-audit-playbook.md). |
| `apply-spy-protocol-fixes-prod.cjs` | [one-off] The same treatment for the LIVE "פרוטוקול האפלה" template. |
| `seed-real-template-review.mjs` · `seed-spy-protocol-review.mjs` | [one-off] Seeded an exported `.rushpoint.json` locally so those templates could be reviewed. |
| `export-tunnel-games.cjs` · `import-games-to-prod.cjs` | [one-off] Recovery pair: pulled authored games out of the playtest tunnel's emulator and wrote them to production. |
| `backfill-active-task.mjs` | [one-off] Backfilled the station-occupancy index. |
| `verify-skip.mjs` · `verify-writeback.mjs` | [one-off] Focused verifications written while building station-aware skip scoring and the Sheet write-back path. |
| `tmp-inventory.ts` | [one-off] Scratch inventory of the mission bank. |

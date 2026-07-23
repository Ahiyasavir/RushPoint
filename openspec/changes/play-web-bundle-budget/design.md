## Context

`apps/play-web` is a Vite 5 PWA. It has no `manualChunks` configuration: every emitted chunk other
than the entry exists because a module is reached exclusively through a dynamic `import()`. That
makes the chunk list an accurate, mechanical readout of which boundaries are lazy — and it makes the
whole structure one static `import` away from collapsing, with no build error and no gate failure.

Measured in this working tree with `npm run play:build`, then read from `apps/play-web/dist` as real
bytes on disk (gzip level 9). Vite's own console numbers are computed from JS string length, which
undercounts multi-byte characters — this app's dictionaries are Hebrew, so Vite reports **895.39 kB**
for an entry chunk that is really **902,928 bytes** on the wire. The check uses disk bytes.

**play-web — every emitted asset**

| Asset | Raw | Gzip | Loaded |
|---|---:|---:|---|
| `index-*.js` | 902,928 | 236,157 | entry |
| `index-*.css` | 38,947 | 7,199 | entry |
| `index.html` | 2,512 | 889 | entry |
| `NavMap-*.js` | 808,644 | 219,614 | lazy (MapLibre) |
| `NavMap-*.css` | 65,483 | 9,165 | lazy (MapLibre CSS) |
| `QrScanner-*.js` | 132,087 | 47,916 | lazy (jsqr) |
| `brandWatermark-*.js` | 25,709 | 10,118 | lazy (qrcode) |
| `StaffConsole-*.js` | 14,872 | 4,875 | lazy route |
| `CeremonyScreen-*.js` | 7,695 | 2,912 | lazy route |
| `FeedPanel-*.js` | 6,939 | 2,545 | lazy |
| `ChallengeTeaser-*.js` | 6,132 | 2,592 | lazy route |
| `PublicLeaderboardScreen-*.js` | 6,026 | 2,156 | lazy route |
| `GamePromoScreen-*.js` | 5,879 | 2,263 | lazy route |
| `RunRecap-*.js` | 5,141 | 2,240 | lazy route |
| `TvLeaderboard-*.js` | 3,560 | 1,424 | lazy route |
| `storyCard-*.js` | 2,777 | 1,314 | lazy (canvas share card) |
| `ChatPanel-*.js` | 2,324 | 1,173 | lazy |
| `podiumCard-*.js` | 2,124 | 1,085 | lazy (canvas) |
| `sharePhoto-*.js` | 1,278 | 670 | lazy |

**creator-web, for comparison:** entry `index-*.js` 932,642 raw / 248,613 gzip; entry CSS 58,745 /
11,430; `MapModeToggle-*.js` (MapLibre) 803.25 kB raw per Vite / 218.38 kB gzip; `BuilderPage-*.js`
193.64 kB / 57.42 kB.

**What is actually inside the play-web entry chunk** (rendered module bytes, pre-minification,
obtained from a throwaway Rollup `generateBundle` plugin run against a scratch `outDir` and then
deleted — no repo file was left modified):

| Group | Rendered bytes |
|---|---:|
| `@firebase/firestore` | 814,662 |
| `@firebase/auth` | 255,248 |
| `react-dom` | 134,882 |
| `@firebase/storage` | 110,732 |
| app `components/` | 91,593 |
| app `screens/` | 78,956 |
| `@firebase/webchannel-wrapper` | 53,650 |
| app `i18n.ts` | 43,404 |
| `@firebase/app` + `util` + `functions` + `component` + `logger` | 108,057 |
| app `lib/` | 18,545 |
| `packages/shared` | 14,108 |
| `idb`, `react`, `scheduler`, `tslib`, misc | 24,578 |

Three facts follow, and they shape the design:

1. **The entry chunk is ~75% Firebase SDK.** Application code is roughly 250 KB of 1.78 MB rendered.
   A feature-sized change moves the needle by a few kilobytes; a collapsed lazy boundary moves it by
   hundreds. A budget with modest headroom is therefore a sharp instrument, not a noisy one.
2. **The lazy boundaries hold today.** `grep -ci` over the emitted entry chunk finds **0** hits for
   `maplibre`, `mapbox`, `jsqr` and `QRCode`. `packages/shared` contributes only 14 KB and
   tree-shakes correctly: `mapStyle.ts` lands in the `NavMap` chunk, `qrPayload.ts` in `QrScanner`,
   `shareBranding.ts` in `brandWatermark`, and creator-only helpers (`gameFile.ts`,
   `publicTaskLocation.ts`) do not reach play-web at all.
3. **Bytes are not enough on their own.** The smallest deferred heavy dependency (`qrcode`, 10,118
   gzip bytes as `brandWatermark`) is smaller than any headroom worth having. A byte budget alone
   would let it drift into the entry unnoticed. Hence a second, size-independent check.

Hard constraint: **a live playtest stack is serving from this tree.** No emulator, Vite server,
tunnel or backup process may be started, stopped or restarted. Production builds write only to
`dist/` and are safe; `npm run e2e`, `verify:emulator`, `test:rules` and `shared:build` are not run.

## Goals / Non-Goals

**Goals:**
- Make an increase in the participant app's first-load payload fail a command, with a report that
  names the asset, the measured value, the limit and the overage.
- Make "MapLibre / jsqr / qrcode are lazy" a checked property rather than a convention.
- Keep every decision in a **pure total function** of `(assets, markers, policy)` so the adversarial
  cases are unit-tested without a build.
- Set a number that is a ratchet: passes today's tree and normal feature work, fails a structural
  regression.

**Non-Goals:**
- No product code, callables, rules, UI or i18n.
- No change to chunking strategy, lazy boundaries, or the service worker.
- No timing measurement. Bytes only.
- No edit to the root `verify` chain (owned elsewhere during this change).

## Decisions

### D1 — Two independent checks, not one

The guard runs a **byte budget** and a **forbidden-marker scan** side by side, and fails if either
fails. The byte budget catches slow accretion and large collapses; the marker scan catches a heavy
dependency small enough to hide inside the headroom. Neither subsumes the other, so both exist.

Markers are matched case-insensitively against the entry chunk's text: `maplibre`, `mapbox`, `jsqr`,
`qrcode`. All four are absent today (0 hits). Minified code retains these strings — MapLibre ships
attribution/style URLs and error text containing `maplibre`/`mapbox`, jsqr's package identifier
survives in the chunk's own module comments, and `qrcode`'s error strings survive — so a hit is
evidence the dependency landed in the entry chunk, and their current zero count is the proof that
matching is not producing false positives on today's tree.

*Rejected:* parsing the module graph (a Rollup plugin or `--sourcemap` + source-map attribution).
More precise, but it requires either a permanent build-config change or a second build, and it
couples the guard to Vite internals. A text scan over the emitted entry chunk needs neither and is
what a browser actually downloads.

### D2 — Budget on gzip bytes primarily, raw bytes as a secondary bound

Gzip is what crosses the network (Firebase Hosting and the playtest tunnel both compress), so it is
the primary limit. Raw bytes are also bounded, because raw size drives parse/compile cost on the
low-end Android phones this app targets, and a change that is compression-friendly but parse-heavy
would otherwise slip through.

Gzip level 9 is used for determinism: the check computes it itself with `zlib.gzipSync` rather than
trusting the CDN or Vite's default level, so the number does not move when a tool changes defaults.

### D3 — The budget number and its rationale

| Check | Measured today | Budget | Headroom |
|---|---:|---:|---:|
| Entry JS, gzip | 236,157 | **255,000** | +8.0% |
| Entry JS, raw | 902,928 | **975,000** | +8.0% |
| Initial payload (entry JS + entry CSS), gzip | 243,356 | **262,000** | +7.7% |

~8% was chosen from the shape of the data, not by taste:

- **Large enough not to be a nuisance.** 18.8 KB of gzip headroom is many features' worth of app
  code, given that all application code together is ~250 KB *rendered, pre-minification* — the whole
  `screens/` directory is 79 KB rendered. Ordinary work will not approach it.
- **Small enough to catch every structural regression by size alone.** The lazy chunks are 219.6 KB
  (MapLibre) and 47.9 KB (jsqr) gzip. Either one arriving in the entry overshoots the budget by an
  order of magnitude. A collapsed route split (StaffConsole 4.9 KB, Ceremony 2.9 KB, …) would need
  four or more simultaneous collapses to trip it — which is exactly why D1's marker scan exists for
  the small-but-heavy case, and why route chunks are not individually budgeted (they are lazy by
  construction and individually negligible).
- **A ratchet, not a target.** When a deliberate increase lands, the number is lowered or raised in
  one place with a one-line note; it is never "temporarily" disabled.

The initial-payload budget deliberately excludes `index.html` (889 gzip bytes, and it varies with
the hashed filenames it references) and excludes the lazy `NavMap-*.css`, which is fetched with the
map chunk and not at first paint.

### D4 — Pure core, thin runner

`scripts/lib/bundleBudget.mjs` (pure, no I/O, no `Date.now()`):

- `selectAsset(assets, pattern)` → `{ asset }` or a typed problem (`missing`, `ambiguous`). A build
  that emits **no** entry chunk, or **two**, must fail loudly — silently passing an empty asset list
  is exactly how a budget check rots into a no-op.
- `evaluateBundleBudget({ assets, markers, policy })` → `{ ok, checks, report }`, where each check is
  `{ name, kind, actual, limit, ok, detail }`. Total: every input maps to an explicit check result.
- `formatBudgetReport(result)` → a deterministic, sorted, human-readable table.

`scripts/check-bundle-budget.mjs` (I/O only): reads `apps/play-web/dist` (and `apps/creator-web/dist`
for the informational section), computes raw + gzip sizes, counts markers in the entry chunk, calls
the pure function, prints the report, exits non-zero on failure. If `dist/` is absent it fails with
"run `npm run play:build` first" rather than passing vacuously.

### D5 — Ambiguity fails; unknown fails

Every ambiguous state is a failure, never a pass:

- no matching entry asset → fail;
- more than one matching entry asset → fail (the pattern has stopped identifying the entry);
- a `gzipBytes` that is `undefined`/`null`/`NaN`/negative → fail as `unknown`, never treated as 0.

A guard that passes when it cannot measure is worse than no guard, because it is believed.

### D6 — Comparison is `<=`, and the boundary is tested

`actual <= limit` passes; `limit + 1` fails. Off-by-one in a budget is the difference between a
noisy gate and a blind one, so both sides of the boundary are explicit test cases.

### D7 — creator-web is reported, not gated

The creator console is desktop-first, is not the field-critical surface, and is under concurrent
edit by other lanes while this change is authored. Its numbers appear in the report (a shared-package
regression shows up in both apps, which is diagnostically useful) but never fail the command.

### D8 — Wiring is recommended, not performed

The check ships as `npm run bundle:budget --workspace=@rushpoint/scripts`. Root `package.json` is
owned elsewhere for the duration of this change, so the root alias and the `verify` chain entry are
**recommended in the report**, not edited here. The check is useless if nobody runs it, so this is a
deliberate hand-off, not an omission.

### D9 — Reduction opportunities recorded, not taken

`@firebase/storage` is 110,732 rendered bytes in the entry chunk because
`apps/play-web/src/services/firebase.ts` imports it statically at module scope (`getStorage(app)` at
line 84, plus the emulator/tunnel wiring right below it) while it is only needed when a player
submits a photo or audio mission. Deferring it behind a dynamic `import('firebase/storage')` inside
the upload path is a real ~25 KB gzip win. It is **not** done here: that module is on the live
playtest serving path, its emulator/tunnel wiring is order-sensitive, and there is no way to verify
an upload end-to-end without touching the running stack. Recorded as a follow-up with its evidence
so it is not rediscovered from scratch.

## Test Strategy

**Lane: pure logic** — `scripts/test-bundle-budget.ts`, run by the `npm test` aggregator
(`scripts/run-unit-tests.mjs`). House style of `scripts/test-emulator-backup.ts`: `ok(cond, msg)`,
`passed`/`failed` counters, `process.exit(failed ? 1 : 0)`. **Synthetic fixtures only** — the test
never reads `dist/`, so it cannot be made green or red by a stale build and runs with no build at
all. RED first: written against exports that do not yet exist, confirmed failing for that reason,
before `scripts/lib/bundleBudget.mjs` is written.

Cases the test encodes:

*Asset selection*
1. Exactly one match → selected.
2. No match → `missing` problem, `ok === false`, report says which pattern found nothing.
3. Two matches → `ambiguous` problem, `ok === false`, both names in the report.
4. Non-entry assets present (lazy chunks, CSS, html) → ignored by an entry-JS pattern.

*Byte budget boundaries*
5. `actual === limit` → pass (both gzip and raw).
6. `actual === limit + 1` → fail, and the report states the overage in bytes and percent.
7. `actual === limit - 1` → pass.
8. Zero-byte asset → pass the budget (it is not the budget's job to catch an empty build; case 2's
   sibling — an *absent* asset — is what fails).
9. Initial payload = entry JS + entry CSS, summed, compared once; a CSS-only growth that pushes the
   sum over fails even though the JS check passes.

*Unknown / malformed input*
10. `gzipBytes: undefined` → fail as `unknown`, never coerced to 0.
11. `gzipBytes: NaN` and `bytes: -1` → fail as `unknown`.
12. Empty asset list → fail (missing entry), never a vacuous pass.

*Forbidden markers*
13. All markers at count 0 → pass.
14. One marker with count > 0 → fail, naming that marker and the chunk.
15. Several markers positive → all of them named; the check does not stop at the first.
16. A marker absent from the input entirely → fail as `unknown` (the runner promised to measure it
    and did not), not a silent pass.

*Totality and report*
17. Every policy entry produces exactly one check; `checks.length` equals the expected count and
    `ok === checks.every(c => c.ok)` on every case.
18. `formatBudgetReport` is deterministic: same input → identical string; it contains every check
    name, and a failing run's report contains the word `FAIL` for exactly the failing checks.

**Lane: real build (manual, recorded here — not automated in the pure lane).** `npm run play:build`
and `npm run creator:build`, then `npm run bundle:budget --workspace=@rushpoint/scripts` against the
real `dist/` output; the check must pass on the current tree with the D3 numbers, and must be shown
to fail when the budget is temporarily lowered below the measured value (proving it is not a no-op).

**Gates:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
`npm run creator:build`. `npm run e2e` / `verify:emulator` / `test:rules` are **not** run — a live
playtest stack is serving from this tree — and no emulator-bound behavior is touched by this change.

**Explicitly not verified:** real-device and real-network cold-start timing. Nothing in this
environment can measure how long a phone on congested mobile data takes to become interactive, and
no such number is claimed anywhere in this change.

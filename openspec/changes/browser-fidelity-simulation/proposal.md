## Why

Our automated coverage is deep at the callable layer (`npm run e2e`, `npm run simulate`, the property/adversarial lanes) and shallow at the browser layer (`npm run test:ui` only render-smokes two screens). Nothing exercises a **full multi-team run through the real play-web UI** with realistic device conditions — so a whole class of defects is invisible to CI: geofence check-ins that pass a direct callable but fail against a real GPS drift/accuracy stream, UI/state bugs (a button that never enables, a task card that renders the wrong control, a map that swallows a tap), and connectivity regressions in the offline hardening (persistentLocalCache, service worker, `ConnectionBanner`). Today the only way to catch these is humans with phones in the field. We want a computer-runnable simulation that closes most of that gap.

## What Changes

- New script `scripts/simulate-browser-run.mjs` (`npm run simulate:browser`, `--teams=N`) that drives **N concurrent real play-web sessions** through Playwright — one isolated `BrowserContext` per virtual team (own anonymous auth, own emulated device, own simulated GPS), each playing the **real UI** (taps, forms, map, task cards), not the callable API directly.
- **Per-team simulated GPS as a live stream**, not a single teleport: each team walks a real game route with realistic per-fix jitter and drift, gradually interpolating between task stops, injected via CDP `Emulation.setGeolocationOverride` (driven by `context.setGeolocation` + `grantPermissions(['geolocation'])`) on a ticking timer so `watchPosition` consumers (TaskRunner, PlayScreen) see motion — exercising geofence auto-check-in and the GPS-accuracy/`gpsError` paths.
- **Network-condition injection** via CDP: each team toggles offline / degraded network at scripted points to exercise the offline banner, service-worker app-shell, and `persistentLocalCache` recovery, then asserts the team still converges to `finished`.
- **Mobile device emulation** (viewport + touch + userAgent) per context so tap targets, RTL layout, and the lazy map chunk are exercised at real phone dimensions.
- **All task types** covered end-to-end through the UI: `field`, `geofence`, `self_report`, `smart_station`, `photo`, `quiz`, `numeric`, `sequence` — the run's game template seeds at least one of each, and the per-team driver knows how to satisfy each control from the DOM.
- **Same invariant audit as `npm run simulate`** at the end: leaderboard oracle (one entry/team, contiguous ranks, finite non-increasing scores), live/final parity, score conservation, and **every `run.taskCounts` station counter back to 0** (no leaked slots) — plus new browser-only assertions (no uncaught page errors, no white-screen crash, every team reached `finished` through the UI).
- **Stable DOM selectors**: add `data-testid` hooks to the play-web task controls the driver must target (task card, per-type submit control, join CTA, offline banner), routed so they don't affect users. This is the only product-code change; it touches `apps/play-web` UI, so the i18n gate applies.
- Wire the new script into `package.json` (`simulate:browser` + optional inclusion in a `verify:browser` convenience gate). It is **opt-in** (not added to the blocking `verify` gauntlet) because it needs Chromium + a booted emulator.

## Capabilities

### New Capabilities
- `browser-fidelity-simulation`: A computer-runnable, browser-level multi-team run simulation that drives the real play-web UI under emulated mobile devices, streamed simulated GPS, and injected network conditions, then audits run-integrity invariants — catching geofence-accuracy, real-UI/state, and connectivity defects the callable-only e2e and load sim cannot, without humans in the field.

### Modified Capabilities
<!-- No existing spec's REQUIREMENTS change. The play-web data-testid additions are non-behavioral render hooks, not a spec-level behavior change. -->

## Impact

- **New:** `scripts/simulate-browser-run.mjs`; `package.json` scripts (`simulate:browser`, optional `verify:browser`); possibly a small shared route-geometry/GPS-drift helper if reused by tests.
- **Modified (product):** `apps/play-web/src` task-runner + join + connection-banner components gain `data-testid` attributes (render-only; i18n gate + `npm run i18n:check` still apply since UI files are touched).
- **Reuses:** the existing Firebase emulator suite, the `simulate-run.mjs` game-template + audit patterns, Playwright (already a devDependency, `@playwright/test` in `apps/play-web`), and `playwright.config.ts` device presets.
- **No backend/callable changes**, no Firestore rules changes, no new server state — the simulation only reads/plays through existing callables via the UI. The callable-coverage guard is unaffected.
- **CI:** not added to the blocking `verify` gate (needs a browser + emulator); runnable standalone and via a new `verify:browser` convenience script, mirroring how `verify:emulator` self-boots the suite.

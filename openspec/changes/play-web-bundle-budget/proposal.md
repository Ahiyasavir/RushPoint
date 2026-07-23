## Why

`apps/play-web` is loaded by real participants outdoors, on their own phones, on congested or weak
mobile data, frequently mid-game. A slow first load is not a polish issue — it is a team standing
still in a field. The repo already has the rule that heavy dependencies (MapLibre) stay behind
`React.lazy`, but **nothing in the gate chain can tell whether that rule still holds.** A single
static `import` anywhere in the module graph collapses a code-split silently: the build still
succeeds, `npm run verify` still passes, and the entry chunk quietly grows by hundreds of kilobytes.

Measured in this working tree (`npm run play:build`, real bytes on disk, gzip level 9):

| Asset | Raw bytes | Gzip bytes |
|---|---:|---:|
| `dist/assets/index-*.js` (entry) | 902,928 | 236,157 |
| `dist/assets/index-*.css` (entry) | 38,947 | 7,199 |
| **Initial payload (entry js + css)** | **941,875** | **243,356** |
| `NavMap-*.js` (MapLibre, lazy) | 808,644 | 219,614 |
| `QrScanner-*.js` (jsqr, lazy) | 132,087 | 47,916 |
| `brandWatermark-*.js` (qrcode, lazy) | 25,709 | 10,118 |

The lazy boundaries currently **hold** — MapLibre, jsqr and qrcode are each in their own chunk and
appear nowhere in the entry chunk. That is precisely the state worth freezing: today's numbers are
the baseline a regression would have to beat, and there is no mechanism keeping it that way.

The size numbers alone are not a sufficient guard. The smallest deferred heavy dependency
(`qrcode`, ~10 KB gzip) is smaller than any usable size headroom, so an accidental eager import of
it would slip under a pure byte budget. A regression guard therefore needs two independent checks:
a byte budget **and** a direct assertion that named heavy dependencies are absent from the entry
chunk.

## What Changes

**The participant app gains a bundle budget that fails loudly when the first load gets heavier.**
- The built output of `apps/play-web` is checked against an explicit, documented byte budget for the
  entry chunk and for the total initial payload, in both raw and gzipped bytes.
- The check is a **ratchet**, not an aspiration: the budget sits slightly above today's measured
  size, so ordinary work passes and a structural regression (an eagerly imported heavy dependency,
  a collapsed code split) fails immediately.

**Lazy boundaries become an asserted property, not a convention.**
- Named heavy dependencies (`maplibre-gl`, `jsqr`, `qrcode`) are checked for **absence from the
  entry chunk** independently of size, so a small-but-heavy dependency drifting into the entry
  cannot hide under the byte headroom.

**The decision is a pure, testable function.**
- Given a list of `{file, bytes, gzipBytes}`, a list of marker hits, and a budget policy, a pure
  function returns pass/fail plus a human-readable report. All of the adversarial cases (no entry
  chunk emitted, two entry chunks, exactly-at-budget, one byte over, unknown gzip size) are decided
  there and unit-tested with synthetic fixtures — no build required.

**The creator app is measured but not gated.**
- `apps/creator-web` figures in the report for comparison and to catch a shared-package regression,
  but only the participant app's budget fails the check. The creator console is desktop-first and is
  under active concurrent edit; gating it would fail other people's work for a non-field-critical
  surface.

### Non-goals

- **No product behavior changes.** No callables, no Firestore rules, no `packages/shared` types, no
  UI, no i18n, no service-worker behavior change.
- **Not a performance budget.** This measures bytes, not milliseconds. Real-device and real-network
  cold-start timing cannot be measured in this environment and is explicitly out of scope.
- **Does not change the chunking strategy.** No `manualChunks`, no vendor splitting, no change to
  which modules are lazy. It freezes today's structure; changing it is a separate change.
- **Does not modify the root `verify` chain.** The check ships as a standalone command; wiring it
  into `npm run verify` is recommended, not performed, because root `package.json` is owned
  elsewhere while this change is authored.
- **Does not shrink anything.** Identified reduction opportunities (notably Firebase Storage in the
  entry chunk) are recorded as recommendations, not implemented, because the module that would
  change is on the live playtest serving path.

## Capabilities

### New Capabilities

- `play-web-bundle-budget`: The participant app's built output is checked against an explicit byte
  budget for its entry chunk and initial payload, and against a set of heavy dependencies that must
  not appear in that entry chunk. The pass/fail decision is a pure function of the emitted asset
  sizes, the marker hits and the policy, and it produces a readable report of every check with its
  measured value, its limit and its headroom — so a failure names the asset, the number and the
  amount by which it went over.

## Impact

- **Surfaces touched:** `scripts/` only — build-verification infrastructure. **No** shared types,
  **no** callables, **no** Firestore rules, **no** creator-web or play-web source, **no** i18n.
- **Files:** `scripts/lib/bundleBudget.mjs` (new, pure), `scripts/check-bundle-budget.mjs` (new,
  I/O runner), `scripts/test-bundle-budget.ts` (new, picked up by the `npm test` aggregator),
  `scripts/package.json` (one new script entry).
- **New env vars:** none.
- **Risk:** a budget set too tight blocks unrelated work; a budget set too loose never fires. Both
  are mitigated by deriving the number from a measurement recorded in `design.md`, by stating the
  headroom percentage explicitly, and by pairing the byte budget with the size-independent marker
  check that catches exactly the regressions a loose budget would miss.
- **Testing:** pure-logic lane (`scripts/test-bundle-budget.ts`, synthetic fixtures only — it never
  reads `dist/`), plus running the real check against the real build output of both apps. Real
  device / real network load timing is **not** verifiable in this environment and is not claimed.

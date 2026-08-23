# Design — playtest-build-isolation

## 1. The collision, traced end to end

```
npm run playtest:prod            (scripts/playtest-forever.mjs, TARGET default)
  └─ playtest:build              vite build --mode playtest   → apps/*/dist
  └─ playtest:creator:preview    vite preview --mode playtest ← apps/creator-web/dist   :5180
  └─ playtest:play:preview       vite preview                 ← apps/play-web/dist      :5181
  └─ node scripts/proxy.mjs      :3000  →  resolveProxyTarget(url)
  └─ node scripts/ngrok-tunnel.mjs      throwing-unrelated-traps.ngrok-free.dev → :3000

npm run verify
  └─ creator:build               vite build                   → apps/creator-web/dist   ⚠ same dir
  └─ play:build                  vite build                   → apps/play-web/dist      ⚠ same dir
  └─ bundle:budget               reads apps/play-web/dist
```

`resolveProxyTarget` (`packages/shared/src/*`, consumed by `scripts/proxy.mjs:29`) sends `/creator*`
to :5180 and **everything else** to :5181. So the routing contract for the creator artifact is not a
preference, it is load-bearing: every asset URL it emits must live under `/creator/`.

Two orthogonal properties are baked into the bytes at build time, and `--mode playtest` is the only
switch for both:

| Property | Source | `--mode playtest` | plain `vite build` |
|---|---|---|---|
| creator asset base | `apps/creator-web/vite.config.ts:13` | `/creator/` | `/` |
| Firebase target | `isEmulatorBuild`, `packages/shared/src/env.ts:14` | local emulator | real Firebase |

The observed failure was the first. The second is strictly worse and was latent: `play:build` emits
a bundle with `MODE === 'production'`, so `isEmulatorBuild` returns `false`, so participants' phones
would have been pointed at production Firebase, where anonymous auth is disabled. Both are silent —
the proxy returns `200` for the misrouted asset (play-web's SPA HTML), and the Firebase misconfig
only surfaces as a failed join on a stranger's phone.

Evidence that today's live artifact is the *playtest* one (so the last repair held):
`apps/creator-web/dist/index.html` currently carries
`<script type="module" crossorigin src="/creator/assets/index-Ce4z6HcG.js">`.

## 2. Chosen fix: a separate `outDir` — and why, over the alternatives

**Chosen: `build.outDir = mode === 'playtest' ? 'dist-playtest' : 'dist'` in both app configs, with
the playtest previews passing `--outDir dist-playtest` explicitly.**

The gate build and the playtest build become writes to *disjoint paths*. There is no ordering, no
timing and no flag a caller can forget that lets one overwrite the other. It fixes the base clobber
and the emulator-wiring clobber and the mid-session asset-hash churn with one mechanism, and it
leaves every existing consumer of `dist` (gate builds, `bundle:budget`, `firebase.json` hosting,
`deploy:hosting`) reading exactly what it reads today.

### `vite preview --outDir` is supported on the pinned Vite — verified in `node_modules`

`node_modules/vite/package.json` → `"version": "5.4.21"`.

`node_modules/vite/dist/node/cli.js:878` declares the option on the `preview` command:

```js
cli.command("preview [root]", "locally preview production build")
  .option("--host [host]", …).option("--port <port>", …).option("--strictPort", …)
  .option("--open [path]", …)
  .option("--outDir <dir>", `[string] output directory (default: dist)`)
  .action(async (root, options) => { … })
```

and `:890` shows the action feeding it straight into the resolved config the preview server serves
from:

```js
const server = await preview({
  root, base: options.base, configFile: options.config,
  logLevel: options.logLevel, mode: options.mode,
  build: { outDir: options.outDir },
  preview: { port: options.port, strictPort: options.strictPort, host: options.host, open: options.open },
});
```

The same file (`:806`) declares `--outDir` on `build`, so both halves of the pair are CLI-drivable.

Two sources of truth would normally be a smell, but here they are deliberately redundant and must
agree: the **config** decides the build output (so `npm run playtest:build` needs no extra flag and
cannot forget one), and the **CLI flag** pins the serve path (so the live preview's document root is
literally spelled out in the command that starts it, not inferred from a mode-dependent config
merge). `checkPlaytestScriptWiring` is what keeps the two honest.

### Rejected: make the base environment-driven at serve time

`vite preview` serves a *pre-built* `index.html`. The base is already interpolated into that file's
`src`/`href` attributes at build time; there is no serve-time rewrite hook in `vite preview`. Making
it serve-time would mean either rewriting HTML in `scripts/proxy.mjs` (a text-rewriting proxy in
front of real participants, on the hot path, for every navigation) or dropping `vite preview` for a
custom static server. Both are more moving parts in the component that must never break, and neither
addresses the emulator-wiring half of the problem, which is compiled into the JS chunk and cannot be
rewritten at serve time at all.

### Rejected: rebuild-on-boot so a clobbered dist self-heals

`scripts/playtest-forever.mjs` already rebuilds at boot and after every git update, which is exactly
why today's breakage lasted only until the next restart. It is a *repair* interval, not a fix: the
live site stays broken for the whole window between a gate build and the next restart, which is
unbounded (the supervisor deliberately does **not** restart on a timer). Keep it as the safety net
it already is; do not promote it to the fix.

## 3. `play-web` gets the same treatment, deliberately

`play-web`'s base is `/` in both modes, so the base half of the problem does not apply to it. Two
reasons to split it anyway:

1. `isEmulatorBuild` — §1's table. This is the more damaging clobber of the two, and it is play-web
   only. Participants are the population that cannot recover from it.
2. Content-hash churn. Even a *correct* rebuild renames every chunk; a phone holding the old
   `index.html` mid-game then 404s on its next lazy chunk (the map, the QR scanner).

`npm run bundle:budget` keeps pointing at `apps/play-web/dist`
(`scripts/check-bundle-budget.mjs:88`), which is still exactly the `npm run play:build` output — the
measurement is unchanged, and it is now *more* faithful, since a playtest build can no longer be the
thing it happens to measure.

## 4. The guard: what it decides, and from what

Pure module `scripts/lib/buildArtifactGuard.mjs`. No filesystem, no build, no network — the runner
supplies the bytes.

### `ARTIFACT_CONTRACT` — declared, never inferred

```
{ app: 'creator-web', outDir: 'dist',          base: '/',         audience: 'gate'     }
{ app: 'creator-web', outDir: 'dist-playtest', base: '/creator/', audience: 'playtest' }
{ app: 'play-web',    outDir: 'dist',          base: '/',         audience: 'gate'     }
{ app: 'play-web',    outDir: 'dist-playtest', base: '/',         audience: 'playtest' }
```

Following `scripts/lib/callableHardening.mjs`: an inferred contract cannot fail, because whatever
the code does becomes the expectation. Declaring it means a build that stops matching is a finding.

### `extractRootRefs(html)`

Every `<script>` / `<link>` tag's `src` or `href`, filtered to **root-absolute** references (`/…`,
excluding protocol-relative `//…`). That filter is what makes the check robust against the real
`index.html`, which also carries `https://fonts.googleapis.com/…` preconnects and absolute
`og:image` URLs — those are hand-authored and must not be base-prefixed. Everything Vite *does*
rewrite in `index.html` is root-absolute: the module script, the stylesheet, and the public-dir
`manifest.webmanifest` / `icon-192.png` / `icon.svg` / `apple-touch-icon` links. Verified against
both built files on disk.

### `checkBuiltBase({ label, html, expectedBase })`

| Code | Condition | Why it matters |
|---|---|---|
| `bad-expected-base` | base is not `/…/`-shaped | a caller passing garbage must fail, not pass vacuously |
| `no-asset-refs` | zero root-absolute refs | an empty/truncated/placeholder `index.html` must not pass |
| `wrong-base` | a ref does not start with `expectedBase` | **the blank-page condition** |
| `reserved-prefix` | base is `/` yet a ref starts with `/creator/` | the inverse clobber: a playtest build landed in a gate directory |

`no-asset-refs` is the reason the check cannot be satisfied by an empty file, which is the classic
way a "does every ref match?" predicate passes for the wrong reason.

### `checkPlaytestScriptWiring(scripts)`

Reads `package.json`'s `scripts` map and asserts the wiring invariant itself:

- `creator:build` and `play:build` exist and contain **no** `playtest` token — a gate build must
  never be a playtest build.
- `playtest:build` carries `--mode playtest` at least twice (once per app).
- `playtest:creator:preview` carries `--mode playtest` **and** `--outDir dist-playtest`.
- `playtest:play:preview` carries `--outDir dist-playtest`.
- No playtest preview may serve a bare `dist`.

This is the half a bytes-only check cannot cover: a preview re-pointed at `dist` would serve a
perfectly well-formed artifact — the *wrong* one.

## 5. Test strategy

| Lane | What | Where |
|---|---|---|
| Pure (`npm test`) | `extractRootRefs`, `checkBuiltBase` (all four codes, both bases, both apps), `checkPlaytestScriptWiring` on synthetic script maps, and on the **real** `package.json` | `scripts/test-build-artifact-guard.ts` |
| Built-artifact (`npm run verify`) | `checkBuiltBase` applied to whichever `apps/*/dist*/index.html` exist | `scripts/check-build-base.mjs` (`npm run base:check`) |

`package.json` is *source*, not build output, so asserting against the real one is deterministic and
cannot be made green by a stale build — the constraint `scripts/test-bundle-budget.ts` documents.
Built `index.html` files are the opposite, which is why they are checked by a runner in `verify`
(after the builds) and not by the pure lane, and why a **missing** directory is skipped rather than
failed: a fresh clone has no `dist` and must not fail `npm test`.

## 6. Migration and the live stack

The currently-running playtest is serving `apps/*/dist` and keeps doing so until it restarts —
this change cannot disturb it, because nothing here writes to a served directory or touches a
running process. On the next supervisor cycle (`playtest-forever.mjs` boot, git update, or crash
restart) `buildProd()` runs `playtest:build`, which now populates `dist-playtest`, and the preview
commands serve that. `distReady()` is updated in the same commit so the supervisor's
`retry-no-dist` / `launch-stale` decision keeps looking at the directory it will actually serve;
without that it could report "ready" on a stale gate `dist` and launch a preview onto an empty
playtest directory.

The stale `apps/*/dist` produced by past playtest builds is harmless: the gate rewrites it on the
next `creator:build` / `play:build`, and `check-build-base.mjs` expects base `/` there.

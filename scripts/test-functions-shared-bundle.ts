// Guard against the "functions bundles a STALE @rushpoint/shared" class of failure —
// the one that surfaced as a live 500 INTERNAL on the creator gallery, where
// searchGallery called a shared export (applyGalleryFacets) that esbuild had bundled
// as `undefined`.
//
// functions/ builds with `esbuild --bundle` and does NOT mark @rushpoint/shared
// external, so shared is INLINED into lib/index.js from packages/shared/dist AT BUILD
// TIME. esbuild does not fail on a missing named export — it emits `undefined`. So if
// functions is built while shared/dist is stale (i.e. BEFORE shared:build), the bundle
// freezes a shared missing the newest exports, and any callable that uses one throws at
// runtime → INTERNAL. This is invisible to `tsc --noEmit` (it type-checks against the
// current source, not the emitted bundle) and to esbuild's own exit code.
//
// Two invariants keep it from recurring, BOTH asserted from source (this file never
// reads a build artifact, so a stale build can neither make it green nor red):
//   1. shared is BUNDLED, not external — the deployed runtime has no separate shared to
//      resolve, so freshness is entirely a build-time property of the bundle.
//   2. the functions `build` rebuilds @rushpoint/shared FIRST (a prebuild hook), so the
//      inlined copy is always current no matter who invokes the build. This matters
//      because the direct `npm run build --workspace=functions` used by the playtest
//      auto-deploy supervisor and by `deploy` BYPASSES turbo's dependency ordering
//      (turbo would otherwise build shared first via the devDependency edge).
//
// Run by scripts/run-unit-tests.mjs via `npm test` (auto-discovered).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, '..', 'functions', 'package.json'), 'utf8'),
) as { scripts?: Record<string, string>; devDependencies?: Record<string, string>; dependencies?: Record<string, string> };

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const scripts = pkg.scripts ?? {};
const build = String(scripts.build ?? '');
const prebuild = String(scripts.prebuild ?? '');
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

// Invariant 0 — functions actually depends on shared (so the import resolves at all,
// and so turbo has an ordering edge for `turbo run build`).
ok('@rushpoint/shared' in deps, 'functions declares @rushpoint/shared as a (dev)dependency');

// Invariant 1 — shared is bundled inline, not resolved at runtime. If someone marks it
// --external the stale-inline risk vanishes but the PROD deploy breaks (the deployed
// function has no monorepo to resolve @rushpoint/shared from) — so the contract is
// explicitly "bundled".
ok(/--bundle\b/.test(build), 'functions build uses esbuild --bundle (shared is inlined)');
ok(
  !/--external:@rushpoint\/shared\b/.test(build),
  '@rushpoint/shared is bundled, NOT --external — a bundled shared is only ever as fresh as the build that inlined it',
);

// Invariant 2 — the functions build rebuilds @rushpoint/shared BEFORE esbuild runs, so
// a direct `npm run build --workspace=functions` (playtest supervisor / deploy) can
// never inline a stale shared. Accept either a prebuild hook or an inline shared build
// ahead of the esbuild call, as long as shared is genuinely rebuilt first.
const beforeEsbuild = build.split('esbuild')[0] ?? '';
const rebuildsSharedFirst =
  /packages\/shared|@rushpoint\/shared|shared:build/.test(prebuild) ||
  /packages\/shared|shared:build/.test(beforeEsbuild);
ok(
  rebuildsSharedFirst,
  'functions build rebuilds @rushpoint/shared before esbuild (prebuild hook or inline) — prevents inlining a stale shared → runtime undefined → 500 INTERNAL',
);

if (failed) {
  console.error(`\nFUNCTIONS SHARED-BUNDLE GUARD: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`✓ FUNCTIONS SHARED-BUNDLE GUARD: all ${passed} checks passed`);

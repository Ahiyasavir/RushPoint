// Pre-submission gate for the Google Play TWA (change: play-store-twa-packaging).
//   npm run play:store:check   (→ npx tsx scripts/check-play-store.ts)
//
// Loads the REAL repository files and runs the pure validators, so a broken or
// still-empty assetlinks.json, or a regressed web manifest, can't reach a Play
// upload unnoticed. Exits non-zero on any failure.
//
// NOTE: this is intentionally NOT a scripts/test-*.ts file — it is EXPECTED to
// report "not ready" while assetlinks.json is still the committed empty `[]`
// (before the signing key exists). That is the correct signal, not a test
// failure, so it stays out of the `npm test` aggregator.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateWebManifestForPlay, validateAssetLinks } from '../packages/shared/src/playStore';

const here = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(here, '..', 'apps', 'play-web', 'public', 'manifest.webmanifest');
const ASSETLINKS = join(here, '..', 'apps', 'play-web', 'public', '.well-known', 'assetlinks.json');

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

console.log('🏬 Google Play TWA pre-submission check\n');

let failed = false;

// 1) Web manifest install-readiness
try {
  const manifest = loadJson(MANIFEST);
  const res = validateWebManifestForPlay(manifest);
  if (res.ok) {
    console.log('✓ Web manifest is TWA/Play install-ready.');
  } else {
    failed = true;
    console.log('✗ Web manifest is NOT install-ready. Missing/non-conforming:');
    for (const m of res.missing) console.log(`    - ${m}`);
  }
} catch (e) {
  failed = true;
  console.log(`✗ Could not read/parse manifest.webmanifest: ${e instanceof Error ? e.message : String(e)}`);
}

// 2) Digital Asset Links
try {
  const assetlinks = loadJson(ASSETLINKS);
  const res = validateAssetLinks(assetlinks);
  if (res.ok) {
    console.log('✓ Digital Asset Links (assetlinks.json) is valid.');
  } else {
    failed = true;
    console.log('✗ Digital Asset Links (assetlinks.json) is NOT ready:');
    for (const p of res.problems) console.log(`    - ${p}`);
    console.log('    Fix: node scripts/gen-assetlinks.mjs --fingerprint=<your SHA-256>  (see PLAY_STORE.md)');
  }
} catch (e) {
  failed = true;
  console.log(`✗ Could not read/parse .well-known/assetlinks.json: ${e instanceof Error ? e.message : String(e)}`);
}

console.log(
  failed
    ? '\n✗ Play submission artifacts are NOT all ready (see above).'
    : '\n✓ Play submission artifacts are ready.',
);
process.exit(failed ? 1 : 0);

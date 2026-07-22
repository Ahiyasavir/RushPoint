// Generate apps/play-web/public/.well-known/assetlinks.json for the Google Play
// TWA (change: play-store-twa-packaging).
//
// Google verifies the play-web TWA against the web origin via this Digital Asset
// Links file. It ships as an empty `[]` (no fingerprint exists until the signing
// key is created), so a TWA build would fail origin verification until this runs.
//
// Usage (see PLAY_STORE.md for where the fingerprint comes from):
//   node scripts/gen-assetlinks.mjs --fingerprint=AA:BB:...:99
//   node scripts/gen-assetlinks.mjs --fingerprint=<upload-key> --fingerprint=<play-signing-key>
//   PLAY_SHA256_FINGERPRINT=AA:BB:...  node scripts/gen-assetlinks.mjs
//   node scripts/gen-assetlinks.mjs --package=app.rushpoint.play --fingerprint=...
//
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PLAY_PACKAGE_NAME, buildAssetLinks } from '@rushpoint/shared';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'apps', 'play-web', 'public', '.well-known', 'assetlinks.json');

const args = process.argv.slice(2);
function argValues(name) {
  return args
    .filter((a) => a.startsWith(`--${name}=`))
    .map((a) => a.slice(name.length + 3));
}

const pkg = argValues('package')[0] ?? PLAY_PACKAGE_NAME;
const fingerprints = argValues('fingerprint');
if (fingerprints.length === 0 && process.env.PLAY_SHA256_FINGERPRINT) {
  fingerprints.push(process.env.PLAY_SHA256_FINGERPRINT);
}

if (fingerprints.length === 0) {
  console.error(
    '✗ No SHA-256 fingerprint supplied.\n' +
      '  Pass --fingerprint=AA:BB:...:99 (repeatable) or set PLAY_SHA256_FINGERPRINT.\n' +
      '  Get the fingerprint from your signing keystore — see PLAY_STORE.md (keystore step).',
  );
  process.exit(1);
}

let statements;
try {
  statements = buildAssetLinks(pkg, fingerprints);
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify(statements, null, 2) + '\n', 'utf8');
console.log(`✓ Wrote ${OUT}`);
console.log(`  package: ${pkg}`);
console.log(`  fingerprints: ${statements[0].target.sha256_cert_fingerprints.length}`);
console.log('  Deploy this file at https://<origin>/.well-known/assetlinks.json and rebuild the TWA.');

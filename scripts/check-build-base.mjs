// Built-artifact base check (change: playtest-build-isolation).
//
//   npm run base:check          (runs inside `npm run verify`, after both builds)
//   node scripts/check-build-base.mjs
//
// Reads whichever apps/<app>/<outDir>/index.html exist and asserts that each
// one's asset base matches the path that directory is served from
// (ARTIFACT_CONTRACT). A directory that has never been built is SKIPPED, not
// failed — a fresh checkout has no dist.
//
// Why this exists: the failure it catches produces no error signal at all. A
// creator-web build with base `/` served through the playtest proxy has every
// `/assets/*` request routed to play-web (only `/creator*` reaches creator-web),
// play-web answers 200 with its own SPA HTML, and the live creator console is a
// blank page while every process is healthy. The separate outDir makes the
// collision impossible; this check makes a regression LOUD instead of invisible.
//
// All decision logic is pure and unit-tested in scripts/test-build-artifact-guard.ts
// (synthetic fixtures, no build needed). This file only reads files and prints.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTIFACT_CONTRACT, checkBuiltBase, formatProblems, entryDocuments } from './lib/buildArtifactGuard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('\n🔎 Built-artifact base check (asset base vs. serve path)\n');

let failures = 0;
let checked = 0;
let skipped = 0;

for (const artifact of ARTIFACT_CONTRACT) {
  // Usually one document, the root index.html a Vite app emits. The marketing
  // site has none (its `/` is a Hosting redirect), so it names its own entry
  // documents; without that it would look "not built" and be skipped silently.
  for (const entry of entryDocuments(artifact)) {
  const suffix = entry === 'index.html' ? '' : ` (${entry})`;
  const label = `${artifact.app}/${artifact.outDir}${suffix}`;
  const indexPath = path.join(root, 'apps', artifact.app, artifact.outDir, ...entry.split('/'));

  if (!fs.existsSync(indexPath)) {
    skipped += 1;
    console.log(`  ·  ${label.padEnd(30)} not built — skipped`);
    continue;
  }

  let html;
  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch (err) {
    failures += 1;
    console.error(`  ✗  ${label.padEnd(30)} could not be read: ${err.message}`);
    continue;
  }

  const res = checkBuiltBase({ label, html, expectedBase: artifact.base });
  checked += 1;
  if (res.ok) {
    console.log(`  ✓  ${label.padEnd(30)} base "${artifact.base}" (${res.refs.length} asset ref(s), ${artifact.audience})`);
  } else {
    failures += 1;
    console.error(`  ✗  ${label.padEnd(30)} expected base "${artifact.base}" (${artifact.audience})`);
    console.error(formatProblems(res.problems));
  }
  }
}

console.log('');
if (failures > 0) {
  console.error(`✗ ${failures} artifact(s) FAILED the base check (${checked} checked, ${skipped} skipped).`);
  console.error('');
  console.error('  Rebuild the affected artifact with the right mode:');
  console.error('    gate / deploy build  →  npm run creator:build   ·  npm run play:build   (writes dist)');
  console.error('    playtest build       →  npm run playtest:build                          (writes dist-playtest)');
  console.error('');
  process.exit(1);
}

console.log(`✓ ${checked} artifact(s) carry the base they are served from (${skipped} not built, skipped).\n`);

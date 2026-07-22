// Pure-logic test for Google Play TWA packaging helpers (change: play-store-twa-packaging).
// The play-web PWA reaches Google Play as a Trusted Web Activity: Google verifies
// the app against the web origin via a Digital Asset Links file, and the web
// manifest must meet PWA/TWA install criteria. These helpers build + validate both
// artifacts deterministically so a broken/empty assetlinks.json can't reach a
// Play upload unnoticed. No emulator.
//   npx tsx scripts/test-play-store.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PLAY_PACKAGE_NAME,
  normalizeFingerprint,
  isValidAndroidPackageName,
  buildAssetLinks,
  validateAssetLinks,
  validateWebManifestForPlay,
} from '../packages/shared/src/playStore';

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}
function throws(label: string, fn: () => unknown): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(label, threw);
}

// A valid SHA-256 fingerprint is 32 bytes = 64 hex chars.
const FP_RAW = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
const FP_CANON = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

// ── normalizeFingerprint ──────────────────────────────────────────────────────
check('normalize: colon-less lowercase → canonical uppercase colon form',
  normalizeFingerprint(FP_RAW) === FP_CANON);
check('normalize: already-colon uppercase is idempotent',
  normalizeFingerprint(FP_CANON) === FP_CANON);
check('normalize: whitespace tolerated',
  normalizeFingerprint('  ' + FP_RAW + '  ') === FP_CANON);
throws('normalize: too-short input throws', () => normalizeFingerprint('AA:BB:CC'));
throws('normalize: non-hex input throws', () => normalizeFingerprint('zz'.repeat(32)));

// ── isValidAndroidPackageName ─────────────────────────────────────────────────
check('pkg: canonical package accepted', isValidAndroidPackageName(PLAY_PACKAGE_NAME));
check('pkg: three-segment accepted', isValidAndroidPackageName('app.rushpoint.play'));
check('pkg: single-segment rejected', !isValidAndroidPackageName('rushpoint'));
check('pkg: empty rejected', !isValidAndroidPackageName(''));
check('pkg: leading-digit segment rejected', !isValidAndroidPackageName('app.1rushpoint.play'));

// ── buildAssetLinks ───────────────────────────────────────────────────────────
const single = buildAssetLinks(PLAY_PACKAGE_NAME, [FP_RAW]);
check('build: exactly one statement for one fingerprint', single.length === 1);
check('build: correct relation',
  JSON.stringify(single[0].relation) === JSON.stringify(['delegate_permission/common.handle_all_urls']));
check('build: android_app namespace', single[0].target.namespace === 'android_app');
check('build: package name carried', single[0].target.package_name === PLAY_PACKAGE_NAME);
check('build: fingerprint normalized into statement',
  single[0].target.sha256_cert_fingerprints[0] === FP_CANON);

const FP2_RAW = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const multi = buildAssetLinks(PLAY_PACKAGE_NAME, [FP_RAW, FP2_RAW]);
check('build: two fingerprints in one statement',
  multi.length === 1 && multi[0].target.sha256_cert_fingerprints.length === 2);
const dupe = buildAssetLinks(PLAY_PACKAGE_NAME, [FP_RAW, FP_CANON]);
check('build: duplicate fingerprints deduped',
  dupe[0].target.sha256_cert_fingerprints.length === 1);
throws('build: empty fingerprint list throws', () => buildAssetLinks(PLAY_PACKAGE_NAME, []));
throws('build: invalid package throws', () => buildAssetLinks('nope', [FP_RAW]));

// ── validateAssetLinks ────────────────────────────────────────────────────────
check('validate assetlinks: empty [] → invalid',
  validateAssetLinks([]).ok === false);
check('validate assetlinks: empty [] problem mentions statements',
  validateAssetLinks([]).problems.some((p) => /statement/i.test(p)));
check('validate assetlinks: generated payload → valid',
  validateAssetLinks(single).ok === true);
check('validate assetlinks: missing relation → invalid',
  validateAssetLinks([{ target: single[0].target }]).ok === false);
check('validate assetlinks: wrong namespace → invalid',
  validateAssetLinks([{ relation: single[0].relation, target: { ...single[0].target, namespace: 'web' } }]).ok === false);
check('validate assetlinks: empty fingerprints → invalid',
  validateAssetLinks([{ relation: single[0].relation, target: { ...single[0].target, sha256_cert_fingerprints: [] } }]).ok === false);
check('validate assetlinks: non-array → invalid',
  validateAssetLinks({} as unknown).ok === false);

// ── validateWebManifestForPlay ────────────────────────────────────────────────
const goodManifest = {
  name: 'RushPoint — Field Game',
  short_name: 'RushPoint',
  display: 'standalone',
  start_url: '/',
  theme_color: '#F97316',
  background_color: '#FBF7F0',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
check('manifest: full fixture passes', validateWebManifestForPlay(goodManifest).ok === true);

const noMaskable = { ...goodManifest, icons: goodManifest.icons.filter((i) => i.purpose !== 'maskable') };
const noMaskRes = validateWebManifestForPlay(noMaskable);
check('manifest: missing maskable icon fails', noMaskRes.ok === false);
check('manifest: missing-maskable names the field', noMaskRes.missing.some((m) => /maskable/i.test(m)));

const browserDisplay = { ...goodManifest, display: 'browser' };
const browserRes = validateWebManifestForPlay(browserDisplay);
check('manifest: display:browser fails', browserRes.ok === false);
check('manifest: display problem names display', browserRes.missing.some((m) => /display/i.test(m)));

const noName = { ...goodManifest, name: '' };
check('manifest: empty name fails', validateWebManifestForPlay(noName).ok === false);

const no512any = { ...goodManifest, icons: [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
] };
check('manifest: missing 512 any icon fails', validateWebManifestForPlay(no512any).ok === false);

// ── Real-file guard: the shipped play-web manifest must stay install-ready ─────
const here = dirname(fileURLToPath(import.meta.url));
const realManifestPath = join(here, '..', 'apps', 'play-web', 'public', 'manifest.webmanifest');
const realManifest = JSON.parse(readFileSync(realManifestPath, 'utf8'));
const realRes = validateWebManifestForPlay(realManifest);
check('manifest: shipped apps/play-web manifest.webmanifest passes',
  realRes.ok === true);
if (!realRes.ok) console.log('   missing:', realRes.missing.join(', '));

console.log(`\n${failures === 0 ? 'ALL PLAY-STORE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

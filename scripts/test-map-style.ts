// Characterization/regression lock for the map style resolver
// (change: map-provider-decision — keep MapLibre, zero-config guarantee).
// Pins that maps render WITHOUT any key (keyless fallback) and upgrade to
// MapTiler vector tiles when a key is supplied. No emulator.
//   npx tsx scripts/test-map-style.ts
import { resolveMapStyle } from '../packages/shared/src/index';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── no key → keyless raster fallback (zero-config) ───────────────────────────
const topo = resolveMapStyle();
check('keyless topo is an inline style object', typeof topo === 'object');
check('keyless topo uses the opentopo source',
  typeof topo === 'object' && 'sources' in topo && 'opentopo' in (topo as { sources: Record<string, unknown> }).sources);
check('keyless topo is a v8 style',
  typeof topo === 'object' && (topo as { version?: number }).version === 8);

const sat = resolveMapStyle(undefined, 'satellite');
check('keyless satellite uses the esri source',
  typeof sat === 'object' && 'sources' in sat && 'esri' in (sat as { sources: Record<string, unknown> }).sources);

// ── with key → MapTiler vector URL (optional upgrade) ────────────────────────
const keyed = resolveMapStyle('TESTKEY', 'topo');
check('keyed topo is a MapTiler outdoor URL',
  typeof keyed === 'string' && keyed.includes('/maps/outdoor/') && keyed.includes('key=TESTKEY'));
const keyedSat = resolveMapStyle('TESTKEY', 'satellite');
check('keyed satellite is a MapTiler hybrid URL',
  typeof keyedSat === 'string' && keyedSat.includes('/maps/hybrid/') && keyedSat.includes('key=TESTKEY'));

console.log(`\n${failures === 0 ? 'ALL MAP-STYLE TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

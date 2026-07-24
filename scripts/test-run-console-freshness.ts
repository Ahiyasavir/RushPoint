// Pure-logic tests — Run Console live-stream freshness
// (change: run-console-live-stream-resilience).
//
// The creator Run Console's teams poll had no error handling and no stale signal,
// so a rejected poll (token refresh, network blip, cold start) froze the whole
// board at last-known state while it still LOOKED live. The stale verdict is a
// pure, total helper so "is the board stale" is testable without rendering
// (creator-web has no component test runner). These assertions pin the verdict
// and its totality, plus a source-scan wiring guard that the three new i18n keys
// exist in BOTH language maps. Runs via `npm test` (scripts/run-unit-tests.mjs).
// No emulator.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  TEAMS_POLL_INTERVAL_MS,
  TEAMS_STALE_AFTER_MS,
  isTeamsStale,
  secondsSinceSync,
} from '../apps/creator-web/src/lib/streamFreshness';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}
function noThrow(label: string, fn: () => void): void {
  try { fn(); ok(label, true); }
  catch (e) { failures++; console.error(`  ✗ ${label} — threw ${String(e)}`); }
}

console.log('streamFreshness constants');
ok('poll interval is a positive finite number', Number.isFinite(TEAMS_POLL_INTERVAL_MS) && TEAMS_POLL_INTERVAL_MS > 0);
ok('stale tolerance is at least two poll intervals', TEAMS_STALE_AFTER_MS >= TEAMS_POLL_INTERVAL_MS * 2);

console.log('isTeamsStale');
const t0 = 1_000_000;
eq('fresh within tolerance is not stale', isTeamsStale(t0, t0 + 1000, false), false);
eq('exactly at tolerance is not yet stale', isTeamsStale(t0, t0 + TEAMS_STALE_AFTER_MS, false), false);
eq('aged past tolerance is stale', isTeamsStale(t0, t0 + TEAMS_STALE_AFTER_MS + 1, false), true);
eq('explicit error is stale regardless of age', isTeamsStale(t0, t0 + 1, true), true);
eq('explicit error is stale even with null timestamp', isTeamsStale(null, t0, true), true);
eq('never-synced with no error is not stale (spinner owns first load)', isTeamsStale(null, t0, false), false);
eq('a future sync timestamp is not stale (clamped, no negative age)', isTeamsStale(t0 + 5000, t0, false), false);

console.log('isTeamsStale totality');
eq('NaN now is not stale', isTeamsStale(t0, NaN, false), false);
eq('Infinity now is not stale', isTeamsStale(t0, Infinity, false), false);
eq('NaN lastSyncAt is not stale', isTeamsStale(NaN, t0, false), false);
eq('NaN lastSyncAt with error is still stale', isTeamsStale(NaN, t0, true), true);
noThrow('garbage inputs never throw', () => {
  isTeamsStale(NaN, NaN, false);
  isTeamsStale(Infinity, -Infinity, false);
  isTeamsStale(undefined as never, 'x' as never, false);
  isTeamsStale(null, undefined as never, true);
});

console.log('secondsSinceSync');
eq('null timestamp yields null', secondsSinceSync(null, t0), null);
eq('2600ms floors to 2 whole seconds', secondsSinceSync(t0, t0 + 2600), 2);
eq('999ms floors to 0', secondsSinceSync(t0, t0 + 999), 0);
eq('exact 5s is 5', secondsSinceSync(t0, t0 + 5000), 5);
eq('negative delta clamps to 0', secondsSinceSync(t0, t0 - 4000), 0);
noThrow('secondsSinceSync never throws on garbage', () => {
  secondsSinceSync(NaN, t0);
  secondsSinceSync(t0, NaN);
  secondsSinceSync(Infinity, -Infinity);
  secondsSinceSync(undefined as never, 'x' as never);
});

console.log('i18n wiring guard');
const here = dirname(fileURLToPath(import.meta.url));
const i18nSrc = readFileSync(join(here, '..', 'apps', 'creator-web', 'src', 'i18n.ts'), 'utf8');
for (const key of ['teamsReconnecting', 'lastUpdatedAgo', 'alertsStreamInterrupted']) {
  // Both language maps ⇒ the key appears at least twice.
  const count = i18nSrc.split(`${key}:`).length - 1;
  ok(`i18n defines ${key} in both language maps (found ${count})`, count >= 2);
}

console.log('');
if (failures > 0) {
  console.error(`✗ run-console-freshness: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ run-console-freshness: all assertions passed');

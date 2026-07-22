// Pure-logic test for the 90-day retention prune delete-set (wave-J / J3).
//
// pruneRunPII bulk-deletes every raw-PII subcollection under a finished/aged run.
// `alerts` docs carry raw GPS lat/lng (triggerSOS + safe_zone_breach), so they are
// exactly the "GPS location pings" the retention policy promises to purge — they
// MUST be in the bulk-delete set alongside teamLocations/locationTrack/zones/feedItems.
// This test pins the delete-set so the alerts purge can never silently regress.
// No emulator.
//   npx tsx scripts/test-retention-prune.ts
import { PII_BULK_SUBCOLLECTIONS } from '../functions/src/maintenance/index';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const set = PII_BULK_SUBCOLLECTIONS as readonly string[];

// J3 — the regression this fix closes: location-bearing SOS/breach alerts are purged.
check('alerts is in the bulk-delete set', set.includes('alerts'), JSON.stringify(set));

// Guard the pre-existing location/PII subcollections so the refactor keeps purging them.
for (const name of ['teamLocations', 'locationTrack', 'zones', 'feedItems']) {
  check(`${name} still purged`, set.includes(name));
}

// Shape sanity: names are unique, non-empty strings.
check('names are unique', new Set(set).size === set.length);
check('names are non-empty strings', set.every((n) => typeof n === 'string' && n.length > 0));

console.log(`\n${failures === 0 ? 'ALL RETENTION-PRUNE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

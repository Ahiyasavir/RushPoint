// The run console's location-freshness snapshot (change: hot-path-read-cost).
//
// Every location ping dirties one teamLocations document, so the document cache cannot help
// this read: at 120 pinging teams and a 5s board poll it cost ~10,800 reads per run. It is a
// minutes-scale signal, so it gets its own interval.
import assert from 'node:assert/strict';
import {
  getLocationFreshness,
  resetLocationFreshness,
  LOCATION_FRESHNESS_REFRESH_MS,
} from '../functions/src/runs/locationFreshnessCache';

let passed = 0;
const t = async (label: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log(`  ok  ${label}`); }
  catch (e) { console.error(`  FAIL  ${label}\n        ${(e as Error).message}`); process.exitCode = 1; }
};

const mapOf = (o: Record<string, string>) => new Map(Object.entries(o));

async function main() {
  console.log('\n── run-console location freshness ──');

  await t('the first call reads', async () => {
    resetLocationFreshness();
    let reads = 0;
    const v = await getLocationFreshness('r1', async () => { reads++; return mapOf({ a: 'T1' }); }, 0);
    assert.equal(reads, 1);
    assert.equal(v.get('a'), 'T1');
  });

  await t('polls inside the interval do NOT read again', async () => {
    resetLocationFreshness();
    let reads = 0;
    const read = async () => { reads++; return mapOf({ a: 'T1' }); };
    await getLocationFreshness('r1', read, 0);
    // A 5s board poll for the whole interval.
    for (let ms = 5_000; ms < LOCATION_FRESHNESS_REFRESH_MS; ms += 5_000) {
      await getLocationFreshness('r1', read, ms);
    }
    assert.equal(reads, 1, `expected one read across the interval, got ${reads}`);
  });

  await t('the snapshot refreshes once the interval elapses', async () => {
    resetLocationFreshness();
    let reads = 0;
    const read = async () => { reads++; return mapOf({ a: `T${reads}` }); };
    await getLocationFreshness('r1', read, 0);
    const v = await getLocationFreshness('r1', read, LOCATION_FRESHNESS_REFRESH_MS);
    assert.equal(reads, 2);
    assert.equal(v.get('a'), 'T2');
  });

  await t('rows in between carry the last known value, not null', async () => {
    resetLocationFreshness();
    const v0 = await getLocationFreshness('r1', async () => mapOf({ a: 'T1' }), 0);
    const v1 = await getLocationFreshness('r1', async () => mapOf({ a: 'T9' }), 1_000);
    assert.equal(v0.get('a'), 'T1');
    assert.equal(v1.get('a'), 'T1', 'a poll inside the interval must reuse the snapshot');
  });

  await t('runs do not share a snapshot', async () => {
    resetLocationFreshness();
    await getLocationFreshness('runA', async () => mapOf({ a: 'A' }), 0);
    const b = await getLocationFreshness('runB', async () => mapOf({ b: 'B' }), 0);
    assert.equal(b.get('b'), 'B');
    assert.equal(b.get('a'), undefined, 'one run must not see another run\'s teams');
  });

  await t('a failing read keeps serving the last good snapshot', async () => {
    resetLocationFreshness();
    await getLocationFreshness('r1', async () => mapOf({ a: 'T1' }), 0);
    const v = await getLocationFreshness('r1', async () => { throw new Error('firestore down'); },
      LOCATION_FRESHNESS_REFRESH_MS);
    assert.equal(v.get('a'), 'T1', 'a blip must not blank every row\'s last-seen column');
  });

  await t('a failing FIRST read degrades to empty rather than throwing', async () => {
    resetLocationFreshness();
    const v = await getLocationFreshness('r1', async () => { throw new Error('down'); }, 0);
    assert.equal(v.size, 0);
  });

  await t('a failure is not cached as a result', async () => {
    resetLocationFreshness();
    await getLocationFreshness('r1', async () => { throw new Error('down'); }, 0);
    const v = await getLocationFreshness('r1', async () => mapOf({ a: 'T1' }), 10);
    assert.equal(v.get('a'), 'T1', 'the next poll must retry rather than serve a cached failure');
  });

  await t('the interval is long enough to matter and short enough to be useful', () => {
    // Long enough that a 5s board poll is not re-reading it constantly...
    assert.ok(LOCATION_FRESHNESS_REFRESH_MS >= 15_000, 'too short to save reads');
    // ...and short enough that "when did we last hear from this team" stays meaningful.
    assert.ok(LOCATION_FRESHNESS_REFRESH_MS <= 60_000, 'too stale to be an operational signal');
  });

  console.log(`\n${passed} assertions passed`);
  if (process.exitCode) { console.error('FAILED'); process.exit(1); }
}
void main();

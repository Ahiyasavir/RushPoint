// Pure-logic tests for the in-process last-fix store (change: spark-tier-location-load).
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// WHY THIS STORE EXISTS: deciding whether to write `teamLocations/{teamId}` requires knowing
// the last fix written for that team. Reading that document to make the decision would add
// a Firestore read per ping and cancel the entire saving — so the last fix is held in the
// API process's own memory instead. Correct for the same two reasons docCache.ts and
// rateLimitStore.ts are: the API is the SOLE writer of that document, and there is exactly
// ONE API process.
//
// THE TWO FAILURE MODES ASSERTED HERE:
//   1. UNBOUNDED GROWTH. play-web signs in anonymously, so uids are free to mint; a store
//      that only ever grows is an OOM that takes the whole API down mid-run.
//   2. EVICTING A LIVE TEAM. Reclamation that drops an actively-pinging team is not merely
//      wasteful — it silently turns suppression off for whoever is pinging hardest, which
//      is the same shape as the rate-limiter bug recorded in CLAUDE.md. So every
//      "was reclaimed" assertion is paired with a "the live one survived" assertion.
//
// No emulator.  npx tsx scripts/test-last-fix-store.ts
import { createLastFixStore, LAST_FIX_IDLE_MS } from '../functions/src/lastFixStore';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const T0 = 1_700_000_000_000;
const P = { lat: 31.78, lng: 35.21 };

// ── Round trip ───────────────────────────────────────────────────────────────
{
  const store = createLastFixStore();
  ok(store.get('run1:teamA') === undefined, 'an unknown team holds nothing (⇒ the caller writes)');

  store.recordPin('run1:teamA', { ...P, atMs: T0 }, T0);
  const rec = store.get('run1:teamA');
  ok(rec?.pin?.lat === P.lat, 'a recorded pin comes back');
  ok(rec?.pin?.atMs === T0, 'the pin carries the time it was written');
  ok(rec?.track === undefined, 'recording a pin does not invent a track reference');
}

// ── Pin and track reference are tracked separately ──────────────────────────
{
  // They advance at different rates on purpose: the pin refreshes on a 60s interval, the
  // track reference only when the team has travelled 100m. Conflating them would make one
  // of the two decisions wrong.
  const store = createLastFixStore();
  store.recordPin('k', { ...P, atMs: T0 }, T0);
  store.recordTrack('k', { lat: P.lat + 0.01, lng: P.lng }, T0 + 1_000);

  const rec = store.get('k');
  ok(rec?.pin?.atMs === T0, 'the pin is unchanged by a track update');
  ok(rec?.track?.lat === P.lat + 0.01, 'the track reference is stored independently');

  store.recordPin('k', { ...P, atMs: T0 + 60_000 }, T0 + 60_000);
  ok(store.get('k')?.track?.lat === P.lat + 0.01, 'the track reference survives a pin update');
}

// ── Keys are isolated ────────────────────────────────────────────────────────
{
  const store = createLastFixStore();
  store.recordPin('run1:teamA', { ...P, atMs: T0 }, T0);
  store.recordPin('run1:teamB', { lat: 32, lng: 35, atMs: T0 }, T0);
  ok(store.get('run1:teamA')?.pin?.lat === P.lat, 'team A keeps its own fix');
  ok(store.get('run1:teamB')?.pin?.lat === 32, 'team B keeps its own fix');
  ok(store.get('run2:teamA') === undefined, 'the same team id in a different run is a different key');
}

// ── Idle entries are reclaimed, LIVE ones are not ───────────────────────────
{
  const store = createLastFixStore();
  store.recordPin('idle', { ...P, atMs: T0 }, T0);
  store.recordPin('live', { ...P, atMs: T0 }, T0);

  // The live team keeps pinging; the idle one stops.
  const later = T0 + LAST_FIX_IDLE_MS + 60_000;
  store.recordPin('live', { ...P, atMs: later }, later);
  store.reclaim(later);

  ok(store.get('idle') === undefined, 'a team that stopped pinging is reclaimed');
  ok(store.get('live')?.pin?.atMs === later,
    'the actively-pinging team SURVIVES — evicting it would silently disable suppression ' +
    'for exactly the team generating the most load');
}

// ── A team just inside the idle window is not reclaimed ─────────────────────
{
  const store = createLastFixStore();
  store.recordPin('recent', { ...P, atMs: T0 }, T0);
  store.reclaim(T0 + LAST_FIX_IDLE_MS - 1);
  ok(store.get('recent') !== undefined, 'an entry one millisecond inside the window survives');
}

// ── The store is bounded even when every entry is live ──────────────────────
{
  // Reclamation only frees IDLE entries, so it frees nothing when everything is live —
  // which would leave the map growing without limit under anonymous uid rotation.
  const store = createLastFixStore({ maxKeys: 50 });
  for (let i = 0; i < 500; i++) {
    store.recordPin(`team-${i}`, { ...P, atMs: T0 + i }, T0 + i);
  }
  ok(store.size() <= 50, `the store is capped regardless of liveness, got ${store.size()}`);
  ok(store.get('team-499') !== undefined, 'the most recent entry is retained');
}

// ── Eviction under the cap is not a correctness failure ─────────────────────
{
  // Losing an entry simply means the next ping writes — the fail-open direction. Asserted
  // so the trade-off is recorded as intentional rather than discovered later.
  const store = createLastFixStore({ maxKeys: 2 });
  store.recordPin('a', { ...P, atMs: T0 }, T0);
  store.recordPin('b', { ...P, atMs: T0 }, T0);
  store.recordPin('c', { ...P, atMs: T0 }, T0);
  ok(store.size() <= 2, 'the cap holds');
  ok(store.get('c') !== undefined, 'the newest entry is present');
}

// ── Reclamation happens on its own cadence, with no timer and no explicit call ──
{
  // A timer would keep the process alive and need tearing down; the sweep instead rides
  // the write path, exactly as rateLimitStore.ts does.
  const store = createLastFixStore({ reclaimEvery: 5 });
  for (let i = 0; i < 4; i++) store.recordPin(`old-${i}`, { ...P, atMs: T0 }, T0);
  ok(store.size() === 4, 'four idle entries are held before any sweep is due');

  // Enough later writes to cross the cadence, all far past the idle window.
  const later = T0 + LAST_FIX_IDLE_MS + 60_000;
  for (let i = 0; i < 6; i++) store.recordPin(`new-${i}`, { ...P, atMs: later }, later);

  ok(store.get('old-0') === undefined, 'the idle entries were swept without an explicit reclaim call');
  ok(store.get('new-5') !== undefined, 'the fresh entries survived the automatic sweep');
}

// ── Malformed input never throws and never corrupts a good entry ────────────
{
  const store = createLastFixStore();
  let threw = false;
  try {
    store.recordPin('k', { ...P, atMs: T0 }, T0);
    store.recordPin('k', undefined as never, T0);
    store.recordPin('', { ...P, atMs: T0 }, T0);
    store.recordTrack('k', undefined as never, T0);
    store.get(undefined as never);
    store.reclaim(NaN);
  } catch { threw = true; }
  ok(!threw, 'the store tolerates malformed input without throwing');
}

console.log(`\nlast-fix-store: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// The gallery missions map must show EVERY located mission, at its exact spot
// (change: gallery-precise-task-location + the seed self-heal in seed-local.mjs).
//
// THE USER-FACING CONTRACT THIS PROVES
//   1. COUNT   — the number of pins on the map equals the number of missions that
//                have a location (an ordinary located mission OR a hidden-location
//                mission). Locationless / unplaced missions contribute NO pin.
//   2. ACCURACY— an ordinary located mission's pin is its EXACT authored
//                coordinate, not a coarsened cell.
//
// THE ONE DELIBERATE EXCEPTION (documented, not a bug)
//   A `hideLocation` mission still plots as a COARSE ~1 km cell, never its exact
//   point. `publicTasks` is world-readable (`firestore.rules`: allow read: if
//   true), so publishing a hidden mission's exact spot would hand its puzzle
//   answer — and a real-world location, sometimes of a kids' event — to anyone who
//   opens the gallery. It still COUNTS toward the map (invariant 1 holds); only its
//   precision is withheld. The player-facing secrecy is a separate control (the
//   participant sanitizer), untouched here.
//
// WHY THIS TEST EXISTS
//   The map read path (isPlottablePublicTask), the write path (publicTaskLocation,
//   used by publishGame AND the seed), and the repair path (repairPublicTask, used
//   by the production backfill AND the seed self-heal) are three separate places
//   that must agree, or a mission silently drops off the map / lands ~1 km away.
//   The reported bug was legacy `publicTasks` documents — an exact `coordinates`
//   and NO `approxLocation` — which the map refuses to plot: every located mission
//   vanished. This test drives a mission mix through ALL THREE paths and asserts
//   the count + accuracy contract end to end, so the regression cannot silently
//   return.
//
// Pure — no emulator, no network.
//   npx tsx scripts/test-gallery-map-invariant.ts

import {
  publicTaskLocation,
  isPlottablePublicTask,
  isCoarsePublicPoint,
  repairPublicTask,
  mayNeedPublicTaskRepair,
} from '@rushpoint/shared';

let passed = 0;
const failures: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failures.push(msg); console.log(`  FAIL ${msg}`); }
}

// A canonical game whose missions span every location case a creator can author.
// Coordinates are deliberately OFF-GRID so an exact pin can never be mistaken for
// a coarse cell.
const P1 = { lat: 31.77661, lng: 35.23499 };  // ordinary located
const P2 = { lat: 32.08512, lng: 34.78180 };  // ordinary located
const P3 = { lat: 31.80941, lng: 35.19235 };  // hidden-location
const MISSIONS = [
  { id: 'm-located-1', title: 'A', coordinates: P1 },
  { id: 'm-located-2', title: 'B', type: 'geofence', coordinates: P2 },
  { id: 'm-hidden',    title: 'C', coordinates: P3, hideLocation: true },
  { id: 'm-nowhere',   title: 'D', locationless: true, coordinates: { lat: 0, lng: 0 } },
  { id: 'm-unplaced',  title: 'E', coordinates: { lat: 0, lng: 0 } },  // null-island placeholder
];
// The subset the contract says MUST appear on the map: located + hidden.
const LOCATED = MISSIONS.filter((m) => !m.locationless
  && !(m.coordinates.lat === 0 && m.coordinates.lng === 0));

/** The `publicTasks` document publishGame / the seed write for a mission. */
function publish(m: { coordinates: { lat: number; lng: number }; hideLocation?: boolean; locationless?: boolean }) {
  const approxLocation = publicTaskLocation(m);
  return { ...(approxLocation ? { approxLocation } : {}) };
}
/** The pins the gallery map plots from a set of published docs (GalleryPage taskPoints). */
function pins(docs: Array<Record<string, unknown>>) {
  return docs.filter(isPlottablePublicTask);
}

console.log('\n🗺️  gallery missions-map count + accuracy invariant\n');

// ── 1. A freshly published game: count + accuracy hold ────────────────────────
{
  console.log('▶ fresh publish (publicTaskLocation write path)');
  const docs = MISSIONS.map(publish);
  const plotted = pins(docs);

  // COUNT: one pin per located-or-hidden mission, and no more.
  ok(plotted.length === LOCATED.length,
    `map plots exactly the located+hidden missions (${plotted.length} == ${LOCATED.length})`);

  // ACCURACY: every ordinary located mission's pin is its EXACT authored point.
  for (const m of MISSIONS) {
    const doc = publish(m) as { approxLocation?: { lat: number; lng: number } };
    if (m.locationless || (m.coordinates.lat === 0 && m.coordinates.lng === 0)) {
      ok(!isPlottablePublicTask(doc), `${m.id}: locationless/unplaced ⇒ NO pin`);
    } else if (m.hideLocation) {
      ok(isPlottablePublicTask(doc), `${m.id}: hidden ⇒ has a pin (counts toward the map)`);
      ok(isCoarsePublicPoint(doc.approxLocation), `${m.id}: hidden ⇒ pin is a COARSE cell (privacy)`);
      ok(!(doc.approxLocation!.lat === m.coordinates.lat && doc.approxLocation!.lng === m.coordinates.lng),
        `${m.id}: hidden ⇒ pin is NOT the exact point`);
    } else {
      ok(doc.approxLocation!.lat === m.coordinates.lat && doc.approxLocation!.lng === m.coordinates.lng,
        `${m.id}: located ⇒ pin is the EXACT authored coordinate`);
      ok(!isCoarsePublicPoint(doc.approxLocation), `${m.id}: located ⇒ pin is precise, not coarsened`);
    }
  }
}

// ── 2. The reported bug: LEGACY docs (exact coordinates, no area) plot NOTHING ─
{
  console.log('\n▶ legacy documents (the reported bug: exact coordinates, no approxLocation)');
  // What the old writer stored: the exact point in `coordinates`, no `approxLocation`.
  const legacy = MISSIONS.map((m) => ({ coordinates: { ...m.coordinates } }));
  const plottedBefore = pins(legacy);
  ok(plottedBefore.length === 0,
    `every located mission is MISSING from the map before repair (${plottedBefore.length} pins) — reproduces the bug`);
}

// ── 3. The repair (backfill / seed self-heal) restores count + accuracy ───────
{
  console.log('\n▶ after repairPublicTask (production backfill AND the seed self-heal)');
  const repairedDocs = MISSIONS.map((m) => {
    const legacy = { coordinates: { ...m.coordinates } } as Record<string, unknown>;
    ok(mayNeedPublicTaskRepair(legacy), `${m.id}: legacy doc is flagged as needing repair`);
    const repair = repairPublicTask(legacy, m);           // source = the authored mission
    // The repair writes the area (or clears it); the legacy exact point is dropped.
    return { ...(repair?.approxLocation ? { approxLocation: repair.approxLocation } : {}) };
  });
  const plotted = pins(repairedDocs);

  ok(plotted.length === LOCATED.length,
    `after repair the map plots the located+hidden missions again (${plotted.length} == ${LOCATED.length})`);

  // Accuracy is restored: located missions back to their exact point, hidden coarse.
  MISSIONS.forEach((m, i) => {
    const doc = repairedDocs[i] as { approxLocation?: { lat: number; lng: number } };
    if (m.locationless || (m.coordinates.lat === 0 && m.coordinates.lng === 0)) {
      ok(!isPlottablePublicTask(doc), `${m.id}: still NO pin after repair (correctly)`);
    } else if (m.hideLocation) {
      ok(isPlottablePublicTask(doc) && isCoarsePublicPoint(doc.approxLocation),
        `${m.id}: hidden ⇒ repaired to a coarse pin`);
    } else {
      ok(!!doc.approxLocation
        && doc.approxLocation.lat === m.coordinates.lat
        && doc.approxLocation.lng === m.coordinates.lng,
        `${m.id}: located ⇒ repaired to its EXACT coordinate`);
    }
  });

  // Idempotent: applying the repair to an already-conformant document changes
  // nothing. (mayNeedPublicTaskRepair is deliberately conservative — it flags any
  // area-less doc, because without the source it can't tell a locationless mission
  // from a hidden one still owed its area — so the real idempotency property is
  // that repairPublicTask itself returns null, i.e. "skip, nothing to write".)
  ok(MISSIONS.every((m) => repairPublicTask(publish(m) as Record<string, unknown>, m) === null),
    'repairPublicTask is a no-op on an already-conformant document — repair is idempotent');
}

console.log(`\n${failures.length === 0
  ? `✅ ALL ${passed} GALLERY-MAP INVARIANT ASSERTIONS PASSED`
  : `❌ ${failures.length} failure(s):\n   - ${failures.join('\n   - ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);

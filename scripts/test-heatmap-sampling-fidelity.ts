// Does a distance-sampled GPS track still produce a truthful movement heatmap?
// (change: spark-tier-location-load). Run by scripts/run-unit-tests.mjs via `npm test`.
//
// The change stopped appending a `locationTrack` point on every 20s ping and now retains one
// per 100m travelled. That is a real reduction in input data, so the question this file
// answers is whether the picture the creator sees afterwards is still the same picture.
//
// FIDELITY IS DEFINED AT THE AGGREGATE LEVEL, NOT PER TEAM — and deliberately so. A single
// team's sampled track WILL skip grid cells it crossed (100m retention over a ~55m grid),
// and pretending otherwise would be a promise the arithmetic cannot keep. What must survive
// is the relative density ordering across all the teams in a run, which is the only thing
// the heatmap is actually read for.
//
// The most important assertion here is the LAST one: time-sampling a *movement* heatmap
// grows a hot cell wherever teams merely stood still — at a task, in a queue — which is the
// opposite of what the map is meant to show. Distance-based retention is what fixes that,
// and it is a genuine improvement in truthfulness, not just a cost saving.
//
// No emulator.  npx tsx scripts/test-heatmap-sampling-fidelity.ts
import { buildMovementDensity } from '../packages/shared/src/movementHeatmap';
import { shouldRetainTrackPoint } from '../packages/shared/src/locationPingEconomy';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const BASE = { lat: 31.78, lng: 35.21 };
const north = (m: number) => ({ lat: BASE.lat + m / 111_320, lng: BASE.lng });
const east = (m: number) => ({ lat: BASE.lat, lng: BASE.lng + m / 111_320 });

/** Apply the real retention verdict to a full per-ping track. */
function sample(points: Array<{ lat: number; lng: number }>): Array<{ lat: number; lng: number }> {
  const out: Array<{ lat: number; lng: number }> = [];
  let ref: { lat: number; lng: number } | null = null;
  for (const p of points) {
    if (shouldRetainTrackPoint({ fix: p, lastRetained: ref }).retain) { out.push(p); ref = p; }
  }
  return out;
}

const cellKey = (c: { lat: number; lng: number }) => `${c.lat.toFixed(5)}:${c.lng.toFixed(5)}`;

// ── A busy corridor still reads as busy ──────────────────────────────────────
{
  // 40 teams walk the same 2km route; 5 teams walk a parallel one. The heatmap's whole job
  // is to show that the first route is the busier one.
  const busy: Array<{ lat: number; lng: number }> = [];
  const quiet: Array<{ lat: number; lng: number }> = [];
  for (let team = 0; team < 40; team++) {
    for (let i = 0; i < 72; i++) busy.push(north(28 * i));            // 28m per ping
  }
  for (let team = 0; team < 5; team++) {
    for (let i = 0; i < 72; i++) quiet.push(east(28 * i));
  }

  const fullCells = buildMovementDensity([...busy, ...quiet]);
  const sampledCells = buildMovementDensity([...sample(busy), ...sample(quiet)]);

  ok(sampledCells.length > 0, 'the sampled track still yields cells');

  // The heaviest cell must still sit on the busy corridor in both.
  const fullTop = fullCells[0];
  const sampledTop = sampledCells[0];
  ok(Math.abs(fullTop.lng - BASE.lng) < 0.0001 && Math.abs(sampledTop.lng - BASE.lng) < 0.0001,
    'the busiest cell is on the busy corridor in both the full and the sampled heatmap');

  // And the busy corridor must dominate the quiet one by a wide margin in both.
  const weightOn = (cells: typeof fullCells, onBusy: boolean) => cells
    .filter((c) => (onBusy ? Math.abs(c.lng - BASE.lng) < 0.0001 : Math.abs(c.lng - BASE.lng) >= 0.0001))
    .reduce((s, c) => s + c.weight, 0);

  const fullRatio = weightOn(fullCells, true) / Math.max(1, weightOn(fullCells, false));
  const sampledRatio = weightOn(sampledCells, true) / Math.max(1, weightOn(sampledCells, false));
  ok(sampledRatio > 4, `the busy corridor still dominates after sampling (ratio ${sampledRatio.toFixed(1)})`);
  ok(Math.abs(sampledRatio - fullRatio) / fullRatio < 0.35,
    `the busy:quiet ratio is preserved within 35% (full ${fullRatio.toFixed(1)} → sampled ${sampledRatio.toFixed(1)})`);
}

// ── The route is still continuous — no gaps a reader would misread ──────────
{
  // One team walking 2km. Sampled at 100m, it contributes ~20 points across ~36 grid cells,
  // so its own track IS sparser. What matters is that the cells it does mark are spread
  // along the whole route rather than clustered at one end.
  const walk = Array.from({ length: 72 }, (_, i) => north(28 * i));
  const sampled = sample(walk);

  ok(sampled.length >= 15 && sampled.length <= 25,
    `2km of walking retains ~20 points, got ${sampled.length} (was 72 — one per ping)`);

  const first = sampled[0].lat;
  const last = sampled[sampled.length - 1].lat;
  ok(last - first > (1800 / 111_320),
    'the retained points span essentially the whole route, not just its start');
}

// ── THE POINT: standing still no longer manufactures a hot cell ─────────────
{
  // 30 teams each spend 10 minutes (30 pings) at one task, jittering within GPS error,
  // then walk away. Under per-ping retention that stop becomes the hottest cell on the map
  // purely because people QUEUED there — a movement heatmap reporting the opposite of
  // movement.
  const perPing: Array<{ lat: number; lng: number }> = [];
  const retained: Array<{ lat: number; lng: number }> = [];

  for (let team = 0; team < 30; team++) {
    const stop: Array<{ lat: number; lng: number }> = [];
    for (let i = 0; i < 30; i++) stop.push(north((i % 2 === 0 ? 12 : -12)));   // idling
    const walkAway = Array.from({ length: 40 }, (_, i) => north(200 + 28 * i));
    perPing.push(...stop, ...walkAway);
    retained.push(...sample([...stop, ...walkAway]));
  }

  const perPingCells = buildMovementDensity(perPing);
  const retainedCells = buildMovementDensity(retained);

  // Under per-ping retention the idle spot is the heaviest cell in the run.
  const idleLat = BASE.lat;
  const isIdleCell = (c: { lat: number }) => Math.abs(c.lat - idleLat) < 0.0006;
  ok(isIdleCell(perPingCells[0]),
    'per-ping retention makes the place teams STOOD STILL the hottest cell (the bug)');

  // Under distance retention it is not DISPROPORTIONATELY hot. Stated as a ratio against a
  // typical moving cell rather than as "is it rank 1", because once idling stops being
  // over-weighted the idle cell legitimately TIES with the walk cells (each team contributes
  // one point to each), and buildMovementDensity breaks ties by latitude — so rank alone
  // would be measuring the tiebreak, not the density.
  const idleVsTypical = (cells: typeof perPingCells) => {
    const idle = cells.filter(isIdleCell).reduce((s, c) => s + c.weight, 0);
    const moving = cells.filter((c) => !isIdleCell(c)).map((c) => c.weight).sort((a, b) => a - b);
    const median = moving.length ? moving[Math.floor(moving.length / 2)] : 1;
    return idle / Math.max(1, median);
  };
  const beforeRatio = idleVsTypical(perPingCells);
  const afterRatio = idleVsTypical(retainedCells);

  ok(beforeRatio > 10,
    `per-ping: the idle cell is ${beforeRatio.toFixed(1)}x a typical moving cell — the distortion`);
  ok(afterRatio <= 1.5,
    `distance retention: the idle cell is only ${afterRatio.toFixed(1)}x a typical moving cell`);
  ok(afterRatio < beforeRatio / 5,
    `the distortion shrank by at least 5x (${beforeRatio.toFixed(1)}x → ${afterRatio.toFixed(1)}x)`);

  const idleShare = (cells: typeof perPingCells) => {
    const total = cells.reduce((s, c) => s + c.weight, 0);
    const idle = cells.filter(isIdleCell).reduce((s, c) => s + c.weight, 0);
    return idle / Math.max(1, total);
  };
  ok(idleShare(retainedCells) < idleShare(perPingCells),
    `idling occupies a smaller share of the map after sampling ` +
    `(${(idleShare(perPingCells) * 100).toFixed(0)}% → ${(idleShare(retainedCells) * 100).toFixed(0)}%)`);
}

// ── Prune-safety is unchanged ───────────────────────────────────────────────
{
  let threw = false;
  try {
    const cells = buildMovementDensity([]);
    ok(cells.length === 0, 'an empty track still yields no cells');
    ok(Array.isArray(cells), 'and does not error — the 90-day prune leaves runs with no track');
  } catch { threw = true; }
  ok(!threw, 'building a heatmap from nothing never throws');

  // Deterministic: the same sampled input must produce the same map twice.
  const walk = Array.from({ length: 30 }, (_, i) => north(28 * i));
  const a = buildMovementDensity(sample(walk)).map(cellKey).join('|');
  const b = buildMovementDensity(sample(walk)).map(cellKey).join('|');
  ok(a === b, 'sampling is deterministic — the same track reproduces the same heatmap');
}

console.log(`\nheatmap-sampling-fidelity: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

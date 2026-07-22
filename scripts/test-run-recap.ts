// Pure-logic tests for run-recap (buildRunRecap + computeMontageGrid).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { buildRunRecap, computeMontageGrid } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── buildRunRecap ────────────────────────────────────────────────────────────
const photoTask = (outcome: string, url?: string, taskId = 't') => ({
  taskId, taskIndex: 0, status: 'completed', verificationOutcome: outcome, photoUrl: url,
});
const teams = [
  { id: 'A', displayName: 'Alpha', score: 100, stages: [{ tasks: [photoTask('approved', 'a.jpg'), photoTask('rejected', 'bad.jpg')] }] },
  { id: 'B', displayName: 'Bravo', score: 80, stages: [{ tasks: [photoTask('photo_pending', 'pend.jpg'), photoTask('correct', 'b.jpg')] }] },
] as never[];
const run = { leaderboard: { rankings: [
  { rank: 1, teamId: 'A', teamName: 'Alpha', score: 100, completedStages: 1, durationSeconds: 600 },
  { rank: 2, teamId: 'B', teamName: 'Bravo', score: 80, completedStages: 1, totalMinutes: 12 },
] } } as never;

const recap = buildRunRecap(teams, run);
ok(recap.standings.length === 2 && recap.standings[0].teamId === 'A', 'standings reuse ranking order');
ok(recap.standings[0].totalSeconds === 600, 'durationSeconds carried through');
ok(recap.standings[1].totalSeconds === 720, 'totalMinutes → seconds');
ok(recap.photos.length === 2, 'only approved + correct photos included');
ok(recap.photos.some((p) => p.photoUrl === 'a.jpg') && recap.photos.some((p) => p.photoUrl === 'b.jpg'), 'right photos');
ok(!recap.photos.some((p) => p.photoUrl === 'bad.jpg' || p.photoUrl === 'pend.jpg'), 'rejected + pending excluded');
ok(recap.stats.teamCount === 2 && recap.stats.photoCount === 2 && recap.stats.winnerName === 'Alpha', 'stats correct');

// Pruned run: photoUrls cleared → no photos, standings intact.
const pruned = [
  { id: 'A', displayName: 'Alpha', score: 100, stages: [{ tasks: [photoTask('approved', undefined)] }] },
] as never[];
const recapPruned = buildRunRecap(pruned, run);
ok(recapPruned.photos.length === 0, 'pruned run → photos empty');
ok(recapPruned.standings.length === 2, 'pruned run → standings intact');

// No leaderboard → fall back to score order.
const noLb = buildRunRecap(teams, { leaderboard: undefined } as never);
ok(noLb.standings[0].teamId === 'A' && noLb.standings[0].rank === 1, 'fallback sorts by score');

// Hidden-location filter (wave-g #2): an approved photo on a hidden-location task
// must be EXCLUDED from the recap (mirrors the live-feed shouldFeedTask exclusion),
// while a normal-task photo is kept. Filtering by task id keeps buildRunRecap pure.
const hiddenTeams = [
  { id: 'H', displayName: 'Hydra', score: 90, stages: [{ tasks: [
    photoTask('approved', 'normal.jpg', 'openTask'),
    photoTask('approved', 'secret-spot.jpg', 'hiddenTask'),
  ] }] },
] as never[];
const recapNoFilter = buildRunRecap(hiddenTeams, { leaderboard: undefined } as never);
ok(recapNoFilter.photos.length === 2, 'no filter arg → both photos (back-compat)');
const recapFiltered = buildRunRecap(hiddenTeams, { leaderboard: undefined } as never, new Set(['hiddenTask']));
ok(recapFiltered.photos.some((p) => p.photoUrl === 'normal.jpg'), 'normal-task photo kept');
ok(!recapFiltered.photos.some((p) => p.photoUrl === 'secret-spot.jpg'), 'hidden-location photo excluded');
ok(recapFiltered.stats.photoCount === 1, 'photoCount reflects hidden exclusion');

// ── computeMontageGrid ───────────────────────────────────────────────────────
function gridOk(n: number, expectCols: number, expectRows: number) {
  const g = computeMontageGrid(n, 1000, 1000);
  ok(g.cols === expectCols && g.rows === expectRows, `${n} → ${expectCols}x${expectRows} (got ${g.cols}x${g.rows})`);
  ok(g.cells.length === Math.min(n, 25), `${n} → ${Math.min(n, 25)} cells`);
  // in-bounds + non-overlapping (axis-aligned, uniform grid → no overlap if in-bounds)
  ok(g.cells.every((c) => c.x >= 0 && c.y >= 0 && c.x + c.w <= 1000.0001 && c.y + c.h <= 1000.0001), `${n} cells in bounds`);
}
gridOk(1, 1, 1);
gridOk(4, 2, 2);
gridOk(9, 3, 3);
gridOk(20, 5, 4);

const g0 = computeMontageGrid(0, 100, 100);
ok(g0.cells.length === 0 && g0.shown === 0 && !g0.capped, 'zero photos → empty grid');
const gCap = computeMontageGrid(40, 1000, 1000);
ok(gCap.shown === 25 && gCap.capped === true, 'overflow capped at 25 + reported');

// non-overlapping check for an uneven count (e.g. 7 → 3 cols x 3 rows, last row partial)
const g7 = computeMontageGrid(7, 900, 900);
let overlap = false;
for (let i = 0; i < g7.cells.length; i++) {
  for (let j = i + 1; j < g7.cells.length; j++) {
    const a = g7.cells[i], b = g7.cells[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlap = true;
  }
}
ok(!overlap, '7-cell grid has no overlapping cells');

console.log(failed === 0
  ? `\n✅ ALL RUN-RECAP TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

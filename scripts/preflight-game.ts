// ═══════════════════════════════════════════════════════════════════════════════
// Pre-flight a REAL game against a REAL participant count, before the event.
//
//   npx tsx scripts/preflight-game.ts <game.json> --teams=120
//
// WHY THIS EXISTS. `launchRun` already refuses a structurally broken game, and
// `npm run simulate` already proves the BACKEND survives load. Neither answers the
// question a creator actually has the night before: "will 100 real teams get
// through MY game, in the time I have, with the staff I have?" That is a property
// of the AUTHORED CONTENT — station caps, task durations, geofence radii, review
// burden — and no existing gate looks at it, because every existing gate runs
// against a synthetic game the harness wrote itself.
//
// Everything here is derived from the product's own validators and constants where
// one exists (taskCompletability, mutualExclusion, hiddenSearchArea). Where a
// judgement is this tool's own — the GPS realism bound, the review-burden bound —
// it is named as an ASSUMPTION and printed with its input, so a reader can
// disagree with the number instead of having to reverse-engineer it.
//
// Exit code is 0 for "no blocker found". WARNINGS DO NOT FAIL: a tight geofence
// may be exactly what the creator intends for a 4-metre stone marker. This tool
// informs a human decision; it does not pretend to make it.
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { taskCompletabilityError } from '../packages/shared/src/taskCompletability';
import { requiredTaskCountProblem, maxCompletableTasks } from '../packages/shared/src/mutualExclusion';
import type { Game, Stage, Task } from '../packages/shared/src/types';

const arg = (n: string, d: string) =>
  (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=')[1] || d;

const FILE = process.argv[2];
if (!FILE || FILE.startsWith('--')) {
  console.error('usage: npx tsx scripts/preflight-game.ts <game.json> [--teams=120] [--minutes=120]');
  process.exit(2);
}
const TEAMS = Math.max(1, Number(arg('teams', '120')));
/** Event window the creator actually has, in minutes. Used only to compare against throughput. */
const WINDOW_MIN = Math.max(1, Number(arg('minutes', '120')));

// ── ASSUMPTIONS (this tool's own judgements — argue with these numbers, not with code) ──
//
// A consumer-phone GPS fix in an open area is good to roughly 5-10m, and materially
// worse beside buildings or under tree cover. `reportArrival` compares the fix to the
// task's geofence, so a radius at or below the device's own error radius means a team
// standing exactly on the spot can still be told it has not arrived. This is the single
// most common way a real field game strands players, and it is invisible until the day.
const GPS_TYPICAL_ACCURACY_M = 15;
/** Below this, arrival depends on a lucky fix rather than on being in the right place. */
const GEOFENCE_RISKY_M = GPS_TYPICAL_ACCURACY_M;
/** Minutes one reviewer needs per photo/video submission, including the look and the tap. */
const REVIEW_MINUTES_EACH = 0.5;

const game: Game = JSON.parse(readFileSync(FILE, 'utf8'));
const stages: Stage[] = (game.stages ?? []) as Stage[];

let blockers = 0;
let warnings = 0;
const blocker = (m: string) => { console.log(`  ✗ BLOCKER  ${m}`); blockers++; };
const warn = (m: string) => { console.log(`  ⚠ WARNING  ${m}`); warnings++; };

console.log(`\n══ Pre-flight: "${game.title}" — ${TEAMS} teams, ${WINDOW_MIN}-minute window ══`);
console.log(`mode=${game.mode}  scoring=${game.scoringPreset}  safeZone=${game.safeZone ? `${(game.safeZone as any).radiusMeters}m` : 'none'}`);

// ── 1. Structural: can every mission be completed, and every stage won? ──────
console.log('\n── 1. Structure (the product\'s own validators) ──');
for (const [i, s] of stages.entries()) {
  const rq = requiredTaskCountProblem(s as any);
  if (rq) blocker(`stage ${i} "${s.title}": requiredTaskCount ${JSON.stringify(rq)}`);
  for (const t of (s.tasks ?? []) as Task[]) {
    const err = taskCompletabilityError(t as any);
    if (err) blocker(`stage ${i} "${t.title}" [${t.type}] is UNCOMPLETABLE: ${JSON.stringify(err)}`);
  }
}
if (blockers === 0) console.log('  ok — every mission is completable and every stage is winnable');

// ── 2. Throughput: can this many teams physically get through? ───────────────
// Station capacity is a HARD cap in routing (assignNextTask: taskCounts[id] >= cap),
// and a team with every station full is HELD ('stationsFull'). So a stage's ceiling is
// the sum over its tasks of cap/duration — teams per minute — and the stage needs
// TEAMS x requiredTaskCount completions to clear.
console.log('\n── 2. Throughput (cap ÷ duration, summed per stage) ──');
let floorMin = 0;
for (const [i, s] of stages.entries()) {
  const tasks = (s.tasks ?? []) as Task[];
  const req = s.requiredTaskCount ?? tasks.length;
  let thru = 0;
  let uncapped = false;
  for (const t of tasks) {
    const cap = t.maxConcurrentTeams ?? 3;
    const mins = Math.max(1, t.estimatedMinutes ?? 5);
    if (t.locationless) { uncapped = true; continue; } // locationless is uncapped in routing
    thru += cap / mins;
  }
  const needed = TEAMS * req;
  const mins = uncapped && thru === 0 ? 0 : needed / Math.max(thru, 1e-9);
  floorMin += mins;
  console.log(`  stage ${i} "${s.title}": need ${needed} completions at ${thru.toFixed(1)}/min ⇒ ${mins.toFixed(0)} min`);
  // Name the single slowest station — that is the one worth widening.
  const slowest = tasks
    .filter((t) => !t.locationless)
    .map((t) => ({ t, rate: (t.maxConcurrentTeams ?? 3) / Math.max(1, t.estimatedMinutes ?? 5) }))
    .sort((a, b) => a.rate - b.rate)[0];
  if (slowest) {
    console.log(`      slowest: "${slowest.t.title}" cap=${slowest.t.maxConcurrentTeams ?? 3} est=${slowest.t.estimatedMinutes ?? 5}min ⇒ ${slowest.rate.toFixed(2)} teams/min`);
  }
}
console.log(`  THROUGHPUT FLOOR ≈ ${floorMin.toFixed(0)} min (${(floorMin / 60).toFixed(1)} h) with perfect packing — real routing and walking make this longer, never shorter.`);
if (floorMin > WINDOW_MIN) {
  warn(`the throughput floor (${floorMin.toFixed(0)} min) EXCEEDS the ${WINDOW_MIN}-minute window — teams will still be held when time runs out. Raise maxConcurrentTeams on the slowest stations, or lower requiredTaskCount.`);
}

// ── 3. Geofences vs. what a phone can actually measure ───────────────────────
console.log(`\n── 3. Arrival radii vs. GPS (assumption: typical accuracy ${GPS_TYPICAL_ACCURACY_M}m) ──`);
let tight = 0;
for (const [i, s] of stages.entries()) {
  for (const t of (s.tasks ?? []) as Task[]) {
    const r = t.geofenceRadiusMeters;
    if (typeof r !== 'number') continue;
    if (r <= GEOFENCE_RISKY_M) {
      tight++;
      warn(`stage ${i} "${t.title}" [${t.type}] geofence is ${r}m — at or below typical GPS error (${GPS_TYPICAL_ACCURACY_M}m). A team standing on the spot may be told it has not arrived.`);
    }
  }
}
if (tight === 0) console.log('  ok — every arrival radius is comfortably above typical GPS error');

// ── 4. Human review burden ──────────────────────────────────────────────────
// A photo/video mission WITHOUT autoApprove parks the team until a human taps approve.
// At 100 teams that is not a UI detail, it is a staffing requirement.
console.log(`\n── 4. Review burden (assumption: ${REVIEW_MINUTES_EACH} min per submission) ──`);
let reviewed = 0;
for (const [i, s] of stages.entries()) {
  const tasks = (s.tasks ?? []) as Task[];
  const req = s.requiredTaskCount ?? tasks.length;
  for (const t of tasks) {
    if (t.type !== 'photo') continue;
    const auto = (t as any).smart?.autoApprove === true;
    // Expected takers: with a partial stage, a team does `req` of `tasks.length`.
    const share = tasks.length > 0 ? Math.min(1, req / tasks.length) : 1;
    const expected = Math.round(TEAMS * share);
    const kind = (t as any).smart?.captureKind ?? 'photo';
    if (auto) { console.log(`  auto-approved: "${t.title}" (${kind}) — no human needed`); continue; }
    reviewed += expected;
    warn(`stage ${i} "${t.title}" (${kind}) needs MANUAL review — ~${expected} submissions expected (${req} of ${tasks.length} tasks per team).`);
  }
}
if (reviewed > 0) {
  const mins = reviewed * REVIEW_MINUTES_EACH;
  console.log(`  TOTAL ≈ ${reviewed} manual reviews ⇒ ${mins.toFixed(0)} reviewer-minutes (${(mins / 60).toFixed(1)} h for ONE reviewer).`);
  console.log(`  With the ${WINDOW_MIN}-minute window that is ${Math.ceil(mins / WINDOW_MIN)} reviewer(s) working continuously, or turn on auto-approve.`);
} else if (blockers === 0) {
  console.log('  ok — no mission blocks on a human');
}

// ── 5. Upload volume (video is not photo) ───────────────────────────────────
console.log('\n── 5. Upload volume ──');
let bytes = 0;
for (const s of stages) {
  const tasks = (s.tasks ?? []) as Task[];
  const req = s.requiredTaskCount ?? tasks.length;
  const share = tasks.length > 0 ? Math.min(1, req / tasks.length) : 1;
  for (const t of tasks) {
    if (t.type !== 'photo') continue;
    const kind = (t as any).smart?.captureKind ?? 'photo';
    // Caps come from uploadRoute.js: 10MB participant photo, 20MB participant video.
    // Typical is far below the cap; we report the TYPICAL and name it as such.
    const typical = kind === 'video' ? 8 * 1024 * 1024 : 600 * 1024;
    const n = Math.round(TEAMS * share);
    bytes += n * typical;
    console.log(`  "${t.title}" (${kind}): ~${n} uploads × ~${(typical / 1024 / 1024).toFixed(1)}MB typical`);
  }
}
console.log(`  TOTAL ≈ ${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB of participant media (typical sizes, not the 10/20MB caps).`);

console.log(`\n══ ${blockers} blocker(s), ${warnings} warning(s) ══`);
console.log(blockers === 0
  ? 'No structural blocker. Warnings above are judgement calls for a human, not failures.'
  : 'BLOCKERS must be fixed — launchRun itself will refuse, or teams will strand.');
process.exit(blockers === 0 ? 0 : 1);

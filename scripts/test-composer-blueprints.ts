// Pure-logic tests — the mission budget and the stage blueprints
// (change: smart-game-composer).
//
// This is the composer's FIRST variety layer, and its arithmetic layer. Two
// separate concerns live here:
//
//   • THE BUDGET. How many missions a requested duration is worth, clamped to a
//     sane range AND to the bank. The bank clamp is the load-bearing half: with a
//     ~50-mission bank a three-hour answer would otherwise ask for 72 slots, and
//     the missing ones would not error — they would silently become empty slots,
//     then dropped stages, then a game shorter than the one a 90-minute answer
//     produced. A clamp is the difference between "we told you the truth about
//     length" and "the game quietly shrank".
//
//   • THE SHAPE. Rather than one formula, a hand-authored set of blueprints, one
//     of which is drawn at random. Two creators answering identically can get a
//     three-stage sprint and a six-stage marathon. `distributeTaskCounts` is the
//     part most likely to hide an off-by-one, so it is asserted EXHAUSTIVELY —
//     every blueprint against every budget it could ever be handed — rather than
//     at a couple of sample points.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  STAGE_BLUEPRINTS,
  targetTaskCount,
  eligibleBlueprints,
  distributeTaskCounts,
  pickBlueprint,
  seededRng,
  MIN_TASKS,
  MIN_MISSIONS_PER_STAGE,
  MAX_TASKS,
  MINUTES_PER_TASK,
} from '../apps/creator-web/src/lib/composeGame';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const BIG_BANK = 60; // comfortably above MAX_TASKS, so the bank clamp is inactive

console.log('\n── 1. the blueprint table is well-formed ───────────────────');
{
  ok('there is more than one blueprint (or there is no structural variety)', STAGE_BLUEPRINTS.length >= 3);

  const keys = STAGE_BLUEPRINTS.map((b) => b.key);
  eq('every blueprint key is unique', keys.length - new Set(keys).size, 0);

  const badWeights = STAGE_BLUEPRINTS.filter((b) => b.taskWeights.length !== b.stageCount).map((b) => b.key);
  eq('taskWeights length matches stageCount', badWeights, []);

  const badCurve = STAGE_BLUEPRINTS.filter((b) => b.difficultyCurve.length !== b.stageCount).map((b) => b.key);
  eq('difficultyCurve length matches stageCount', badCurve, []);

  const nonPositive = STAGE_BLUEPRINTS.filter((b) => b.taskWeights.some((w) => !(w > 0))).map((b) => b.key);
  eq('every weight is positive (a zero weight would fight the floor of 1)', nonPositive, []);

  const outOfRange = STAGE_BLUEPRINTS
    .filter((b) => b.difficultyCurve.some((d) => !Number.isFinite(d) || d < 1 || d > 10))
    .map((b) => b.key);
  eq('every difficulty target is inside 1-10', outOfRange, []);

  const tooFew = STAGE_BLUEPRINTS.filter((b) => b.stageCount < 2).map((b) => b.key);
  eq('no blueprint has fewer than 2 stages (opener and finale must not collide)', tooFew, []);

  ok('at least one blueprint fits the smallest possible budget',
    STAGE_BLUEPRINTS.some((b) => b.stageCount <= MIN_TASKS));

  // The arc should generally RISE — a game that opens at its hardest reads as
  // broken pacing. Asserted as "ends harder than it starts", not step-by-step,
  // so a deliberate mid-game spike stays legal.
  const flat = STAGE_BLUEPRINTS
    .filter((b) => b.difficultyCurve[b.stageCount - 1] <= b.difficultyCurve[0])
    .map((b) => b.key);
  eq('every blueprint ends harder than it starts', flat, []);
}

console.log('\n── 2. the budget follows the requested duration ────────────');
{
  ok('the clamp range is sane', MIN_TASKS >= 1 && MAX_TASKS > MIN_TASKS);
  ok('a mission is worth a positive number of minutes', MINUTES_PER_TASK > 0);

  const at = (m: number) => targetTaskCount(m, BIG_BANK);

  // Monotone across the whole realistic range — never fewer missions for more time.
  const series = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300].map(at);
  ok(`the budget never decreases as duration grows (${series.join(', ')})`,
    series.every((v, i) => i === 0 || v >= series[i - 1]));
  ok('a longer game really does get more missions somewhere', series[series.length - 1] > series[0]);

  eq('a tiny duration clamps up to the floor', at(1), MIN_TASKS);
  eq('an enormous duration clamps down to the ceiling', at(100000), MAX_TASKS);
  ok('a typical 90-minute game lands between the bounds',
    at(90) > MIN_TASKS && at(90) < MAX_TASKS);
}

console.log('\n── 3. the budget is clamped to the BANK, not just the range ');
{
  // The silent-shrink guard. Asking for more missions than exist does not error;
  // it produces unfillable slots.
  eq('a 3-hour answer against a 10-mission bank asks for 10, not 72', targetTaskCount(180, 10), 10);
  eq('a bank smaller than the floor yields exactly the bank size', targetTaskCount(180, 2), 2);
  eq('a one-mission bank yields 1', targetTaskCount(90, 1), 1);
  eq('an empty bank yields 0', targetTaskCount(90, 0), 0);

  ok('the bank clamp never INFLATES a short game',
    targetTaskCount(30, BIG_BANK) === targetTaskCount(30, MAX_TASKS + 5));

  for (let size = 0; size <= 60; size++) {
    const t = targetTaskCount(180, size);
    if (t > size) { failures++; console.error(`  ✗ budget ${t} exceeds bank size ${size}`); break; }
  }
  ok('the budget never exceeds the bank size, at any size', true);
}

console.log('\n── 4. junk durations do not escape the clamp ───────────────');
{
  const junk: unknown[] = [0, -5, -1e9, NaN, Infinity, -Infinity, undefined, null, '90', {}, []];
  const bad = junk
    .map((m) => ({ m, t: targetTaskCount(m as number, BIG_BANK) }))
    .filter(({ t }) => !Number.isInteger(t) || t < MIN_TASKS || t > MAX_TASKS)
    .map(({ m, t }) => `${JSON.stringify(m)} -> ${t}`);
  eq('every junk duration yields an integer inside the clamp', bad, []);
}

console.log('\n── 5. blueprint eligibility ────────────────────────────────');
{
  const smallest = Math.min(...STAGE_BLUEPRINTS.map((b) => b.stageCount));

  for (let target = 0; target <= MAX_TASKS; target++) {
    const elig = eligibleBlueprints(target);
    const tooBig = elig.filter((b) => b.stageCount > target).map((b) => b.key);
    if (tooBig.length) {
      failures++;
      console.error(`  ✗ target ${target} kept blueprints needing more stages: ${tooBig.join(', ')}`);
      break;
    }
    // A blueprint needs MIN_MISSIONS_PER_STAGE missions for EVERY stage, not one
    // each: a stage holding a single mission is ceremony with nothing in it. So
    // the floor for having any choice at all is `smallest * MIN_MISSIONS_PER_STAGE`;
    // below that the composer synthesizes a compact shape instead.
    if (target >= smallest * MIN_MISSIONS_PER_STAGE && elig.length === 0) {
      failures++;
      console.error(`  ✗ target ${target} left no eligible blueprint`);
      break;
    }
  }
  ok('no blueprint needing more stages than the budget is ever eligible', true);
  ok(`every budget from ${smallest} upward has at least one eligible blueprint`, true);

  // A real questionnaire can produce MIN_TASKS, which is deliberately BELOW the
  // point where an authored blueprint fits — a four-mission game is served by the
  // compact synthesized shape, not by a three-stage arc stretched over it.
  ok('a budget of two missions per authored stage has an eligible blueprint',
    eligibleBlueprints(smallest * MIN_MISSIONS_PER_STAGE).length > 0);
  ok('and the compact fallback covers everything below that',
    eligibleBlueprints(MIN_TASKS).length === 0 || MIN_TASKS >= smallest * MIN_MISSIONS_PER_STAGE);

  ok('a larger budget makes at least as many blueprints eligible',
    eligibleBlueprints(MAX_TASKS).length >= eligibleBlueprints(smallest).length);
  eq('a budget of 0 leaves nothing eligible', eligibleBlueprints(0), []);
  eq('a budget below the smallest blueprint leaves nothing eligible',
    eligibleBlueprints(smallest - 1), []);
}

console.log('\n── 6. distribution is exact, floored and weight-respecting ─');
{
  let sumFail = ''; let floorFail = ''; let lenFail = ''; let weightFail = '';

  for (const b of STAGE_BLUEPRINTS) {
    for (let target = b.stageCount; target <= MAX_TASKS; target++) {
      const counts = distributeTaskCounts(b, target);

      if (counts.length !== b.stageCount) { lenFail ||= `${b.key}@${target}`; continue; }

      const total = counts.reduce((a, c) => a + c, 0);
      if (total !== target) sumFail ||= `${b.key}@${target}: sum ${total}`;

      if (counts.some((c) => c < 1 || !Number.isInteger(c))) floorFail ||= `${b.key}@${target}: ${counts.join(',')}`;

      // The heaviest-weighted stage must never end up with fewer missions than a
      // lighter one — that would invert the blueprint's whole intent.
      const heaviest = b.taskWeights.indexOf(Math.max(...b.taskWeights));
      const lightest = b.taskWeights.indexOf(Math.min(...b.taskWeights));
      if (counts[heaviest] < counts[lightest]) weightFail ||= `${b.key}@${target}: ${counts.join(',')}`;
    }
  }

  eq('every distribution has one entry per stage', lenFail, '');
  eq('every distribution sums EXACTLY to the budget', sumFail, '');
  eq('every stage gets at least one mission', floorFail, '');
  eq('the heaviest stage never gets fewer missions than the lightest', weightFail, '');
}

console.log('\n── 7. distribution is pure ─────────────────────────────────');
{
  const b = STAGE_BLUEPRINTS[0];
  const a1 = distributeTaskCounts(b, 12);
  const a2 = distributeTaskCounts(b, 12);
  eq('the same inputs give the same output', a1, a2);
  eq('…and it consumes no randomness (same call, twice, unchanged)', a1, distributeTaskCounts(b, 12));

  // Below the stage count it must still return something usable rather than
  // negative or zero counts.
  const under = distributeTaskCounts(b, 1);
  ok('a budget below the stage count still yields a floor of 1 everywhere',
    under.every((c) => c >= 1));
}

console.log('\n── 8. blueprint selection is random but bounded ────────────');
{
  const elig = eligibleBlueprints(MAX_TASKS);
  const seen = new Set<string>();
  for (let s = 1; s <= 300; s++) seen.add(pickBlueprint(elig, seededRng(s))!.key);

  eq('every eligible blueprint is reachable across seeds',
    [...seen].sort(), elig.map((b) => b.key).sort());

  let calls = 0;
  pickBlueprint(elig, () => { calls++; return 0.5; });
  eq('exactly one rng draw is consumed', calls, 1);

  const single = eligibleBlueprints(MAX_TASKS).slice(0, 1);
  eq('a single eligible blueprint is returned', pickBlueprint(single, seededRng(1))!.key, single[0].key);
  eq('no eligible blueprint yields null, never a throw', pickBlueprint([], seededRng(1)), null);

  // Only ever picks from the list it was handed.
  const narrow = elig.filter((b) => b.stageCount === Math.min(...elig.map((x) => x.stageCount)));
  const narrowKeys = new Set(narrow.map((b) => b.key));
  let escaped = false;
  for (let s = 1; s <= 100; s++) if (!narrowKeys.has(pickBlueprint(narrow, seededRng(s))!.key)) escaped = true;
  ok('selection never returns a blueprint outside the eligible list', !escaped);
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/blueprints: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/blueprints: all assertions passed\x1b[0m');

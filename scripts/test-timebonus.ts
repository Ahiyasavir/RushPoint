import { computeTimeBonus, TIME_BONUS_CAP, TIME_BONUS_PER_MINUTE } from '../functions/src/scoring/calculateScore';

let passed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ ${name}`); process.exitCode = 1; }
}

console.log('Dynamic difficulty-adjusted time bonus (computeTimeBonus):');

// Beat the target by 5 minutes → +5 * 10 = 50.
check('beats target → +perMin·ΔT', computeTimeBonus(60, 55) === 5 * TIME_BONUS_PER_MINUTE);

// Exactly on target → 0.
check('on target → 0', computeTimeBonus(60, 60) === 0);

// Slower than target → 0 (never negative; "cap at zero").
check('delayed → 0 (never negative)', computeTimeBonus(60, 75) === 0);

// Harder route (larger T_expected) yields a larger bonus for the same actual time —
// fairness: a team dealt harder tasks isn't penalised for the route they were given.
const easyRoute = computeTimeBonus(40, 35); // saved 5
const hardRoute = computeTimeBonus(70, 35); // saved 35 (capped)
check('harder route ≥ easier route for same actual', hardRoute >= easyRoute);

// Capped so the bonus can never dominate product/judging score.
check('bonus is capped', computeTimeBonus(1000, 1) === TIME_BONUS_CAP);

// Degenerate inputs → 0 (no expected/actual time).
check('zero expected → 0', computeTimeBonus(0, 30) === 0);
check('zero actual → 0', computeTimeBonus(60, 0) === 0);

// Balance invariant: the max time bonus (200) must be far below a strong crafting
// haul, so staying the full 20-min window remains mathematically superior to
// rushing the judge. We assert the cap is modest (≤ 200).
check('cap keeps crafting superior (≤200)', TIME_BONUS_CAP <= 200);

console.log(`\n${passed} checks passed.`);

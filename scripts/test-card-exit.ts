// Pure-lane test for the optimistic card-out decision helper (change:
// optimistic-card-out). RED-first: asserts resolveCardExit is total and bounded.
// Auto-discovered by scripts/run-unit-tests.mjs.
import { resolveCardExit, CARD_EXIT_MS } from '../apps/play-web/src/lib/cardExit';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else { console.log(`  ✓ ${msg}`); }
}

console.log('card-exit: reduced motion → no animation, zero delay');
{
  const r = resolveCardExit(true);
  assert(r.animate === false, 'reducedMotion true ⇒ animate === false');
  assert(r.delayMs === 0, 'reducedMotion true ⇒ delayMs === 0');
}

console.log('card-exit: motion allowed → animate, bounded positive delay');
{
  const r = resolveCardExit(false);
  assert(r.animate === true, 'reducedMotion false ⇒ animate === true');
  assert(r.delayMs === CARD_EXIT_MS, 'reducedMotion false ⇒ delayMs === CARD_EXIT_MS');
  assert(r.delayMs > 0 && r.delayMs <= 400, 'delayMs is a small strictly-positive bound (0 < d <= 400)');
}

console.log('card-exit: total — never throws for either input');
{
  let threw = false;
  try { resolveCardExit(true); resolveCardExit(false); } catch { threw = true; }
  assert(!threw, 'no throw for either input');
}

if (failures > 0) {
  console.error(`\ntest-card-exit: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\ntest-card-exit: all assertions passed');

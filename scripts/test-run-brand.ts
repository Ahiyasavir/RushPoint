// Pure-logic tests for white-label-pro (resolveRunBrand truth table).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { resolveRunBrand } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// White-label + brand → creator brand, no footer.
{
  const r = resolveRunBrand({ whiteLabel: true, brand: { name: 'Acme Quests', logoUrl: 'https://x/logo.png' } }, { name: 'My Game' });
  ok(r.whiteLabel === true, 'white-label flagged');
  ok(r.wordmark === 'Acme Quests', 'uses creator brand name');
  ok(r.logoUrl === 'https://x/logo.png', 'carries brand logo');
  ok(r.showRushpointFooter === false, 'white-label hides the footer');
}

// Standard run → RushPoint + footer.
{
  const r = resolveRunBrand({ whiteLabel: false }, { name: 'My Game' });
  ok(r.whiteLabel === false, 'standard is not white-label');
  ok(r.wordmark === 'My Game', 'standard wordmark falls back to game name');
  ok(r.showRushpointFooter === true, 'standard shows the footer');
}

// No entitlement at all → RushPoint + footer.
{
  const r = resolveRunBrand(null, null);
  ok(r.whiteLabel === false && r.wordmark === 'RushPoint' && r.showRushpointFooter === true, 'no entitlement → RushPoint + footer');
}
{
  const r = resolveRunBrand(undefined, undefined);
  ok(r.wordmark === 'RushPoint' && r.showRushpointFooter === true, 'undefined inputs → safe RushPoint default');
}

// White-label WITHOUT a brand name → safe RushPoint fallback (no half-branded state).
{
  const r = resolveRunBrand({ whiteLabel: true, brand: { logoUrl: 'https://x/logo.png' } }, { name: 'My Game' });
  ok(r.whiteLabel === false, 'white-label without a name is not effective');
  ok(r.wordmark === 'My Game', 'falls back to game/RushPoint branding');
  ok(r.showRushpointFooter === true, 'falls back with the footer (no half-branded state)');
}
{
  const r = resolveRunBrand({ whiteLabel: true, brand: { name: '   ' } }, null);
  ok(r.wordmark === 'RushPoint' && r.showRushpointFooter === true, 'blank brand name → RushPoint fallback');
}

console.log(failed === 0
  ? `\n✅ ALL RUN-BRAND TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

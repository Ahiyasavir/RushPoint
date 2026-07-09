// Pure-logic tests for live-emoji-reactions (throttle + closed emoji set).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { shouldThrottleReaction, REACTION_EMOJI, isAllowedReaction } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── shouldThrottleReaction ───────────────────────────────────────────────────
ok(shouldThrottleReaction(null, 1000, 500) === false, 'no prior reaction → allowed');
ok(shouldThrottleReaction(undefined, 1000, 500) === false, 'undefined last → allowed');
ok(shouldThrottleReaction(1000, 1200, 500) === true, 'within gap → throttled');
ok(shouldThrottleReaction(1000, 1499, 500) === true, 'just under gap → throttled');
ok(shouldThrottleReaction(1000, 1500, 500) === false, 'exactly at gap → allowed');
ok(shouldThrottleReaction(1000, 5000, 500) === false, 'well after gap → allowed');

// ── REACTION_EMOJI (closed set) ──────────────────────────────────────────────
ok(REACTION_EMOJI.length >= 4, 'a few reactions are offered');
ok(new Set(REACTION_EMOJI).size === REACTION_EMOJI.length, 'no duplicate emoji');
ok(REACTION_EMOJI.every((e) => typeof e === 'string' && e.length > 0), 'all non-empty');
ok(isAllowedReaction(REACTION_EMOJI[0]) === true, 'a member is allowed');
ok(isAllowedReaction('💩') === false, 'a non-member is rejected (closed set)');
ok(isAllowedReaction('not an emoji') === false, 'free text is rejected');

console.log(failed === 0
  ? `\n✅ ALL REACTION-THROTTLE TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

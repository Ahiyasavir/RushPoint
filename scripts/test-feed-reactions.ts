// Pure-logic tests for the live photo feed reaction reducer (applyReaction).
// Change: live-photo-feed. Run by scripts/run-unit-tests.mjs via `npm test`.
// No emulator needed.
import { applyReaction, FEED_EMOJIS } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const fresh = () => ({ reactions: {} as Record<string, number>, reactedBy: {} as Record<string, string> });

// ── Emoji set ────────────────────────────────────────────────────────────────
ok(FEED_EMOJIS.length === 4, 'FEED_EMOJIS has exactly 4 entries');
ok(new Set(FEED_EMOJIS).size === 4, 'FEED_EMOJIS entries are distinct');

// ── Invalid emoji throws ─────────────────────────────────────────────────────
{
  let threw = false;
  try { applyReaction(fresh(), 'uid-a', '💀'); } catch { threw = true; }
  ok(threw, 'emoji outside FEED_EMOJIS throws');
}
{
  let threw = false;
  try { applyReaction(fresh(), 'uid-a', ''); } catch { threw = true; }
  ok(threw, 'empty emoji throws');
}

const [E1, E2] = [FEED_EMOJIS[0], FEED_EMOJIS[1]];

// ── First reaction ───────────────────────────────────────────────────────────
{
  const r = applyReaction(fresh(), 'uid-a', E1);
  ok(r.changed === true, 'first reaction reports changed');
  ok(r.reactions[E1] === 1, 'first reaction increments the count to 1');
  ok(r.reactedBy['uid-a'] === E1, 'first reaction records reactedBy[uid]');
}

// ── Same emoji again is a no-op ──────────────────────────────────────────────
{
  const once = applyReaction(fresh(), 'uid-a', E1);
  const twice = applyReaction(once, 'uid-a', E1);
  ok(twice.changed === false, 'repeat of the same emoji is a no-op (changed:false)');
  ok(twice.reactions[E1] === 1, 'repeat never double-counts');
  ok(twice.reactedBy['uid-a'] === E1, 'repeat keeps reactedBy unchanged');
}

// ── Switching emoji moves the count ──────────────────────────────────────────
{
  const once = applyReaction(fresh(), 'uid-a', E1);
  const switched = applyReaction(once, 'uid-a', E2);
  ok(switched.changed === true, 'emoji switch reports changed');
  ok(switched.reactions[E2] === 1, 'emoji switch increments the new emoji');
  ok(!(E1 in switched.reactions), 'emoji switch drops the old zeroed key');
  ok(switched.reactedBy['uid-a'] === E2, 'emoji switch updates reactedBy');
}

// ── Switch with other reactors keeps the old count positive ──────────────────
{
  let s = applyReaction(fresh(), 'uid-a', E1);
  s = applyReaction(s, 'uid-b', E1);
  s = applyReaction(s, 'uid-a', E2);
  ok(s.reactions[E1] === 1, 'switch decrements old emoji but keeps other uid count');
  ok(s.reactions[E2] === 1, 'switch adds the new emoji count');
  ok(s.reactedBy['uid-b'] === E1, 'other uid reactedBy untouched');
}

// ── Counts never go negative even on corrupt input ───────────────────────────
{
  const corrupt = { reactions: {} as Record<string, number>, reactedBy: { 'uid-a': E1 } };
  const r = applyReaction(corrupt, 'uid-a', E2);
  ok((r.reactions[E1] ?? 0) >= 0, 'decrement floors at 0 (never negative)');
  ok(r.reactions[E2] === 1, 'corrupt input still counts the new emoji');
}

// ── Independent uids accumulate ──────────────────────────────────────────────
{
  let s = fresh() as { reactions: Record<string, number>; reactedBy: Record<string, string> };
  for (const uidN of ['u1', 'u2', 'u3']) s = applyReaction(s, uidN, E1);
  ok(s.reactions[E1] === 3, 'independent uids accumulate the count');
  ok(Object.keys(s.reactedBy).length === 3, 'every uid recorded in reactedBy');
}

// ── Purity: the input object is not mutated ──────────────────────────────────
{
  const input = fresh();
  applyReaction(input, 'uid-a', E1);
  ok(Object.keys(input.reactions).length === 0 && Object.keys(input.reactedBy).length === 0,
    'applyReaction does not mutate its input');
}

console.log(failed === 0
  ? `\n✅ ALL FEED-REACTION TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

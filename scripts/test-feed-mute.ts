// Pure-logic tests for the live photo feed per-device mute helpers.
// Change: feed-ugc-safety. Run by scripts/run-unit-tests.mjs via `npm test`.
// No emulator needed. Mirrors scripts/test-feed-reactions.ts's style.
import {
  addMutedItem,
  addMutedTeam,
  isFeedItemMuted,
  parseFeedMute,
  serializeFeedMute,
  EMPTY_FEED_MUTE,
} from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── Empty state shape ────────────────────────────────────────────────────────
ok(Array.isArray(EMPTY_FEED_MUTE.items) && EMPTY_FEED_MUTE.items.length === 0, 'EMPTY_FEED_MUTE.items is an empty array');
ok(Array.isArray(EMPTY_FEED_MUTE.teams) && EMPTY_FEED_MUTE.teams.length === 0, 'EMPTY_FEED_MUTE.teams is an empty array');

// ── addMutedItem is immutable + deduped + order-stable ──────────────────────
{
  const s0 = EMPTY_FEED_MUTE;
  const s1 = addMutedItem(s0, 'item-a');
  ok(s0.items.length === 0, 'addMutedItem does not mutate the input state');
  ok(s1.items.length === 1 && s1.items[0] === 'item-a', 'addMutedItem adds the item id');
  const s2 = addMutedItem(s1, 'item-b');
  const s3 = addMutedItem(s2, 'item-a'); // duplicate
  ok(s3.items.length === 2, 'addMutedItem dedupes a repeat id');
  ok(s3.items[0] === 'item-a' && s3.items[1] === 'item-b', 'addMutedItem preserves insertion order');
}

// ── addMutedTeam is immutable + deduped ──────────────────────────────────────
{
  const s0 = EMPTY_FEED_MUTE;
  const s1 = addMutedTeam(s0, 'team-a');
  ok(s0.teams.length === 0, 'addMutedTeam does not mutate the input state');
  ok(s1.teams.length === 1 && s1.teams[0] === 'team-a', 'addMutedTeam adds the team id');
  const s2 = addMutedTeam(s1, 'team-a');
  ok(s2.teams.length === 1, 'addMutedTeam dedupes a repeat id');
}

// ── isFeedItemMuted matches by item id AND by team id ────────────────────────
{
  let s = addMutedItem(EMPTY_FEED_MUTE, 'item-a');
  ok(isFeedItemMuted(s, { id: 'item-a', teamId: 'team-x' }) === true, 'matches by muted item id');
  ok(isFeedItemMuted(s, { id: 'item-b', teamId: 'team-x' }) === false, 'unmuted item id + unmuted team → not muted');
  s = addMutedTeam(s, 'team-y');
  ok(isFeedItemMuted(s, { id: 'item-z', teamId: 'team-y' }) === true, 'matches by muted team id');
  ok(isFeedItemMuted(s, { id: 'item-z', teamId: 'team-other' }) === false, 'different team id is not muted');
}

// ── parseFeedMute tolerates junk ─────────────────────────────────────────────
{
  const a = parseFeedMute(null);
  ok(a.items.length === 0 && a.teams.length === 0, 'parseFeedMute(null) returns the empty state');
  const b = parseFeedMute('{{not json');
  ok(b.items.length === 0 && b.teams.length === 0, 'parseFeedMute(malformed) returns the empty state without throwing');
  const c = parseFeedMute('null');
  ok(c.items.length === 0 && c.teams.length === 0, 'parseFeedMute("null") returns the empty state');
  const d = parseFeedMute('{"items":"not-an-array","teams":123}');
  ok(Array.isArray(d.items) && Array.isArray(d.teams), 'parseFeedMute tolerates wrong-shaped fields');
}

// ── round-trip serialize → parse is identity ─────────────────────────────────
{
  let s = addMutedItem(EMPTY_FEED_MUTE, 'item-a');
  s = addMutedTeam(s, 'team-b');
  const raw = serializeFeedMute(s);
  const parsed = parseFeedMute(raw);
  ok(JSON.stringify(parsed.items) === JSON.stringify(s.items), 'round-trip preserves items');
  ok(JSON.stringify(parsed.teams) === JSON.stringify(s.teams), 'round-trip preserves teams');
}

console.log(failed === 0
  ? `\n✅ ALL FEED-MUTE TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

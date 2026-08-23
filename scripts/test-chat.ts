// Pure-logic tests for team ↔ HQ chat helpers (sanitizeChatText / appendCapped).
// Change: team-hq-chat. Run by scripts/run-unit-tests.mjs via `npm test`.
// No emulator needed.
import {
  sanitizeChatText, appendCapped, CHAT_MAX_MESSAGES,
  chatSeenMarker, countUnreadChatMessages, parseChatSeen, serializeChatSeen, chatSeenStorageKey,
  type ChatMessage, type ChatSeenMarker,
} from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── sanitizeChatText ──────────────────────────────────────────────────────────
ok(sanitizeChatText('  hello  ') === 'hello', 'trims surrounding whitespace');
ok(sanitizeChatText('hithere') === 'hithere', 'strips ASCII control chars (BEL)');
ok(sanitizeChatText('line1\nline2') === 'line1\nline2', 'keeps newline');
ok(sanitizeChatText('a\tb') === 'a b', 'normalizes tab to a space');
ok(sanitizeChatText('') === null, 'empty string → null');
ok(sanitizeChatText('   ') === null, 'whitespace-only → null');
ok(sanitizeChatText(42 as unknown) === null, 'non-string → null');
ok(sanitizeChatText(null) === null, 'null → null');
ok(sanitizeChatText(undefined) === null, 'undefined → null');
ok(sanitizeChatText('x'.repeat(500)) === 'x'.repeat(500), 'exactly 500 chars → ok');
ok(sanitizeChatText('x'.repeat(501)) === null, '501 chars → null');
ok(sanitizeChatText('  ' + 'x'.repeat(500) + '  ') === 'x'.repeat(500), '500 chars after trim → ok');

// ── appendCapped ──────────────────────────────────────────────────────────────
ok(CHAT_MAX_MESSAGES === 100, 'CHAT_MAX_MESSAGES === 100');

const mk = (id: string): ChatMessage => ({
  id, from: 'team', senderName: 'T', text: id, at: `2020-01-01T00:00:${id}Z`,
});

// Append at < cap grows by one, in order.
{
  const base = [mk('01'), mk('02')];
  const out = appendCapped(base, mk('03'));
  ok(out.length === 3, 'append below cap grows by one');
  ok(out[2].id === '03', 'new message appended last');
  ok(out[0].id === '01' && out[1].id === '02', 'order preserved on append');
  ok(base.length === 2, 'input array not mutated on append');
}

// At cap, the OLDEST is dropped and newest kept.
{
  const full: ChatMessage[] = [];
  for (let i = 0; i < CHAT_MAX_MESSAGES; i++) full.push(mk(String(i).padStart(3, '0')));
  const out = appendCapped(full, mk('NEW'));
  ok(out.length === CHAT_MAX_MESSAGES, 'stays capped at CHAT_MAX_MESSAGES');
  ok(out[out.length - 1].id === 'NEW', 'newest message retained');
  ok(out[0].id === '001', 'oldest message dropped');
  ok(full.length === CHAT_MAX_MESSAGES, 'input array not mutated at cap');
}

// ── unread bookkeeping (change: team-chat-unread-accuracy) ────────────────────
// The unread decision is viewer-relative and anchored on the last-seen message
// ID — never on a count (useless once the 100-cap starts evicting) and never on
// the `at` timestamp (server clock: ties, retries and skew are all possible).
const ME = 'uid-me';
const HQ = 'uid-hq';
const MATE = 'uid-mate';

/** A message with an explicit author + optional timestamp override. */
const msg = (id: string, senderId: string, at = `2020-01-01T00:00:${id}Z`): ChatMessage => ({
  id,
  from: senderId === HQ ? 'hq' : 'team',
  senderId,
  senderName: senderId,
  text: id,
  at,
});

// 1. Empty chat is never unread, whatever the marker says.
ok(countUnreadChatMessages([], null, ME) === 0, 'empty thread + no marker → 0');
ok(countUnreadChatMessages([], { lastSeenId: 'gone' }, ME) === 0, 'empty thread + stale marker → 0');
ok(countUnreadChatMessages(null, { count: 3 }, ME) === 0, 'null messages → 0');
ok(countUnreadChatMessages(undefined, undefined, ME) === 0, 'undefined messages → 0');

// 2/3. Fresh join: no marker ⇒ everything the viewer did not write is unread.
{
  const thread = [msg('01', HQ), msg('02', HQ), msg('03', HQ)];
  ok(countUnreadChatMessages(thread, undefined, ME) === 3, 'fresh join → all 3 unread');
  ok(countUnreadChatMessages(thread, {}, ME) === 3, 'fresh join (empty marker) → all 3 unread');
  const mixed = [msg('01', HQ), msg('02', ME), msg('03', HQ)];
  ok(countUnreadChatMessages(mixed, undefined, ME) === 2, 'fresh join skips my own message');
}

// 4/5/6/7. Reload behaviour: the marker is the last message the viewer saw.
{
  const seenThread = [msg('01', HQ), msg('02', HQ)];
  const marker = chatSeenMarker(seenThread);
  ok(marker.lastSeenId === '02', 'chatSeenMarker anchors on the last message id');
  ok(countUnreadChatMessages(seenThread, marker, ME) === 0, 'reload, no new messages → 0');

  const plusTwo = [...seenThread, msg('03', HQ), msg('04', MATE)];
  ok(countUnreadChatMessages(plusTwo, marker, ME) === 2, 'reload, 2 new → 2');

  const plusMine = [...seenThread, msg('03', ME)];
  ok(countUnreadChatMessages(plusMine, marker, ME) === 0, 'reload, only my own new message → 0');

  const plusOne = [...seenThread, msg('03', HQ)];
  ok(countUnreadChatMessages(plusOne, marker, ME) === 1, 'the anchored message itself is never unread');
  ok(countUnreadChatMessages(plusOne, chatSeenMarker(plusOne), ME) === 0, 'anchor at the very end → 0');
}

// 8. Timestamp ties: three messages share one `at`, the anchor is the middle one.
{
  const tie = '2020-01-01T00:00:00.000Z';
  const thread = [msg('01', HQ, tie), msg('02', HQ, tie), msg('03', HQ, tie)];
  ok(countUnreadChatMessages(thread, { lastSeenId: '02' }, ME) === 1,
    'identical timestamps → position decides, not time');
}

// 9. Clock skew: `at` decreases down the array; the id anchor must still cut exactly.
{
  const thread = [
    msg('01', HQ, '2020-01-01T00:00:09Z'),
    msg('02', HQ, '2020-01-01T00:00:05Z'),
    msg('03', HQ, '2020-01-01T00:00:01Z'),
  ];
  ok(countUnreadChatMessages(thread, { lastSeenId: '01' }, ME) === 2,
    'out-of-order timestamps do not hide newer messages');
  ok(countUnreadChatMessages(thread, { lastSeenId: '03' }, ME) === 0,
    'out-of-order timestamps do not invent unread messages');
}

// 10. Shared team devices: a teammate's line is unread here, mine is not.
{
  const thread = [msg('01', HQ), msg('02', MATE), msg('03', ME)];
  ok(countUnreadChatMessages(thread, { lastSeenId: '01' }, ME) === 1,
    'teammate message unread, own message not');
  ok(countUnreadChatMessages(thread, { lastSeenId: '01' }, MATE) === 1,
    "the teammate's own device does not count that same message");
  ok(countUnreadChatMessages(thread, { lastSeenId: '01' }, null) === 2,
    'no viewer identity → nothing is treated as own');
}

// 11. Cap eviction: the anchor has been dropped ⇒ everything retained is newer.
{
  const thread = [msg('50', HQ), msg('51', ME), msg('52', MATE)];
  ok(countUnreadChatMessages(thread, { lastSeenId: 'evicted-id' }, ME) === 2,
    'evicted anchor → all retained non-own messages unread');
}

// 12/13. Legacy count-only markers (pre-upgrade localStorage values).
{
  const thread = [msg('01', HQ), msg('02', HQ), msg('03', HQ), msg('04', HQ)];
  ok(countUnreadChatMessages(thread, { count: 2 }, ME) === 2, 'legacy count marker cuts by index');
  ok(countUnreadChatMessages(thread, { count: 4 }, ME) === 0, 'legacy count == length → 0');
  ok(countUnreadChatMessages(thread, { count: 99 }, ME) === 0, 'legacy count past the end → 0, never negative');
  ok(countUnreadChatMessages(thread, { count: -5 }, ME) === 4, 'negative legacy count clamps to 0');
}

// 14. Storage round-trip, legacy bare numbers, and garbage.
{
  const m: ChatSeenMarker = { lastSeenId: 'abc', count: 7 };
  const back = parseChatSeen(serializeChatSeen(m));
  ok(back.lastSeenId === 'abc' && back.count === 7, 'marker survives a storage round-trip');
  ok(parseChatSeen('5').count === 5 && !parseChatSeen('5').lastSeenId, 'legacy bare number → count marker');
  ok(parseChatSeen(null).lastSeenId == null && parseChatSeen(null).count == null, 'null → empty marker');
  ok(parseChatSeen('{not json').lastSeenId == null, 'garbage → empty marker');
  ok(parseChatSeen('{"lastSeenId":42}').lastSeenId == null, 'non-string id → ignored');
  ok(countUnreadChatMessages([msg('01', HQ)], parseChatSeen(null), ME) === 1, 'empty marker behaves as fresh');
}

// 15/16. Marker for an empty thread; inputs are never mutated.
{
  ok(!chatSeenMarker([]).lastSeenId, 'chatSeenMarker([]) has no anchor');
  ok(chatSeenMarker([]).count === 0, 'chatSeenMarker([]) counts zero');
  const thread = [msg('01', HQ), msg('02', HQ)];
  const before = thread.slice();
  countUnreadChatMessages(thread, { lastSeenId: '01' }, ME);
  chatSeenMarker(thread);
  ok(thread.length === before.length && thread.every((x, i) => x === before[i]),
    'unread helpers never mutate their input');
}

// Storage key: one namespace shared by both apps, scoped per run + team.
{
  const k = chatSeenStorageKey('run1', 'teamA');
  ok(k.includes('run1') && k.includes('teamA'), 'storage key is scoped per run + team');
  ok(k !== chatSeenStorageKey('run2', 'teamA'), 'different runs use different keys');
  ok(k !== chatSeenStorageKey('run1', 'teamB'), 'different teams use different keys');
}

console.log(failed === 0
  ? `\n✅ ALL CHAT TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

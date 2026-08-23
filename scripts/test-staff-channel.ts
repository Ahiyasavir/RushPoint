// Pure-logic tests for the staff ↔ admin channel (change: staff-console-field-ops).
// Run by scripts/run-unit-tests.mjs via `npm test`. No emulator needed.
//
// The channel is ONE shared thread per run between the field marshals and the run's
// owner. It reuses the team-chat message plumbing (sanitizeChatText / appendCapped /
// the seen-marker helpers) deliberately — those are already proven — so the only new
// pure logic is the attribution rule and the run-scoped storage key. Both are pinned
// here because both are trust-adjacent: attribution decides whose name a field
// instruction carries, and the storage key decides whether two runs on one device can
// clobber each other's unread state.
import {
  staffChannelMessageSide,
  staffChannelSeenStorageKey,
  appendCapped,
  countUnreadChatMessages,
  sanitizeChatText,
  CHAT_MAX_MESSAGES,
  type StaffChannelMessage,
} from '../packages/shared/src/chat';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const ME = 'uid-me';
const OWNER = 'uid-owner';
const OTHER_STAFF = 'uid-other-staff';

const mk = (over: Partial<StaffChannelMessage>): StaffChannelMessage => ({
  id: 'x', from: 'staff', senderId: ME, senderName: 'Marshal', text: 'hi',
  at: '2020-01-01T00:00:00Z',
  ...over,
});

// ── Attribution: senderId WINS over `from`, exactly like chatMessageSide ─────────
// The load-bearing case: an owner is also allowed to hold a staff PIN, and a marshal
// reading the thread must see their OWN lines as theirs regardless of which role the
// server stamped them with.
ok(staffChannelMessageSide(mk({ senderId: ME, from: 'staff' }), ME) === 'me',
  "my own staff message reads as 'me'");
ok(staffChannelMessageSide(mk({ senderId: ME, from: 'admin' }), ME) === 'me',
  "my own message stamped from:'admin' still reads as 'me' (senderId wins)");
ok(staffChannelMessageSide(mk({ senderId: OWNER, from: 'admin' }), ME) === 'admin',
  "the admin's message reads as 'admin' from a marshal's angle");
ok(staffChannelMessageSide(mk({ senderId: OTHER_STAFF, from: 'staff' }), ME) === 'other',
  "another marshal's message reads as 'other'");
ok(staffChannelMessageSide(mk({ senderId: ME, from: 'staff' }), OWNER) === 'other',
  "from the ADMIN's angle, a marshal's line reads as 'other'");

// ── Legacy / defensive: no senderId falls back to `from`, never over-claims ──────
ok(staffChannelMessageSide({ from: 'admin' }, ME) === 'admin',
  "message with no senderId falls back to `from`");
ok(staffChannelMessageSide({ from: 'staff' }, ME) === 'other',
  "a senderId-less staff line cannot be claimed as mine");
ok(staffChannelMessageSide({ senderId: ME, from: 'staff' }, null) === 'other',
  "no viewer uid → cannot be 'me'");
ok(staffChannelMessageSide({ senderId: ME, from: 'admin' }, undefined) === 'admin',
  "undefined viewer uid → falls back to `from`");

// ── Storage key: run-scoped, NOT team-scoped (there is one thread per run) ───────
ok(staffChannelSeenStorageKey('run-a') !== staffChannelSeenStorageKey('run-b'),
  'two runs on one device get distinct seen-markers');
ok(staffChannelSeenStorageKey('run-a') === staffChannelSeenStorageKey('run-a'),
  'the key is stable for the same run');
ok(!staffChannelSeenStorageKey('run-a').includes('undefined'),
  'the key never carries an undefined segment (no teamId component exists)');

// ── The reused helpers really do work on the new message shape ──────────────────
// This is the whole justification for a parallel type instead of a new subsystem:
// if these stop working on StaffChannelMessage, the reuse decision is wrong.
{
  const thread: StaffChannelMessage[] = [];
  const a = mk({ id: 'm1', senderId: OTHER_STAFF });
  const b = mk({ id: 'm2', senderId: ME });
  const withA = appendCapped(thread, a);
  const withB = appendCapped(withA, b);
  ok(withB.length === 2 && withB[1].id === 'm2', 'appendCapped appends in order');
  ok(withA.length === 1, 'appendCapped never mutates its input');
  // Unread must exclude the viewer's OWN lines — a marshal who just posted should
  // not see their own message as unread activity.
  ok(countUnreadChatMessages(withB, {}, ME) === 1,
    "unread counts the other party's line but not my own");
  ok(countUnreadChatMessages(withB, { lastSeenId: 'm2' }, ME) === 0,
    'nothing is unread once the marker anchors on the last message');
}

// ── Text sanitation is the same trust boundary as team chat ─────────────────────
ok(sanitizeChatText('  station 3 is blocked  ') === 'station 3 is blocked',
  'text is trimmed');
ok(sanitizeChatText('') === null, 'empty text is refused');
ok(sanitizeChatText('x'.repeat(100_000)) === null, 'over-long text is refused');
ok(sanitizeChatText(42 as never) === null, 'a non-string is refused');

// ── The cap is shared, so a long event cannot grow the doc without bound ────────
{
  let thread: StaffChannelMessage[] = [];
  for (let i = 0; i < CHAT_MAX_MESSAGES + 25; i++) {
    thread = appendCapped(thread, mk({ id: `m${i}` }));
  }
  ok(thread.length === CHAT_MAX_MESSAGES, 'the thread is capped at CHAT_MAX_MESSAGES');
  ok(thread[thread.length - 1].id === `m${CHAT_MAX_MESSAGES + 24}`,
    'the cap evicts from the FRONT, keeping the most recent messages');
}

console.log(failed === 0
  ? `\n✅ ALL STAFF CHANNEL TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

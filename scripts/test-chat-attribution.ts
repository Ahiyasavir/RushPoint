// Pure-logic tests for team ↔ HQ chat SENDER ATTRIBUTION (chatMessageSide).
// Change: fix-chat-sender-attribution. Run by scripts/run-unit-tests.mjs via `npm test`.
// No emulator needed. Imports the SOURCE (not dist) so it proves the fix directly.
//
// The bug: on the player's chat panel EVERY message showed "המטה" (HQ) as the sender,
// including the player's own. Root cause — the server stamps a message from:'hq'
// whenever the caller uid === ownerUid (the owner playing/test-driving their OWN game),
// and the client labeled purely by `from` with no way to recover the true author. The
// fix stamps `senderId` and decides the side by comparing it to the viewer's uid.
import { chatMessageSide, type ChatMessage } from '../packages/shared/src/chat';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const ME = 'uid-me';
const OWNER = 'uid-owner';
const STAFF = 'uid-staff';
const MATE = 'uid-teammate';

const mk = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'x', from: 'team', senderId: ME, senderName: 'T', text: 'hi', at: '2020-01-01T00:00:00Z',
  ...over,
});

// ── THE PREVIOUSLY-BROKEN CASE (RED before the fix) ──────────────────────────────
// An owner playing their OWN game: server stamps from:'hq' (uid === ownerUid), but the
// senderId is the viewer's own uid. It MUST read as 'me', never 'hq'. Before senderId
// existed the client saw from:'hq' and labeled it "המטה" — that is the screenshot bug.
ok(chatMessageSide({ senderId: ME, from: 'hq' }, ME) === 'me',
  "owner-as-player's OWN message (stamped from:'hq') reads as 'me', not 'hq'");

// ── The plain participant cases ──────────────────────────────────────────────────
ok(chatMessageSide(mk({ senderId: ME, from: 'team' }), ME) === 'me',
  "my own team message reads as 'me'");
ok(chatMessageSide(mk({ senderId: MATE, from: 'team' }), ME) === 'other',
  "a teammate's message (different uid, same team) reads as 'other'");

// ── HQ / staff cases ─────────────────────────────────────────────────────────────
ok(chatMessageSide({ senderId: STAFF, from: 'hq' }, ME) === 'hq',
  "a real HQ reply (someone else, from:'hq') reads as 'hq'");
ok(chatMessageSide({ senderId: OWNER, from: 'hq' }, OWNER) === 'me',
  "from the STAFF viewer's angle, their own HQ reply reads as 'me'");
ok(chatMessageSide({ senderId: STAFF, from: 'hq' }, OWNER) === 'hq',
  "from a staffer's angle, ANOTHER HQ member's reply reads as 'hq'");

// ── Backward-compat: legacy messages with no senderId fall back to `from` ─────────
ok(chatMessageSide({ from: 'hq' }, ME) === 'hq',
  "legacy hq message (no senderId) still reads as 'hq'");
ok(chatMessageSide({ from: 'team' }, ME) === 'other',
  "legacy team message (no senderId) reads as 'other' (can't claim it as mine)");

// ── Null / missing viewer uid never crashes and never over-claims ────────────────
ok(chatMessageSide({ senderId: ME, from: 'team' }, null) === 'other',
  "no viewer uid → cannot be 'me'");
ok(chatMessageSide({ senderId: ME, from: 'hq' }, undefined) === 'hq',
  "undefined viewer uid → falls back to `from`");

console.log(failed === 0
  ? `\n✅ ALL CHAT ATTRIBUTION TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

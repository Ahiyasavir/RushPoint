// Pure-logic tests for team ↔ HQ chat helpers (sanitizeChatText / appendCapped).
// Change: team-hq-chat. Run by scripts/run-unit-tests.mjs via `npm test`.
// No emulator needed.
import { sanitizeChatText, appendCapped, CHAT_MAX_MESSAGES, type ChatMessage } from '@rushpoint/shared';

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

console.log(failed === 0
  ? `\n✅ ALL CHAT TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

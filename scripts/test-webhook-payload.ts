// Pure-logic tests for chat-integrations webhook payloads + SSRF guard.
// Run by scripts/run-unit-tests.mjs via `npm test`. No network.
import {
  isAllowedWebhookUrl, detectPlatform, buildSlackPayload, buildTeamsPayload, buildWebhookPayload,
} from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── SSRF guard ──
ok(isAllowedWebhookUrl('https://hooks.slack.com/services/T/B/xyz') === true, 'slack host allowed');
ok(isAllowedWebhookUrl('https://mytenant.webhook.office.com/webhookb2/abc') === true, 'teams host allowed');
ok(isAllowedWebhookUrl('https://prod-1.westus.logic.azure.com/workflows/x') === true, 'power-automate host allowed');
ok(isAllowedWebhookUrl('http://hooks.slack.com/x') === false, 'http rejected (https only)');
ok(isAllowedWebhookUrl('https://evil.example.com/x') === false, 'unknown host rejected');
ok(isAllowedWebhookUrl('https://localhost/x') === false, 'localhost rejected');
ok(isAllowedWebhookUrl('https://127.0.0.1/x') === false, 'ip-literal rejected');
ok(isAllowedWebhookUrl('https://hooks.slack.com.evil.com/x') === false, 'suffix-spoof rejected');
ok(isAllowedWebhookUrl('') === false, 'empty rejected');
ok(isAllowedWebhookUrl(null) === false, 'null rejected');
ok(isAllowedWebhookUrl('not a url') === false, 'garbage rejected');

// ── platform detection ──
ok(detectPlatform('https://hooks.slack.com/services/x') === 'slack', 'detect slack');
ok(detectPlatform('https://x.webhook.office.com/y') === 'teams', 'detect teams');

// ── Slack payloads ──
const sAnn = buildSlackPayload({ kind: 'announcement', gameTitle: 'City Hunt', message: 'Head to the plaza' });
ok(sAnn.text.includes('City Hunt') && sAnn.text.includes('Head to the plaza'), 'slack announcement text');
const sFlash = buildSlackPayload({ kind: 'flashMission', gameTitle: 'G', title: 'Selfie sprint', message: 'Now!', bonusPoints: 50 });
ok(sFlash.text.includes('Selfie sprint') && sFlash.text.includes('+50 pts'), 'slack flash mission with bonus');
const sBoard = buildSlackPayload({ kind: 'leaderboard', gameTitle: 'G', leaders: [
  { rank: 1, teamName: 'Reds', score: 120 }, { rank: 2, teamName: 'Blues', score: 90 },
] });
ok(sBoard.text.includes('1. Reds — 120') && sBoard.text.includes('2. Blues — 90'), 'slack leaderboard rows');

// ── Teams payloads ──
const tAnn = buildTeamsPayload({ kind: 'announcement', gameTitle: 'City Hunt', message: 'Go' });
ok(tAnn['@type'] === 'MessageCard' && tAnn.title === '📢 City Hunt' && tAnn.text === 'Go', 'teams MessageCard shape');
ok(typeof tAnn.themeColor === 'string', 'teams themeColor present');

// ── dispatcher ──
ok((buildWebhookPayload({ kind: 'announcement', gameTitle: 'G', message: 'm' }, 'teams'))['@type'] === 'MessageCard', 'dispatch → teams');
ok('text' in buildWebhookPayload({ kind: 'announcement', gameTitle: 'G', message: 'm' }, 'slack'), 'dispatch → slack');
ok('text' in buildWebhookPayload({ kind: 'announcement', gameTitle: 'G', message: 'm' }), 'dispatch default → slack');

// leaderboard caps at 5 rows
const many = Array.from({ length: 8 }, (_, i) => ({ rank: i + 1, teamName: `T${i}`, score: 100 - i }));
const capped = buildSlackPayload({ kind: 'leaderboard', gameTitle: 'G', leaders: many });
ok(!capped.text.includes('T5'), 'slack leaderboard caps at top 5 (T5 = rank 6 excluded)');

console.log(failed === 0
  ? `\n✅ ALL WEBHOOK-PAYLOAD TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

// Multi-phone race capacity (change: race-multi-phone-capacity, 2026-10-10).
//
// A 35-team school race with 3-6 phones per team. Two properties of the SOURCE decide whether
// that fits the Spark day and whether the joining minute is fast, and neither is visible to any
// emulator lane (the doc cache is off there, and the emulator has no real lock contention):
//
//   1. The server's document cache must OUTLIVE the participant's fallback poll. With a 30s TTL
//      and a 60s poll, every poll from a quiet team missed the cache and re-read its team doc.
//   2. Attaching a phone must not read-lock the ONE run document. joinRun was moved off that
//      transaction after it measured p50 12s at 120 joins; joinTeamAsDevice still held it, and
//      a race starts with every extra phone attaching in the same few minutes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractBody } from './lib/hotPathReads.mjs';

let passed = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); passed++; console.log(`  ok  ${label}`); }
  catch (e) { console.error(`  FAIL  ${label}\n        ${(e as Error).message}`); process.exitCode = 1; }
};
const read = (f: string) => readFileSync(f, 'utf8');

console.log('\n── cache outlives the participant poll ──');

t('the doc-cache TTL is longer than play-web\'s fallback poll', () => {
  const ttl = /ttlMs:\s*([\d_]+)/.exec(read('functions/src/firebase.ts'));
  const poll = /setInterval\(\(\)\s*=>\s*\{\s*void refresh\(\);\s*\},\s*([\d_]+)\)/.exec(read('apps/play-web/src/screens/PlayScreen.tsx'));
  assert.ok(ttl, 'ttlMs not found in functions/src/firebase.ts — renamed?');
  assert.ok(poll, 'the fallback poll interval was not found in PlayScreen.tsx — renamed?');
  const ttlMs = Number(ttl[1].replace(/_/g, ''));
  const pollMs = Number(poll[1].replace(/_/g, ''));
  assert.ok(ttlMs > pollMs, `TTL ${ttlMs}ms <= poll ${pollMs}ms: every quiet poll re-reads Firestore`);
});

console.log('\n── attaching a phone does not lock the run document ──');

const join = extractBody(read('functions/src/runs/index.ts'), 'joinTeamAsDevice');
t('joinTeamAsDevice is found', () => { assert.ok(join, 'joinTeamAsDevice not found — renamed?'); });
t('the attach transaction does not read the run document', () => {
  assert.ok(!/tx\.get\(runRef\)/.test(join ?? ''), 'tx.get(runRef) puts every phone of every team on one lock');
});
t('the run device counter moves by an atomic increment', () => {
  assert.ok(/deviceCount:\s*FieldValue\.increment\(1\)/.test(join ?? ''), 'deviceCount must use FieldValue.increment(1)');
});
t('the run-wide device ceiling is still enforced', () => {
  assert.ok(/canAddRunDevice\(/.test(join ?? ''), 'the MAX_RUN_DEVICES check disappeared');
});

// NEGATIVE CONTROL: the shape this change removes must fail.
t('the guard rejects the pre-change transaction shape', () => {
  const before = 'const [snap, runFresh] = await Promise.all([tx.get(teamRef), tx.get(runRef)]);'
    + " tx.update(runRef, { deviceCount: usedDevices + 1 });";
  assert.ok(/tx\.get\(runRef\)/.test(before));
  assert.ok(!/deviceCount:\s*FieldValue\.increment\(1\)/.test(before));
});

console.log('\n── the API outlives the proxy\'s idle upstream connections ──');

// Measured in a 420-phone production load test: 2 HTTP 502s out of 260,000 calls, both logged by
// Caddy as upstream "EOF" at the same instant. Node's default keepAliveTimeout is 5s; Caddy keeps
// idle upstream connections far longer, so it occasionally sends a request down a socket Node is
// closing. Node must hold idle sockets LONGER than the proxy, and headersTimeout must exceed that.
t('server.js holds idle keep-alive sockets longer than the proxy does', () => {
  const src = read('functions/server.js');
  const ka = /server\.keepAliveTimeout\s*=\s*([\d_]+(?:\s*\*\s*[\d_]+)?)/.exec(src);
  const ht = /server\.headersTimeout\s*=\s*([\d_]+(?:\s*\*\s*[\d_]+)?)/.exec(src);
  assert.ok(ka && ht, 'server.keepAliveTimeout and server.headersTimeout must both be set explicitly');
  const num = (x: string) => x.split('*').map((p) => Number(p.trim().replace(/_/g, ''))).reduce((a, b) => a * b, 1);
  assert.ok(num(ka![1]) > 120_000, `keepAliveTimeout ${num(ka![1])}ms must exceed Caddy's 2-minute idle upstream timeout`);
  assert.ok(num(ht![1]) > num(ka![1]), 'headersTimeout must exceed keepAliveTimeout');
});

console.log(`\n${passed} assertions passed`);
if (process.exitCode) { console.error('FAILED'); process.exit(1); }

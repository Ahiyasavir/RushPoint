// The participant client's own decision to SEND a location fix at all
// (change: participant-read-budget).
//
// This gate exists because a ping the server will suppress still costs a full callable
// invocation and a Firestore read — measured at 1.00 read/call against production. At
// 100 teams over a 75-minute run that is 22,500 reads spent to write almost nothing.
//
// ⚠️ The gate can only ever cause a fix NOT to be sent, and the server evaluates the safe
// zone only when a fix arrives. So the assertions about the SAFETY FLOOR below are the
// load-bearing ones: everything else here is about cost, and those are about a player
// standing outside a boundary nobody is checking.
import assert from 'node:assert/strict';
import {
  shouldSendPing,
  PING_MAX_SILENCE_MS,
} from '../apps/play-web/src/lib/pingGate';
import { PIN_JUMP_METERS } from '../packages/shared/src/locationPingEconomy';

let passed = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); passed++; console.log(`  ok  ${label}`); }
  catch (e) { console.error(`  FAIL  ${label}\n        ${(e as Error).message}`); process.exitCode = 1; }
};

const BASE = { lat: 31.805, lng: 35.185 };
/** Move `m` metres north of BASE — far enough to reason about without trig noise. */
const north = (m: number) => ({ lat: BASE.lat + m / 111_320, lng: BASE.lng });

console.log('\n── play-web ping gate ──');

// ── Cost: the cases that must NOT be sent ───────────────────────────────────
t('a stationary team inside the interval is not sent', () => {
  const v = shouldSendPing({
    fix: { ...BASE, accuracyMeters: 8 },
    lastSent: { ...BASE, atMs: 1_000_000 },
    nowMs: 1_000_000 + 20_000,
  });
  assert.equal(v.send, false, `expected suppression, got ${JSON.stringify(v)}`);
});

t('GPS jitter within the fix error radius is not sent', () => {
  // A stationary phone reporting ±25m accuracy wanders; that is noise, not movement.
  const v = shouldSendPing({
    fix: { ...north(18), accuracyMeters: 25 },
    lastSent: { ...BASE, atMs: 2_000_000 },
    nowMs: 2_000_000 + 21_000,
  });
  assert.equal(v.send, false, `jitter should not spend a read: ${JSON.stringify(v)}`);
});

// ── Cost: the cases that MUST be sent ───────────────────────────────────────
t('the first fix is always sent', () => {
  const v = shouldSendPing({ fix: { ...BASE, accuracyMeters: 8 }, lastSent: null, nowMs: 5_000 });
  assert.equal(v.send, true);
});

t('a significant move is sent immediately, inside the interval', () => {
  const v = shouldSendPing({
    fix: { ...north(PIN_JUMP_METERS + 40), accuracyMeters: 8 },
    lastSent: { ...BASE, atMs: 3_000_000 },
    nowMs: 3_000_000 + 5_000,
  });
  assert.equal(v.send, true, `a real move must report at once: ${JSON.stringify(v)}`);
});

// ── SAFETY: the floor. These are the assertions that matter. ────────────────
t('the safety floor forces a send even when the verdict would suppress', () => {
  // The floor and the server's write interval are EQUAL today, so with the default interval
  // the floor never fires on its own — the shared verdict already says "write". To prove the
  // floor is real rather than decorative, raise the server's interval well past it: a team
  // that has not moved must STILL report once the floor elapses. This is the assertion that
  // would fail if someone later aliased the floor to the write interval.
  const SERVER_INTERVAL = 5 * 60_000;
  const v = shouldSendPing({
    fix: { ...BASE, accuracyMeters: 8 },          // has not moved at all
    lastSent: { ...BASE, atMs: 4_000_000 },
    nowMs: 4_000_000 + PING_MAX_SILENCE_MS,
    minWriteIntervalMs: SERVER_INTERVAL,
  });
  assert.equal(v.send, true, `the floor must override suppression: ${JSON.stringify(v)}`);
  assert.equal(v.reason, 'safety-floor');
});

t('a raised server write interval does NOT widen the silence window', () => {
  // The scenario the floor exists for: someone raises the server's interval to save writes.
  // A stationary team must still report every PING_MAX_SILENCE_MS, not every interval.
  const SERVER_INTERVAL = 5 * 60_000;
  let lastSent: { lat: number; lng: number; atMs: number } | null = { ...BASE, atMs: 0 };
  let lastSentAt = 0;
  let worstGap = 0;
  for (let ms = 0; ms <= 10 * 60_000; ms += 5_000) {
    const v = shouldSendPing({
      fix: { ...BASE, accuracyMeters: 10 }, lastSent, nowMs: ms, minWriteIntervalMs: SERVER_INTERVAL,
    });
    if (v.send) { lastSent = { ...BASE, atMs: ms }; lastSentAt = ms; }
    else worstGap = Math.max(worstGap, ms - lastSentAt);
  }
  assert.ok(
    worstGap <= PING_MAX_SILENCE_MS,
    `with a ${SERVER_INTERVAL}ms server interval a stationary team went ${worstGap}ms silent; `
    + `the floor (${PING_MAX_SILENCE_MS}ms) must bound it independently`,
  );
});

t('a stationary team is never silent for longer than the floor', () => {
  // Walk the clock forward in 5s steps and assert the gap between sends is bounded.
  let lastSent: { lat: number; lng: number; atMs: number } | null = null;
  let lastSentAt = 0;
  let worstGap = 0;
  for (let ms = 0; ms <= 10 * 60_000; ms += 5_000) {
    const v = shouldSendPing({ fix: { ...BASE, accuracyMeters: 10 }, lastSent, nowMs: ms });
    if (v.send) { lastSent = { ...BASE, atMs: ms }; lastSentAt = ms; }
    else worstGap = Math.max(worstGap, ms - lastSentAt);
  }
  assert.ok(
    worstGap <= PING_MAX_SILENCE_MS,
    `a stationary team went ${worstGap}ms without reporting; floor is ${PING_MAX_SILENCE_MS}ms`,
  );
});

t('the floor is no longer than the server\'s own minimum write interval', () => {
  // If the client were allowed to stay silent LONGER than the server suppresses writes,
  // the change would be widening the safety window to save reads. It must not.
  assert.ok(PING_MAX_SILENCE_MS <= 60_000, `floor ${PING_MAX_SILENCE_MS}ms exceeds 60s`);
});

// ── Totality: every uncertain input resolves to SEND, and nothing throws ────
for (const [label, fix] of [
  ['non-finite latitude', { lat: Number.NaN, lng: 35.1, accuracyMeters: 8 }],
  ['infinite longitude', { lat: 31.8, lng: Number.POSITIVE_INFINITY, accuracyMeters: 8 }],
  ['missing coordinates', {} as { lat: number; lng: number }],
] as const) {
  t(`${label} sends rather than dropping`, () => {
    const v = shouldSendPing({
      fix: fix as { lat: number; lng: number; accuracyMeters?: number },
      lastSent: { ...BASE, atMs: 1_000 },
      nowMs: 2_000,
    });
    assert.equal(v.send, true, `${label} must fail open`);
  });
}

t('an unusable clock sends rather than dropping', () => {
  const v = shouldSendPing({
    fix: { ...BASE, accuracyMeters: 8 },
    lastSent: { ...BASE, atMs: 1_000 },
    nowMs: Number.NaN,
  });
  assert.equal(v.send, true);
});

t('a garbage lastSent sends rather than dropping', () => {
  const v = shouldSendPing({
    fix: { ...BASE, accuracyMeters: 8 },
    lastSent: { lat: Number.NaN, lng: Number.NaN, atMs: Number.NaN },
    nowMs: 10_000,
  });
  assert.equal(v.send, true);
});

t('the gate never throws on hostile input', () => {
  const hostile = [undefined, null, {}, { fix: null }, { fix: {}, lastSent: 'x', nowMs: 'y' }];
  for (const h of hostile) {
    const v = shouldSendPing(h as never);
    assert.equal(typeof v?.send, 'boolean', `no verdict for ${JSON.stringify(h)}`);
  }
});

// ── The saving is real, and measured here rather than asserted in prose ─────
t('a walking team sends far fewer pings than it takes fixes', () => {
  // A real participant: 20s cadence, ~1.4 m/s, 75 minutes.
  let lastSent: { lat: number; lng: number; atMs: number } | null = null;
  let sends = 0;
  let fixes = 0;
  let metres = 0;
  for (let ms = 0; ms <= 75 * 60_000; ms += 20_000) {
    metres += 1.4 * 20;
    fixes++;
    const fix = { ...north(metres), accuracyMeters: 10 };
    const v = shouldSendPing({ fix, lastSent, nowMs: ms });
    if (v.send) { sends++; lastSent = { ...fix, atMs: ms }; }
  }
  console.log(`      walking team: ${sends} sends of ${fixes} fixes (${((1 - sends / fixes) * 100).toFixed(0)}% saved)`);
  assert.ok(sends < fixes * 0.6, `expected a material cut, sent ${sends}/${fixes}`);
  // And it must still report regularly — a walking team that reports twice an hour
  // would be a broken live map, not a saving.
  assert.ok(sends >= 60, `a walking team must still report often, got ${sends}`);
});

console.log(`\n${passed} assertions passed`);
if (process.exitCode) { console.error('FAILED'); process.exit(1); }

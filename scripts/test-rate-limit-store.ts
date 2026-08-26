// Pure-logic tests for the in-process rate-limit store (change: vps-firestore-read-offload).
//
// WHY THIS EXISTS: `enforceRateLimit` used to run a Firestore TRANSACTION — one read
// and one write — on EVERY rate-limited callable invocation. On the 2026-08-26 exam
// run that was ~1,516 reads and ~1,516 writes in nine minutes from `getMyTeamState`
// alone, against a 50,000-read / 20,000-write daily quota. The run died mid-play with
// `8 RESOURCE_EXHAUSTED: Quota exceeded` and nobody finished.
//
// The durability bought nothing: the API is a SINGLE Node process (functions/server.js,
// no cluster), so no second reader ever consulted those documents. The only behavior it
// preserved was budget survival across a restart — deliberately traded away here.
//
// THE RISK THE FIX CARRIES is a limiter that has been disabled rather than moved. A
// limiter that never refuses is worse than no limiter, because the gate still LOOKS
// present. So every "admits" case below is paired with a "still refuses" case, and the
// reclamation section asserts that reclaiming an ELAPSED window never resurrects a LIVE
// one — the exact way a naive sweep silently turns the cap off.
//
// The decision itself is NOT re-implemented here: `rateLimit()` in @rushpoint/shared is
// already pure and already tested. This file tests the STORE — key isolation, the
// Firestore-free path, memory reclamation, and the thrown error's shape.
//
// No emulator.  npx tsx scripts/test-rate-limit-store.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRateLimiter } from '../functions/src/rateLimitStore';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

/** Run `enforce` and report whether it refused, plus the error it threw. */
function attempt(
  limiter: ReturnType<typeof createRateLimiter>,
  uid: string,
  bucket: string,
  nowMs: number,
): { refused: boolean; err?: unknown } {
  try {
    limiter.enforce(uid, bucket, BUDGET, nowMs);
    return { refused: false };
  } catch (err) {
    return { refused: true, err };
  }
}

const BUDGET = { max: 3, windowMs: 60_000 };
const T0 = 1_700_000_000_000;

// ── admission inside budget ───────────────────────────────────────────────────
console.log('\n── admission inside budget ──');
{
  const l = createRateLimiter();
  const results = [0, 1, 2].map((i) =>
    attempt(l, 'uid-a', 'testBucket', T0 + i * 100),
  );
  check('first call admitted', results[0].refused === false);
  check('calls up to max are admitted', results.every((r) => r.refused === false));
}

// ── the cap actually refuses (anti-blinding) ──────────────────────────────────
console.log('\n── the cap refuses ──');
{
  const l = createRateLimiter();
  for (let i = 0; i < BUDGET.max; i++) l.enforce('uid-a', 'testBucket', BUDGET, T0);
  const over = attempt(l, 'uid-a', 'testBucket', T0 + 1);
  check('call number max+1 is refused', over.refused === true);

  const e = over.err as { code?: string; message?: string } | undefined;
  check('refusal carries the resource-exhausted code',
    typeof e?.code === 'string' && e.code.includes('resource-exhausted'),
    String(e?.code));
  check('refusal message is still bilingual (English half)',
    typeof e?.message === 'string' && /Too many requests/.test(e.message),
    e?.message);
  check('refusal message is still bilingual (Hebrew half)',
    typeof e?.message === 'string' && /יותר מדי בקשות/.test(e.message),
    e?.message);
}

// ── the window resets on its own boundary ─────────────────────────────────────
console.log('\n── window boundary ──');
{
  const l = createRateLimiter();
  for (let i = 0; i < BUDGET.max; i++) l.enforce('uid-a', 'testBucket', BUDGET, T0);
  check('still refused just BEFORE the boundary',
    attempt(l, 'uid-a', 'testBucket', T0 + BUDGET.windowMs - 1).refused === true);
  check('admitted once the window has elapsed',
    attempt(l, 'uid-a', 'testBucket', T0 + BUDGET.windowMs).refused === false);
}

// ── keys do not interfere ─────────────────────────────────────────────────────
console.log('\n── key isolation ──');
{
  const l = createRateLimiter();
  for (let i = 0; i < BUDGET.max; i++) l.enforce('uid-a', 'bucketA', BUDGET, T0);
  check('same uid, different bucket is unaffected',
    attempt(l, 'uid-a', 'bucketB', T0).refused === false);
  check('different uid, same bucket is unaffected',
    attempt(l, 'uid-b', 'bucketA', T0).refused === false);
  check('the exhausted key is STILL exhausted (isolation did not clear it)',
    attempt(l, 'uid-a', 'bucketA', T0).refused === true);
}

// ── unknown bucket fails open, and says so ────────────────────────────────────
console.log('\n── unknown bucket ──');
{
  const warnings: string[] = [];
  const l = createRateLimiter({ onMissingBudget: (b) => warnings.push(b) });
  let refused = false;
  // Deliberately NO explicit budget — this is the "bucket absent from RATE_LIMITS
  // and no override" path, which must fail open rather than throw.
  try { l.enforce('uid-a', 'noSuchBucketName', undefined, T0); } catch { refused = true; }
  check('a bucket with no configured budget is admitted', refused === false);
  check('the missing budget is reported, naming the bucket',
    warnings.includes('noSuchBucketName'), JSON.stringify(warnings));
}

// ── reclamation is bounded AND must not blind the limiter ─────────────────────
console.log('\n── reclamation ──');
{
  const l = createRateLimiter();
  for (let i = 0; i < BUDGET.max; i++) l.enforce('stale-uid', 'testBucket', BUDGET, T0);
  l.reclaim(T0 + BUDGET.windowMs + 1);
  check('an elapsed key is discarded', l.size() === 0, `size=${l.size()}`);
  check('and then behaves exactly as a first-ever call',
    attempt(l, 'stale-uid', 'testBucket', T0 + BUDGET.windowMs + 2).refused === false);
}
{
  const l = createRateLimiter();
  for (let i = 0; i < BUDGET.max; i++) l.enforce('live-uid', 'testBucket', BUDGET, T0);
  l.reclaim(T0 + 1_000); // still well inside the window
  check('a LIVE exhausted key survives reclamation', l.size() === 1, `size=${l.size()}`);
  check('and is still refused (reclamation did not turn the cap off)',
    attempt(l, 'live-uid', 'testBucket', T0 + 1_001).refused === true);
}

// ── memory is HARD bounded, not just swept ────────────────────────────────────
// Reclamation only removes ELAPSED windows, so on its own it frees nothing when every key
// is live. play-web signs in anonymously, so a script can mint uids as fast as it likes and
// each is a fresh live key — an unbounded map would be an OOM that takes the API down.
console.log('\n── hard memory bound ──');
{
  const l = createRateLimiter();
  const MANY = 60_000; // above the 50k cap, all inside one window
  for (let i = 0; i < MANY; i++) l.enforce(`uid-${i}`, 'testBucket', BUDGET, T0);
  check('the map never exceeds its cap even with every window live',
    l.size() <= 50_000, `size=${l.size()}`);
  check('and the limiter still works afterwards',
    attempt(l, 'fresh-uid', 'testBucket', T0).refused === false);
}

// ── no Firestore on the enforcement path ──────────────────────────────────────
// The whole point of the change. Asserted structurally rather than by stubbing a
// method, because "the module never reaches for Firestore at all" is the property
// that matters — a stub only proves the paths the test happened to walk.
console.log('\n── no Firestore round-trip ──');
{
  const src = readFileSync(join(process.cwd(), 'functions/src/rateLimitStore.ts'), 'utf8');
  check('the store does not import the Firestore handle',
    !/from '\.\/firebase'/.test(src));
  check('the store performs no Firestore transaction',
    !/runTransaction/.test(src));
  check('the store references no rate-limit document path',
    !/FIRESTORE_PATHS\.rateLimit/.test(src));
  check('the store still uses the shared pure decision function',
    /from '@rushpoint\/shared'/.test(src) && /rateLimit\(/.test(src));
}

console.log(`\n${failures === 0 ? 'ALL RATE-LIMIT-STORE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

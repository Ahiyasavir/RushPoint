// Every transaction that many participants can enter at once must survive contention.
// (change: contended-transaction-retry)
//
// This guard was written from a MEASURED production failure: a 120-team run against
// api.rush-point.com lost joins to `10 ABORTED: cross-transaction contention`, surfaced to the
// player as an opaque INTERNAL. See scripts/lib/transactionRetry.mjs for the full record.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTENDED_TRANSACTIONS,
  MUST_NOT_TRANSACT,
  findUnwrappedTransactions,
  transactionIsWrapped,
  extractCallableBody,
} from './lib/transactionRetry.mjs';

let passed = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); passed++; console.log(`  ok  ${label}`); }
  catch (e) { console.error(`  FAIL  ${label}\n        ${(e as Error).message}`); process.exitCode = 1; }
};

console.log('\n── contended transactions are retry-wrapped ──');

// ── The pure predicate ──────────────────────────────────────────────────────
t('an unwrapped transaction is detected', () => {
  assert.equal(transactionIsWrapped('const x = await db.runTransaction(async (t) => {})'), false);
});

t('a wrapped transaction is accepted', () => {
  assert.equal(
    transactionIsWrapped('return withLockRetry(() => db.runTransaction(async (t) => {}))'),
    true,
  );
});

t('a body with no transaction at all is not a problem', () => {
  assert.equal(transactionIsWrapped('const x = await db.doc(p).get();'), true);
});

t('a withLockRetry AFTER the transaction does not count', () => {
  // Source order matters: wrapping something later in the function does not protect this call.
  assert.equal(
    transactionIsWrapped('await db.runTransaction(async () => {}); await withLockRetry(() => x());'),
    false,
  );
});

t('a non-string body is treated as unwrapped rather than passing', () => {
  assert.equal(transactionIsWrapped(undefined as never), false);
  assert.equal(transactionIsWrapped(null as never), false);
});

// ── Extraction ──────────────────────────────────────────────────────────────
t('a callable body is extracted and stops at the next export', () => {
  const src = [
    'export const alpha = loggedCallable(\'alpha\', async () => {',
    '  await db.runTransaction(async () => {});',
    '});',
    'export const beta = loggedCallable(\'beta\', async () => {',
    '  return withLockRetry(() => db.runTransaction(async () => {}));',
    '});',
  ].join('\n');
  assert.equal(transactionIsWrapped(extractCallableBody(src, 'alpha') as string), false);
  assert.equal(transactionIsWrapped(extractCallableBody(src, 'beta') as string), true);
});

t('a missing callable extracts to null rather than to an empty pass', () => {
  assert.equal(extractCallableBody('export const a = 1;', 'nope'), null);
});

// ── The real source tree ────────────────────────────────────────────────────
t('every declared contended transaction is wrapped in withLockRetry', () => {
  const problems = findUnwrappedTransactions((f: string) => readFileSync(f, 'utf8'));
  assert.equal(
    problems.length, 0,
    `\n${problems.map((p) => `        ✗ ${p.fn} (${p.file}): ${p.problem}`).join('\n')}\n`,
  );
});

t('a callable declared MUST_NOT_TRANSACT is caught when it opens one', () => {
  // Negative control: a guard that cannot fail is indistinguishable from one that works.
  const regressed = [
    'export const joinRun = loggedCallable("joinRun", async () => {',
    '  await db.runTransaction(async (t) => { t.update(runRef, { n: 1 }); });',
    '});',
  ].join(String.fromCharCode(10));
  const problems = findUnwrappedTransactions((f: string) =>
    f === 'functions/src/runs/index.ts' ? regressed : readFileSync(f, 'utf8'));
  assert.ok(problems.some((p) => p.fn === 'joinRun' && /must NOT/.test(p.problem)),
    `re-introducing joinRun's transaction was not caught (got: ${problems.map((p) => p.fn).join(',')})`);
});

t('the declared lists are not empty and name a reason for each site', () => {
  assert.ok(CONTENDED_TRANSACTIONS.length > 0, 'nothing declared — the guard would check nothing');
  assert.ok(MUST_NOT_TRANSACT.length > 0, 'nothing declared — the guard would check nothing');
  for (const s of [...CONTENDED_TRANSACTIONS, ...MUST_NOT_TRANSACT]) {
    assert.ok(s.fn && s.file, `incomplete declaration: ${JSON.stringify(s)}`);
    assert.ok(
      typeof s.why === 'string' && s.why.length > 20,
      `${s.fn} declares no reason it contends — a list without reasons rots into a list nobody trusts`,
    );
  }
});

console.log(`\n${passed} assertions passed (${CONTENDED_TRANSACTIONS.length} contended sites declared)`);
if (process.exitCode) { console.error('FAILED'); process.exit(1); }

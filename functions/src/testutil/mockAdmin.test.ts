// Self-test for the mock harness — a broken mock must not silently make callable
// tests pass (change: callable-test-coverage).
import { describe, expect, test } from 'vitest';
import { ctx, makeDb } from './mockAdmin';

describe('makeDb', () => {
  test('set then get round-trips a document', async () => {
    const db = makeDb();
    await db.doc('wallets/u1').set({ eventCredits: 3 });
    const snap = await db.doc('wallets/u1').get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toEqual({ eventCredits: 3 });
  });

  test('missing doc → exists:false, data():undefined', async () => {
    const snap = await makeDb().doc('nope/x').get();
    expect(snap.exists).toBe(false);
    expect(snap.data()).toBeUndefined();
  });

  test('set with merge preserves other fields; without merge replaces', async () => {
    const db = makeDb({ 'wallets/u1': { eventCredits: 3, plan: 'free' } });
    await db.doc('wallets/u1').set({ eventCredits: 2 }, { merge: true });
    expect((await db.doc('wallets/u1').get()).data()).toEqual({ eventCredits: 2, plan: 'free' });
    await db.doc('wallets/u1').set({ eventCredits: 9 });
    expect((await db.doc('wallets/u1').get()).data()).toEqual({ eventCredits: 9 });
  });

  test('update on a missing doc throws (surfaces a bad assumption)', async () => {
    await expect(makeDb().doc('x/y').update({ a: 1 })).rejects.toThrow();
  });

  test('transaction read-modify-write is visible after commit', async () => {
    const db = makeDb({ 'rateLimits/b__u1': { count: 0, windowStartMs: 0 } });
    await db.runTransaction(async (tx) => {
      const ref = db.doc('rateLimits/b__u1');
      const cur = (await tx.get(ref)).data() as { count: number };
      tx.set(ref, { count: cur.count + 1, windowStartMs: 0 });
    });
    expect((await db.doc('rateLimits/b__u1').get()).data()).toMatchObject({ count: 1 });
  });

  test('delete removes the document', async () => {
    const db = makeDb({ 'a/b': { x: 1 } });
    await db.doc('a/b').delete();
    expect((await db.doc('a/b').get()).exists).toBe(false);
  });
});

describe('ctx', () => {
  test('builds an auth context with a uid, or empty', () => {
    expect(ctx('u1')).toEqual({ auth: { uid: 'u1' } });
    expect(ctx()).toEqual({});
  });
});

import { describe, it, expect } from 'vitest';
import * as functions from 'firebase-functions';
import { withLockRetry } from './assignNextTask';

// A Firestore "contention" abort as it surfaces from the Admin SDK: numeric
// gRPC status code 10 (ABORTED) with a lock-timeout message.
function abortedError(): Error & { code: number } {
  const e = new Error('10 ABORTED: Transaction lock timeout') as Error & { code: number };
  e.code = 10;
  return e;
}

describe('withLockRetry — contention mapping', () => {
  it('rethrows a non-contention error unchanged (identity, not wrapped)', async () => {
    const boom = new Error('boom'); // no contention code/message
    await expect(withLockRetry(() => Promise.reject(boom), 3)).rejects.toBe(boom);

    const notFound = Object.assign(new Error('missing'), { code: 5 });
    await expect(withLockRetry(() => Promise.reject(notFound), 3)).rejects.toBe(notFound);
  });

  it('maps an exhausted contention burst to a retriable unavailable HttpsError', async () => {
    let calls = 0;
    const op = () => {
      calls++;
      return Promise.reject(abortedError());
    };
    let caught: unknown;
    try {
      await withLockRetry(op, 3);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(functions.https.HttpsError);
    expect((caught as functions.https.HttpsError).code).toBe('unavailable');
    // Budget respected: op invoked exactly `attempts` times, no more.
    expect(calls).toBe(3);
  });

  it('succeeds without wrapping when a retry eventually lands', async () => {
    let calls = 0;
    const op = () => {
      calls++;
      if (calls <= 2) return Promise.reject(abortedError());
      return Promise.resolve('ok');
    };
    await expect(withLockRetry(op, 5)).resolves.toBe('ok');
    expect(calls).toBe(3);
  });
});

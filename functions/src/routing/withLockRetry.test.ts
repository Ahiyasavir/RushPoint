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

// A transient gRPC failure (DEADLINE_EXCEEDED / INTERNAL / UNAVAILABLE) as the
// Admin SDK surfaces it under deep run-doc lock contention: a numeric status code
// with the canonical message. These read to players as an opaque INTERNAL unless
// retried — the same contention class as a code-10 ABORTED.
function transientError(code: number, msg: string): Error & { code: number } {
  const e = new Error(msg) as Error & { code: number };
  e.code = code;
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

  // The single run-doc lock also surfaces contention as transient gRPC codes 4
  // (DEADLINE_EXCEEDED), 13 (INTERNAL) and 14 (UNAVAILABLE) — the crash class that
  // simulate-run.mjs caught at 12/16 teams. These must retry, not escape raw.
  it.each([
    { code: 4, msg: '4 DEADLINE_EXCEEDED: Deadline exceeded' },
    { code: 13, msg: '13 INTERNAL: An internal error occurred' },
    { code: 14, msg: '14 UNAVAILABLE: The service is currently unavailable' },
  ])('retries then succeeds on a transient gRPC code ($code)', async ({ code, msg }) => {
    let calls = 0;
    const op = () => {
      calls++;
      if (calls <= 2) return Promise.reject(transientError(code, msg));
      return Promise.resolve('ok');
    };
    await expect(withLockRetry(op, 5)).resolves.toBe('ok');
    expect(calls).toBe(3);
  });

  it('maps an exhausted transient burst (code 13 INTERNAL) to a retriable unavailable HttpsError', async () => {
    let calls = 0;
    const attempts = 4;
    const op = () => {
      calls++;
      return Promise.reject(transientError(13, '13 INTERNAL: internal error'));
    };
    let caught: unknown;
    try {
      await withLockRetry(op, attempts);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(functions.https.HttpsError);
    expect((caught as functions.https.HttpsError).code).toBe('unavailable');
    expect(calls).toBe(attempts);
  });

  it('retries on a message-only transient (no numeric code)', async () => {
    let calls = 0;
    const op = () => {
      calls++;
      // No `.code` — proves the /deadline|unavailable|internal/i message arm.
      if (calls <= 2) return Promise.reject(new Error('internal error, please retry'));
      return Promise.resolve('ok');
    };
    await expect(withLockRetry(op, 5)).resolves.toBe('ok');
    expect(calls).toBe(3);
  });
});

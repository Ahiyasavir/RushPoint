import { afterEach, describe, expect, test } from 'vitest';
import {
  __resetObsLogger,
  __setObsLogger,
  DEFAULT_MAX_INSTANCES,
  logBestEffort,
  logCall,
  redact,
  resolveRuntimeOpts,
  type ObsLogger,
} from './log';

function fakeLogger() {
  const records: Array<{ level: 'info' | 'warn' | 'error'; message: string; data?: Record<string, unknown> }> = [];
  const make = (level: 'info' | 'warn' | 'error') =>
    (message: string, data?: Record<string, unknown>) => { records.push({ level, message, data }); };
  const logger: ObsLogger = { info: make('info'), warn: make('warn'), error: make('error') };
  return { logger, records };
}

afterEach(() => __resetObsLogger());

describe('logCall — one structured record per invocation', () => {
  test('success logs exactly one info callable.ok with ids and no secret fields', async () => {
    const { logger, records } = fakeLogger();
    __setObsLogger(logger);
    const out = await logCall({ callable: 'launchRun', uid: 'u1', runId: 'r1' }, async () => 42);
    expect(out).toBe(42);
    expect(records).toHaveLength(1);
    expect(records[0].level).toBe('info');
    expect(records[0].message).toBe('callable.ok');
    expect(records[0].data).toMatchObject({ callable: 'launchRun', uid: 'u1', runId: 'r1' });
    // No free-form/secret fields ever sneak into the success record.
    expect(records[0].data).not.toHaveProperty('displayName');
    expect(records[0].data).not.toHaveProperty('answer');
  });

  test('a thrown HttpsError (has .code) logs one warn with errorCode and re-throws', async () => {
    const { logger, records } = fakeLogger();
    __setObsLogger(logger);
    const err = Object.assign(new Error('nope'), { code: 'permission-denied' });
    await expect(logCall({ callable: 'joinRun', uid: 'u2' }, async () => { throw err; })).rejects.toBe(err);
    expect(records).toHaveLength(1);
    expect(records[0].level).toBe('warn');
    expect(records[0].message).toBe('callable.error');
    expect(records[0].data).toMatchObject({ callable: 'joinRun', errorCode: 'permission-denied' });
  });

  // The CODE alone is not diagnosable. `invalid-argument` is thrown from a dozen
  // guards in updateGame, and the message is the only thing that says WHICH one —
  // it names the offending stage/task. Without it, a creator whose autosave is
  // being refused produces a log line that proves only "something was invalid",
  // which is exactly the wall this hit in production on 2026-08-20.
  test('the rejection MESSAGE is logged, not just the code', async () => {
    const { logger, records } = fakeLogger();
    __setObsLogger(logger);
    const err = Object.assign(
      new Error('Stage "משימות תחרות": requiredTaskCount 4 exceeds the 3 completions this stage can yield'),
      { code: 'invalid-argument' },
    );
    await expect(logCall({ callable: 'updateGame', uid: 'u3' }, async () => { throw err; })).rejects.toBe(err);
    expect(records[0].data).toMatchObject({
      callable: 'updateGame',
      errorCode: 'invalid-argument',
      errorMessage: err.message,
    });
  });

  test('a missing message never becomes the string "undefined"', async () => {
    const { logger, records } = fakeLogger();
    __setObsLogger(logger);
    const err = Object.assign(new Error(''), { code: 'not-found' });
    await expect(logCall({ callable: 'getGame' }, async () => { throw err; })).rejects.toBe(err);
    expect(records[0].data).not.toHaveProperty('errorMessage');
  });

  test('an unexpected throw (no .code) logs one error callable.crash and re-throws', async () => {
    const { logger, records } = fakeLogger();
    __setObsLogger(logger);
    const err = new Error('boom');
    await expect(logCall({ callable: 'finalizeRun' }, async () => { throw err; })).rejects.toBe(err);
    expect(records).toHaveLength(1);
    expect(records[0].level).toBe('error');
    expect(records[0].message).toBe('callable.crash');
    expect(records[0].data).toMatchObject({ callable: 'finalizeRun' });
  });
});

describe('logBestEffort — visible but never fatal', () => {
  test('logs a warn and never throws', () => {
    const { logger, records } = fakeLogger();
    __setObsLogger(logger);
    expect(() => logBestEffort('playCount.increment', { gameId: 'g1' }, new Error('x'))).not.toThrow();
    expect(records).toHaveLength(1);
    expect(records[0].level).toBe('warn');
    expect(records[0].message).toBe('bestEffort.failed');
    expect(records[0].data).toMatchObject({ op: 'playCount.increment', gameId: 'g1' });
  });

  test('redacts sensitive context keys', () => {
    const { logger, records } = fakeLogger();
    __setObsLogger(logger);
    logBestEffort('op', { gameId: 'g1', displayName: 'Alice', answer: '1234', pin: '000000' }, 'e');
    const data = records[0].data!;
    expect(data).toHaveProperty('gameId', 'g1');
    expect(data).not.toHaveProperty('displayName');
    expect(data).not.toHaveProperty('answer');
    expect(data).not.toHaveProperty('pin');
  });
});

describe('redact', () => {
  test('drops known-sensitive keys, keeps ids', () => {
    expect(redact({ runId: 'r1', secretCode: 'ABCD', photoUrl: 'gs://x', uid: 'u1' }))
      .toEqual({ runId: 'r1', uid: 'u1' });
  });
  test('undefined context → empty object', () => {
    expect(redact(undefined)).toEqual({});
  });
});

// Cost containment: an unbounded callable can scale to Google's project-wide
// ceiling, so one runaway loop or abuse spike becomes a real bill. Every callable
// funnels through loggedCallable, so capping there bounds the worst case for all
// of them by construction — no per-call-site discipline required.
describe('resolveRuntimeOpts — every callable is instance-capped', () => {
  test('a callable that passes no opts still gets the default cap', () => {
    expect(resolveRuntimeOpts(undefined).maxInstances).toBe(DEFAULT_MAX_INSTANCES);
  });

  test('the cap is applied alongside per-callable opts, not instead of them', () => {
    const opts = resolveRuntimeOpts({ timeoutSeconds: 180, memory: '512MB' });
    expect(opts.timeoutSeconds).toBe(180);
    expect(opts.memory).toBe('512MB');
    expect(opts.maxInstances).toBe(DEFAULT_MAX_INSTANCES);
  });

  test('an explicit maxInstances wins — a heavy callable can raise its own ceiling', () => {
    expect(resolveRuntimeOpts({ maxInstances: 3 }).maxInstances).toBe(3);
  });

  test('the default cap is a real bound, not effectively unlimited', () => {
    expect(DEFAULT_MAX_INSTANCES).toBeGreaterThan(0);
    expect(DEFAULT_MAX_INSTANCES).toBeLessThanOrEqual(50);
  });
});

import { describe, expect, it } from 'vitest';
import { CALL_FAILURE_KEYS, describeCallFailure, type CallFailureKey } from '../callFeedback';
import { translations } from '../../i18n';

// ─────────────────────────────────────────────────────────────────────────────
// Creator-console failure classification (change: creator-no-silent-failures).
//
// The creator console had no shared way to say "that did not work", so seven
// handlers said nothing at all — including the Builder's autosave, the ONLY
// write path for game content. Fixing them site by site would have produced
// seven judgement calls about what to show; this classifier makes it one.
//
// The two properties that matter, and that this file exists to hold:
//
//   TOTALITY      — a callable can reject with anything (a FirebaseError, a bare
//                   TypeError from a dropped connection, a thrown string, or
//                   nothing at all). Every one of those must produce a message.
//                   A classifier that throws while classifying a failure is the
//                   original bug wearing a hat.
//   ACTIONABILITY — every key it can return must resolve to real copy in BOTH
//                   dictionaries, and that copy must never be a raw code, a
//                   `functions/` prefix, or the word "Error". The invariant is
//                   asserted against the REAL i18n maps, so a key added later
//                   without copy fails here rather than rendering `undefined`
//                   at a live event.
//
// Message TEXT is deliberately not an input to classification (the house rule
// lib/callErrors.ts already established): it is server-authored, English, and
// unstable. Only `code` is read.
// ─────────────────────────────────────────────────────────────────────────────

const HEBREW = /[֐-׿]/;

/** A rejection shaped like the ones `httpsCallable` produces. */
function rejectedWith(code: string, message = 'server said no'): unknown {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

/**
 * The daily-quota rejection the server substitutes when Firestore refuses on
 * quota. It travels as an ordinary `resource-exhausted` plus a structured
 * `details.reason` marker — a CODE alone can never identify it, because our own
 * rate limiter uses the same code with the opposite meaning.
 */
function rejectedWithDailyQuota(): unknown {
  const e = rejectedWith('resource-exhausted', 'Daily capacity reached.') as Error & {
    details: { reason: string };
  };
  e.details = { reason: 'daily-quota' };
  return e;
}

// `dailyCapacity` is a WARNING that is nonetheless not retryable — the daily
// Firestore budget is gone until it resets, so a Retry button would be a lie and
// would spend whatever headroom freed up (change: daily-quota-user-message).
const NOT_RETRYABLE: CallFailureKey[] = ['notAllowed', 'rejected', 'dailyCapacity'];

describe('describeCallFailure — the code table', () => {
  const CASES: [string, CallFailureKey, 'error' | 'warning', boolean][] = [
    // code                    key            severity     retryable
    ['permission-denied',      'notAllowed',  'error',     false],
    ['unauthenticated',        'notAllowed',  'error',     false],
    ['failed-precondition',    'rejected',    'error',     false],
    ['invalid-argument',       'rejected',    'error',     false],
    ['not-found',              'rejected',    'error',     false],
    ['already-exists',         'rejected',    'error',     false],
    ['out-of-range',           'rejected',    'error',     false],
    ['deadline-exceeded',      'offline',     'warning',   true],
    ['unavailable',            'offline',     'warning',   true],
    ['internal',               'offline',     'warning',   true],
    ['aborted',                'offline',     'warning',   true],
    ['cancelled',              'offline',     'warning',   true],
    ['resource-exhausted',     'rateLimited', 'warning',   true],
  ];

  for (const [code, key, severity, retryable] of CASES) {
    it(`maps ${code} → ${key}`, () => {
      expect(describeCallFailure(rejectedWith(code))).toEqual({ key, severity, retryable });
    });
  }

  it('classifies a prefixed code exactly like the bare one', () => {
    // httpsCallable rejects with `functions/permission-denied`; the same failure
    // reaching us through another path is bare. They are one failure.
    for (const [code] of CASES) {
      expect(describeCallFailure(rejectedWith(`functions/${code}`)))
        .toEqual(describeCallFailure(rejectedWith(code)));
    }
  });

  it('never marks a refusal retryable', () => {
    // The Builder's Retry button hangs off this flag. Offering "try again" on a
    // signed-out session guarantees a second failure and hides the real fix.
    for (const key of CALL_FAILURE_KEYS) {
      // dailyCapacity is the one key a code cannot select — it is carried by the
      // structured marker, so it needs its own sample rejection.
      const rejection = key === 'dailyCapacity'
        ? rejectedWithDailyQuota()
        : rejectedWith(
          key === 'notAllowed' ? 'permission-denied'
            : key === 'rejected' ? 'failed-precondition'
            : key === 'rateLimited' ? 'resource-exhausted'
            : key === 'offline' ? 'unavailable'
            : 'teapot',
        );
      const got = describeCallFailure(rejection);
      expect(got.key).toBe(key);
      expect(got.retryable).toBe(!NOT_RETRYABLE.includes(key));
    }
  });
});

describe('describeCallFailure — the offline hint', () => {
  it('treats a codeless network error as offline when the device says so', () => {
    // A connection that dies before the callable is reached arrives as a bare
    // TypeError. Its message ("Failed to fetch" / "NetworkError when attempting
    // to fetch resource") is browser- and locale-dependent, so the device's own
    // online flag is the signal, not the text.
    expect(describeCallFailure(new TypeError('Failed to fetch'), { online: false }))
      .toEqual({ key: 'offline', severity: 'warning', retryable: true });
  });

  it('does not invent an offline failure while the device is online', () => {
    expect(describeCallFailure(new TypeError('Failed to fetch'), { online: true }).key)
      .toBe('generic');
  });

  it('lets a real code beat the hint in both directions', () => {
    expect(describeCallFailure(rejectedWith('permission-denied'), { online: false }).key).toBe('notAllowed');
    expect(describeCallFailure(rejectedWith('unavailable'), { online: true }).key).toBe('offline');
  });

  it('is unaffected when no hint is supplied', () => {
    expect(describeCallFailure(new TypeError('Failed to fetch')).key).toBe('generic');
  });
});

describe('describeCallFailure — totality on hostile input', () => {
  const HOSTILE: [string, unknown][] = [
    ['an unknown firebase code', rejectedWith('teapot')],
    ['an unknown error shape', { nope: 1 }],
    ['a plain Error', new Error('boom')],
    ['a thrown string', 'boom'],
    ['a thrown number', 42],
    ['a non-string code', { code: 500 }],
    ['an empty object', {}],
    ['null', null],
    ['undefined', undefined],
  ];

  for (const [label, value] of HOSTILE) {
    it(`returns a defined outcome for ${label}`, () => {
      const got = describeCallFailure(value);
      expect(CALL_FAILURE_KEYS).toContain(got.key);
      expect(['error', 'warning']).toContain(got.severity);
      expect(typeof got.retryable).toBe('boolean');
    });
  }

  it('falls back to generic rather than to nothing', () => {
    expect(describeCallFailure(undefined).key).toBe('generic');
    expect(describeCallFailure('boom').key).toBe('generic');
    expect(describeCallFailure({ code: 500 }).key).toBe('generic');
  });
});

describe('describeCallFailure — every outcome has actionable copy', () => {
  // The point of the whole change: a creator must never be shown a bare code or
  // an empty string. Asserted against the REAL dictionaries.
  const DICTS = [['he', translations.he], ['en', translations.en]] as const;

  it('exposes at least the five outcomes the console distinguishes', () => {
    expect(new Set(CALL_FAILURE_KEYS)).toEqual(
      new Set(['offline', 'notAllowed', 'rateLimited', 'dailyCapacity', 'rejected', 'generic']),
    );
  });

  it('resolves every key to non-empty copy in both languages', () => {
    for (const [lang, dict] of DICTS) {
      for (const key of CALL_FAILURE_KEYS) {
        const msg = dict.callFailure[key];
        expect(typeof msg, `${lang}.callFailure.${key}`).toBe('string');
        expect(msg.trim(), `${lang}.callFailure.${key}`).not.toBe('');
      }
    }
  });

  it('writes the Hebrew copy in Hebrew and the English copy in English', () => {
    for (const key of CALL_FAILURE_KEYS) {
      expect(HEBREW.test(translations.he.callFailure[key]), `he.callFailure.${key}`).toBe(true);
      expect(HEBREW.test(translations.en.callFailure[key]), `en.callFailure.${key}`).toBe(false);
    }
  });

  it('never leaks a raw code, a namespace prefix or SDK vocabulary into the copy', () => {
    const BANNED = [/functions\//i, /[a-z]+-(denied|exceeded|found|exists|precondition|argument|exhausted|range)/i,
      /firebase/i, /\berror\b/i, /\bundefined\b/i];
    for (const [lang, dict] of DICTS) {
      for (const key of CALL_FAILURE_KEYS) {
        for (const pattern of BANNED) {
          expect(pattern.test(dict.callFailure[key]), `${lang}.callFailure.${key} matched ${pattern}`)
            .toBe(false);
        }
      }
    }
  });

  it('gives every classifiable rejection a message, end to end', () => {
    // The composition the call sites actually perform. Nothing may land on a
    // missing entry — that is how `undefined` reaches a screen.
    const REJECTIONS: unknown[] = [
      rejectedWith('functions/permission-denied'), rejectedWith('unauthenticated'),
      rejectedWith('failed-precondition'), rejectedWith('deadline-exceeded'),
      rejectedWith('resource-exhausted'), new TypeError('Failed to fetch'),
      new Error('boom'), 'boom', undefined, null, { weird: true },
    ];
    for (const [lang, dict] of DICTS) {
      for (const e of REJECTIONS) {
        const msg = dict.callFailure[describeCallFailure(e, { online: false }).key];
        expect(msg, `${lang} had no copy for ${String(e)}`).toBeTruthy();
      }
    }
  });
});

// Pure-logic test for the daily-quota classifier + its copy
// (change: daily-quota-user-message).
//
// The 2026-08-28 outage showed "טעינת המשחקים נכשלה" for hours while the app was
// entirely healthy — Firestore had spent the Spark plan's 50k daily reads. Two
// things had to become true, and this file holds both:
//
//   1. The SERVER can tell Firestore's quota refusal (gRPC numeric code 8) apart
//      from our own rate limiter's refusal (HttpsError string 'resource-exhausted'),
//      because they need opposite advice: "come back tomorrow" vs "wait a few seconds".
//   2. The CLIENTS act on a structured marker, never on message text, and BOTH
//      dictionaries carry real, language-correct copy for the new key — so a key
//      added without copy goes red here instead of rendering `undefined` at a
//      live event.
//
//   npx tsx scripts/test-quota-exhaustion.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DAILY_QUOTA_REASON,
  isFirestoreQuotaExhausted,
  isDailyQuotaRejection,
} from '../packages/shared/src/quotaExhaustion';
import { describeCallFailure, CALL_FAILURE_KEYS } from '../apps/creator-web/src/lib/callFeedback';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── isFirestoreQuotaExhausted: the server-side discriminator ─────────────────
console.log('\n── isFirestoreQuotaExhausted ──');

// The real shape, copied from the 2026-08-28 production logs.
const firestoreQuotaError = {
  code: 8,
  details: 'Quota exceeded.',
  message: '8 RESOURCE_EXHAUSTED: Quota exceeded.',
};
check('numeric gRPC 8 is Firestore quota', isFirestoreQuotaExhausted(firestoreQuotaError));

// The load-bearing negative: our OWN limiter must NOT be caught by this, or every
// "slow down" turns into a wrong "come back tomorrow".
check(
  "our rate limiter's string code is NOT",
  !isFirestoreQuotaExhausted({ code: 'resource-exhausted', message: 'Too many requests' }),
);
check(
  'namespaced string code is NOT',
  !isFirestoreQuotaExhausted({ code: 'functions/resource-exhausted' }),
);

// Totality: it is called inside a catch, so anything at all can arrive.
const junk: unknown[] = [
  undefined, null, 0, 8, '8', 'resource-exhausted', NaN, [], {}, { code: undefined },
  { code: null }, { code: '8' }, { code: 9 }, { code: 7 }, Symbol('x'), () => 8,
  new Error('boom'), { details: 'Quota exceeded.' },
];
let threw = false;
for (const v of junk) {
  try {
    const out = isFirestoreQuotaExhausted(v);
    if (typeof out !== 'boolean') { threw = true; break; }
  } catch { threw = true; break; }
}
check('total over junk inputs, always a boolean, never throws', !threw);
check('the string "8" is NOT a numeric 8', !isFirestoreQuotaExhausted({ code: '8' }));

// ── isDailyQuotaRejection: the client-side marker read ───────────────────────
console.log('\n── isDailyQuotaRejection ──');

// What the client actually receives once the server substitutes the error.
const wireError = {
  code: 'functions/resource-exhausted',
  message: 'Daily capacity reached.',
  details: { reason: DAILY_QUOTA_REASON },
};
check('marked rejection is recognised', isDailyQuotaRejection(wireError));

// The load-bearing negative again, from the other side: an UNMARKED
// resource-exhausted is our rate limiter and must keep its "slow down" copy.
check(
  'unmarked resource-exhausted is NOT daily quota',
  !isDailyQuotaRejection({ code: 'functions/resource-exhausted', message: 'Too many requests' }),
);
check(
  'a different details.reason is NOT',
  !isDailyQuotaRejection({ code: 'functions/resource-exhausted', details: { reason: 'other' } }),
);
check(
  'string details are NOT (never parse the message)',
  !isDailyQuotaRejection({ code: 'functions/resource-exhausted', details: 'daily-quota' }),
);

threw = false;
for (const v of [...junk, { details: null }, { details: 0 }, { details: [] }]) {
  try {
    const out = isDailyQuotaRejection(v);
    if (typeof out !== 'boolean') { threw = true; break; }
  } catch { threw = true; break; }
}
check('total over junk inputs, always a boolean, never throws', !threw);

// ── describeCallFailure routes the marker to its own key ─────────────────────
console.log('\n── describeCallFailure ──');

const quota = describeCallFailure(wireError);
check('marked rejection classifies as dailyCapacity', quota.key === 'dailyCapacity', quota.key);
// Not retryable TODAY: the Retry button hangs off this flag, and offering "try
// again" against an exhausted daily budget is the one action guaranteed not to
// work — and the one that spends what little budget may have freed up.
check('dailyCapacity is not retryable', quota.retryable === false);
// A warning, not an error: the creator did nothing wrong and cannot fix it.
check('dailyCapacity is a warning, not an error', quota.severity === 'warning');

const limiter = describeCallFailure({ code: 'functions/resource-exhausted' });
check('unmarked resource-exhausted still maps to rateLimited', limiter.key === 'rateLimited', limiter.key);
check('rateLimited is still retryable', limiter.retryable === true);

check('dailyCapacity is a declared key', CALL_FAILURE_KEYS.includes('dailyCapacity' as never));

// ── Copy exists, in BOTH dictionaries, in the right language ─────────────────
// A key with no copy renders `undefined` to a creator, so this is a hard gate.
console.log('\n── copy ──');

const i18nSrc = readFileSync(join(process.cwd(), 'apps/creator-web/src/i18n.ts'), 'utf8');
const blocks = [...i18nSrc.matchAll(/callFailure:\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);
check('both creator-web dictionaries have a callFailure block', blocks.length === 2, String(blocks.length));

const HEBREW = /[֐-׿]/;
for (const key of CALL_FAILURE_KEYS) {
  for (let i = 0; i < blocks.length; i++) {
    const lang = i === 0 ? 'he' : 'en';
    const m = blocks[i].match(new RegExp(`${key}:\\s*'([^']*)'`));
    const copy = m?.[1] ?? '';
    check(`${lang}.${key} has copy`, copy.trim().length > 0);
    // Language correctness, the same predicate the i18n gate enforces: Hebrew copy
    // must actually be Hebrew and English copy must carry no Hebrew at all.
    check(
      `${lang}.${key} is in ${lang}`,
      lang === 'he' ? HEBREW.test(copy) : !HEBREW.test(copy),
      copy.slice(0, 40),
    );
    // Never leak a machine code to a human.
    check(`${lang}.${key} carries no raw code`, !/resource-exhausted|RESOURCE_EXHAUSTED/.test(copy));
  }
}

console.log(failures === 0 ? '\n✅ ALL PASS' : `\n❌ ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

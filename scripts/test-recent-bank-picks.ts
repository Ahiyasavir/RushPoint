// Pure-logic tests — the per-creator recency memory
// (change: smart-game-composer).
//
// This is the composer's second variety layer: remember which missions THIS
// creator was handed recently, and bias the next generation away from them. It
// is deliberately the only stateful piece of the feature, and it is kept
// entirely OUTSIDE the composer — `composeGame` receives a value, never a
// storage handle, which is what keeps "same seed ⇒ same game" true regardless of
// what is on disk (asserted in scripts/test-composer-robustness.ts §11).
//
// Everything here has to fail soft. This memory exists to make three generated
// games feel different; it is a nice-to-have. Storage, on the other hand, throws
// for real reasons: Safari private mode, a disabled-cookies profile, an embedded
// webview, a quota that filled up. If any of those turned into an exception, a
// creator would click "create my game" and get nothing — a total failure of the
// core flow, to protect a nicety. So: every read degrades to an empty memory,
// every write degrades to a no-op, and composition carries on.
//
// The store is injected rather than reaching for a global, so a throwing or
// malformed store is a fixture instead of a monkey-patch.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  RECENT_PICKS_KEY_PREFIX,
  RECENCY_LIMIT,
  recentPicksKey,
  readRecentPicks,
  recordRecentPicks,
  type PicksStore,
} from '../apps/creator-web/src/lib/recentBankPicks';
import { RECENCY_WINDOW } from '../apps/creator-web/src/lib/composeGame';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

/** A working in-memory store. */
function fakeStore(seed: Record<string, string> = {}): PicksStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
  };
}

/** A store that throws on everything, like a locked-down browser profile. */
const throwingStore: PicksStore = {
  getItem: () => { throw new Error('storage is disabled'); },
  setItem: () => { throw new Error('storage is disabled'); },
};

/** A store that reads fine but refuses to write, like a full quota. */
function readOnlyStore(seed: Record<string, string> = {}): PicksStore {
  const data = { ...seed };
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
}

console.log('\n── 1. keys are scoped per creator ──────────────────────────');
{
  ok('the prefix is a namespaced constant', typeof RECENT_PICKS_KEY_PREFIX === 'string' && RECENT_PICKS_KEY_PREFIX.length > 0);
  eq('a uid produces a per-creator key', recentPicksKey('uid-abc'), `${RECENT_PICKS_KEY_PREFIX}:uid-abc`);
  ok('two creators get different keys', recentPicksKey('a') !== recentPicksKey('b'));
  eq('the key is stable across calls', recentPicksKey('uid-abc'), recentPicksKey('uid-abc'));

  // A signed-out or mid-auth creator must not produce the literal string
  // "…:undefined", which would then be SHARED by every signed-out session.
  for (const uid of [undefined, null, '', '   ']) {
    const key = recentPicksKey(uid as string | null | undefined);
    if (/undefined|null/.test(key)) {
      failures++;
      console.error(`  ✗ uid ${JSON.stringify(uid)} produced a leaky key: ${key}`);
    }
  }
  ok('a signed-out uid yields a stable anonymous key, never "undefined"', true);
  eq('every signed-out form yields the SAME anonymous key',
    [recentPicksKey(undefined), recentPicksKey(null), recentPicksKey(''), recentPicksKey('  ')],
    Array.from({ length: 4 }, () => recentPicksKey(undefined)));

  eq('whitespace around a uid is trimmed, not stored', recentPicksKey('  uid-abc  '), recentPicksKey('uid-abc'));
}

console.log('\n── 2. two creators never see each other\'s memory ───────────');
{
  const store = fakeStore();
  recordRecentPicks('creator-a', ['alpha', 'beta'], store);
  recordRecentPicks('creator-b', ['gamma'], store);

  eq('creator A reads only their own', readRecentPicks('creator-a', store).recentBankKeys, ['alpha', 'beta']);
  eq('creator B reads only their own', readRecentPicks('creator-b', store).recentBankKeys, ['gamma']);
  eq('a third creator reads nothing', readRecentPicks('creator-c', store).recentBankKeys, []);
  eq('signed-out reads nothing either', readRecentPicks(undefined, store).recentBankKeys, []);
}

console.log('\n── 3. newest first, deduplicated, bounded ──────────────────');
{
  const store = fakeStore();

  recordRecentPicks('u', ['first-a', 'first-b'], store);
  recordRecentPicks('u', ['second-a', 'second-b'], store);

  const after = readRecentPicks('u', store).recentBankKeys;
  eq('the newest generation is at the front', after.slice(0, 2), ['second-a', 'second-b']);
  eq('…followed by the previous one', after.slice(2), ['first-a', 'first-b']);

  // Position IS the penalty, so a re-used mission must MOVE rather than appear
  // twice — a duplicate would leave a stale, weaker copy deciding the score.
  recordRecentPicks('u', ['first-a'], store);
  const moved = readRecentPicks('u', store).recentBankKeys;
  eq('a re-used key moves to the front', moved[0], 'first-a');
  eq('…and appears exactly once', moved.filter((k) => k === 'first-a').length, 1);

  // Bounded, or the memory grows forever and eventually starves the whole bank.
  const big = fakeStore();
  for (let g = 0; g < 30; g++) {
    recordRecentPicks('u', Array.from({ length: 10 }, (_, i) => `g${g}-k${i}`), big);
  }
  const bounded = readRecentPicks('u', big).recentBankKeys;
  eq(`the stored memory is capped at RECENCY_LIMIT (${RECENCY_LIMIT})`, bounded.length, RECENCY_LIMIT);
  eq('…and it is the MOST RECENT that survived', bounded[0], 'g29-k0');
  ok('the oldest generation was dropped', !bounded.includes('g0-k0'));

  eq('the limit matches the window the composer scores against', RECENCY_LIMIT, RECENCY_WINDOW);
}

console.log('\n── 4. a broken store degrades quietly ──────────────────────');
{
  eq('a throwing read yields an empty memory', readRecentPicks('u', throwingStore).recentBankKeys, []);

  let threw = false;
  try { recordRecentPicks('u', ['a', 'b'], throwingStore); } catch { threw = true; }
  ok('a throwing write is a silent no-op, never an exception', !threw);

  let threw2 = false;
  try { recordRecentPicks('u', ['a', 'b'], readOnlyStore()); } catch { threw2 = true; }
  ok('a full quota is a silent no-op too', !threw2);

  eq('an absent store yields an empty memory', readRecentPicks('u', undefined).recentBankKeys, []);

  let threw3 = false;
  try { recordRecentPicks('u', ['a'], undefined); } catch { threw3 = true; }
  ok('writing with no store is a no-op', !threw3);

  // A store that reads but returns junk objects rather than strings.
  const weird: PicksStore = { getItem: () => ({} as unknown as string), setItem: () => {} };
  eq('a store returning a non-string yields an empty memory', readRecentPicks('u', weird).recentBankKeys, []);
}

console.log('\n── 5. malformed stored content yields an empty memory ──────');
{
  const cases = [
    'not json', '{}', '[1,2,3]', 'null', 'true', '"a string"', '42',
    '[]', '{"recentBankKeys":"a,b"}', '[null,null]', '["ok",null,42]',
    '', '   ', '[{"key":"a"}]',
  ];

  for (const raw of cases) {
    const store = fakeStore({ [recentPicksKey('u')]: raw });
    const got = readRecentPicks('u', store).recentBankKeys;
    if (!Array.isArray(got) || got.some((k) => typeof k !== 'string')) {
      failures++;
      console.error(`  ✗ stored ${JSON.stringify(raw)} produced ${JSON.stringify(got)}`);
    }
  }
  ok('every malformed value yields an array of strings, never a partial type', true);

  // A partially-valid array keeps only the strings — a `null` reaching the
  // composer's Map would occupy a recency position that belongs to a real key.
  const mixed = fakeStore({ [recentPicksKey('u')]: '["ok",null,42,"fine"]' });
  eq('a partially-valid array keeps only its strings',
    readRecentPicks('u', mixed).recentBankKeys, ['ok', 'fine']);
}

console.log('\n── 6. junk input to the writer ─────────────────────────────');
{
  const store = fakeStore();
  const junk: unknown[] = [undefined, null, 'a,b', 42, {}, [null, undefined, 1, {}], [''], ['  ']];

  for (const keys of junk) {
    let threw = false;
    try { recordRecentPicks('u', keys as string[], store); } catch { threw = true; }
    if (threw) {
      failures++;
      console.error(`  ✗ recordRecentPicks threw on ${JSON.stringify(keys)}`);
    }
    const got = readRecentPicks('u', store).recentBankKeys;
    if (got.some((k) => typeof k !== 'string' || k.trim() === '')) {
      failures++;
      console.error(`  ✗ ${JSON.stringify(keys)} stored a blank or non-string: ${JSON.stringify(got)}`);
    }
  }
  ok('every junk write is survived, and stores nothing blank', true);

  const good = fakeStore();
  recordRecentPicks('u', ['real', '', '  ', 'also-real'] as string[], good);
  eq('blank entries are dropped, real ones kept',
    readRecentPicks('u', good).recentBankKeys, ['real', 'also-real']);

  const empty = fakeStore();
  recordRecentPicks('u', [], empty);
  eq('recording nothing leaves an empty memory', readRecentPicks('u', empty).recentBankKeys, []);
}

console.log('\n── 7. what is written is what is read back ─────────────────');
{
  // Round-tripping is the only property the composer actually depends on.
  const store = fakeStore();
  const keys = Array.from({ length: 12 }, (_, i) => `mission-${i}`);
  recordRecentPicks('round-trip', keys, store);
  eq('the exact keys come back, in order', readRecentPicks('round-trip', store).recentBankKeys, keys);

  const raw = store.data[recentPicksKey('round-trip')];
  ok('the stored form is valid JSON', (() => { try { JSON.parse(raw); return true; } catch { return false; } })());
  ok('only the one key was written', Object.keys(store.data).length === 1);
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/recent-bank-picks: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/recent-bank-picks: all assertions passed\x1b[0m');

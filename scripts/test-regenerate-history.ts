// Which bank missions have already been offered for one mission
// (change: mission-regenerate).
//
// This is the ONLY stateful piece of the regenerate path, and it is kept
// strictly outside `lib/regenerateMission.ts`, which receives the offered keys
// as a VALUE — the same separation `recentBankPicks` has from the composer, and
// what keeps "same seed ⇒ same pick" true no matter what is on disk.
//
// Everything here fails soft. The history exists to make a second press feel
// different; storage throws for real and common reasons (Safari private mode, a
// cookies-disabled profile, an embedded webview, a full quota). If any of those
// became an exception, a creator would press regenerate and get nothing at all —
// a total failure of the feature in defence of a nicety.
//
//   npx tsx scripts/test-regenerate-history.ts
import {
  regenerateHistoryKey,
  readOfferedKeys,
  recordOfferedKey,
  clearOfferedKeys,
  REGENERATE_HISTORY_LIMIT,
  REGENERATE_HISTORY_KEY_PREFIX,
  type PicksStore,
} from '../apps/creator-web/src/lib/regenerateHistory';

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
function eq<T>(label: string, got: T, want: T): void {
  const same = Object.is(got, want);
  ok(label, same, same ? '' : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/** A store whose behaviour each test dictates — no global monkey-patching. */
function memStore(seed: Record<string, string> = {}): PicksStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
  };
}
const throwingGet: PicksStore = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { /* fine */ },
};
const throwingSet: PicksStore = {
  getItem: () => null,
  setItem: () => { throw new Error('quota'); },
};

console.log('\nregenerate history');

// ── the key is scoped to a creator, a game AND a mission ────────────────────
console.log('\n scoping');
{
  const a = regenerateHistoryKey('uid1', 'g1', 't1');
  ok('the key carries the prefix', a.startsWith(REGENERATE_HISTORY_KEY_PREFIX), a);
  ok('a different creator gets a different key', a !== regenerateHistoryKey('uid2', 'g1', 't1'));
  ok('a different game gets a different key', a !== regenerateHistoryKey('uid1', 'g2', 't1'));
  ok('a different mission gets a different key', a !== regenerateHistoryKey('uid1', 'g1', 't2'));
  ok('a signed-out creator still gets a stable key',
    regenerateHistoryKey(null, 'g1', 't1') === regenerateHistoryKey(undefined, 'g1', 't1'));
}
{
  // The point of per-mission scoping: regenerating one mission must not narrow
  // another's pool.
  const store = memStore();
  recordOfferedKey('u', 'g', 't1', 'bank-a', store);
  recordOfferedKey('u', 'g', 't1', 'bank-b', store);
  eq('the regenerated mission remembers', readOfferedKeys('u', 'g', 't1', store).length, 2);
  eq('its sibling starts empty', readOfferedKeys('u', 'g', 't2', store).length, 0);
}

// ── reading ─────────────────────────────────────────────────────────────────
console.log('\n reading');
{
  eq('no store at all ⇒ empty', readOfferedKeys('u', 'g', 't', undefined).length, 0);
  eq('nothing stored ⇒ empty', readOfferedKeys('u', 'g', 't', memStore()).length, 0);
  eq('a throwing getItem ⇒ empty', readOfferedKeys('u', 'g', 't', throwingGet).length, 0);
}
for (const [label, raw] of [
  ['not JSON', '{oops'],
  ['a JSON object', '{"a":1}'],
  ['a JSON number', '7'],
  ['null', 'null'],
  ['an empty string', ''],
  ['an array of non-strings', '[1,2,{"k":"v"}]'],
] as const) {
  const store = memStore({ [regenerateHistoryKey('u', 'g', 't')]: raw });
  eq(`malformed stored history (${label}) ⇒ empty`, readOfferedKeys('u', 'g', 't', store).length, 0);
}
{
  const store = memStore({ [regenerateHistoryKey('u', 'g', 't')]: '["a", 2, "", "  ", "b"]' });
  const got = readOfferedKeys('u', 'g', 't', store);
  ok('the usable keys survive a partly-bad array', got.join(',') === 'a,b', got.join(','));
}

// ── writing ─────────────────────────────────────────────────────────────────
console.log('\n writing');
{
  const store = memStore();
  recordOfferedKey('u', 'g', 't', 'k1', store);
  recordOfferedKey('u', 'g', 't', 'k2', store);
  recordOfferedKey('u', 'g', 't', 'k1', store);
  const got = readOfferedKeys('u', 'g', 't', store);
  eq('a repeated key is not stored twice', got.length, 2);
  ok('both keys are remembered', got.includes('k1') && got.includes('k2'), got.join(','));
}
{
  const store = memStore();
  for (let i = 0; i < REGENERATE_HISTORY_LIMIT + 12; i++) recordOfferedKey('u', 'g', 't', `k${i}`, store);
  const got = readOfferedKeys('u', 'g', 't', store);
  ok('the list is capped', got.length <= REGENERATE_HISTORY_LIMIT, String(got.length));
  ok('the newest key is kept', got.includes(`k${REGENERATE_HISTORY_LIMIT + 11}`), got.slice(0, 3).join(','));
}
{
  let threw = false;
  try { recordOfferedKey('u', 'g', 't', 'k', throwingSet); } catch { threw = true; }
  ok('a throwing setItem is a no-op, not an exception', !threw);
}
{
  let threw = false;
  try { recordOfferedKey('u', 'g', 't', '', memStore()); } catch { threw = true; }
  ok('an empty key is ignored without throwing', !threw);
}
{
  const store = memStore();
  let threw = false;
  try {
    recordOfferedKey(null, null as never, null as never, null as never, store);
    readOfferedKeys(null, null as never, null as never, store);
  } catch { threw = true; }
  ok('null arguments do not throw', !threw);
}

// ── clearing ────────────────────────────────────────────────────────────────
console.log('\n clearing');
{
  const store = memStore();
  recordOfferedKey('u', 'g', 't', 'k1', store);
  clearOfferedKeys('u', 'g', 't', store);
  eq('a cleared mission starts over', readOfferedKeys('u', 'g', 't', store).length, 0);
  let threw = false;
  try { clearOfferedKeys('u', 'g', 't', throwingSet); } catch { threw = true; }
  ok('clearing through a throwing store does not throw', !threw);
}

console.log(failures === 0 ? '\n✅ regenerate history OK\n' : `\n❌ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

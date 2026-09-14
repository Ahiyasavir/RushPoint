// Pure-logic tests — "is there something NEW in the review queue?"
// (change: live-ops-feedback-loop).
//
// In production run ijI9JMITSf8C9heN1Cwp the organizer learned a team was blocked on
// him by happening to look at the screen. The console already cues an SOS
// (RunConsolePage.tsx:210) with exactly the right shape — a ref-baselined set of seen
// ids, so a fresh mount never replays history — and the review queue, which is what
// players actually complained about waiting on, cues nothing.
//
// The baseline is the whole reason this is a function rather than an inline diff. It
// is the part that is easy to get wrong (open a console over twelve pending items and
// fire twelve cues), and it is invisible in a screenshot. It is also why `previous`
// is `Set | null` rather than `Set`: "I have never seen a snapshot" and "I saw an
// empty snapshot" are different facts, and conflating them is the defect.
//
// Failure mode is SILENCE, never a throw: this runs inside a Firestore listener that
// also renders the queue, and a cue is a nicety while the queue is the job.
import { newPendingKeys } from '../packages/shared/src/reviewQueueCue';
import { submissionKey } from '../packages/shared/src/photoQueue';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}
function eqJson(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}
const set = (...ids: string[]): Set<string> => new Set(ids);

console.log('\nlive-ops — newPendingKeys');

// ── 1. The baseline: opening a console over a queue must be silent ────────────
{
  const first = newPendingKeys(null, ['a', 'b', 'c']);
  eq('a first snapshot of three items does not cue', first.shouldCue, false);
  eqJson('a first snapshot reports no new keys', first.keys, []);
  eq('a first snapshot of an EMPTY queue does not cue',
    newPendingKeys(null, []).shouldCue, false);
  // "never seen a snapshot" and "saw an empty snapshot" are different facts.
  const afterEmpty = newPendingKeys(set(), ['a']);
  eq('an item arriving after a seen-empty snapshot DOES cue', afterEmpty.shouldCue, true);
  eqJson('and it names the arrival', afterEmpty.keys, ['a']);
}

// ── 2. Only an arrival cues ──────────────────────────────────────────────────
{
  const arrived = newPendingKeys(set('a', 'b'), ['a', 'b', 'c']);
  eq('a new key cues', arrived.shouldCue, true);
  eqJson('only the new key is reported', arrived.keys, ['c']);

  eq('an unchanged snapshot does not cue',
    newPendingKeys(set('a', 'b'), ['a', 'b']).shouldCue, false);
  eq('a reordered snapshot does not cue',
    newPendingKeys(set('a', 'b'), ['b', 'a']).shouldCue, false);
  eq('a key LEAVING (reviewed) does not cue',
    newPendingKeys(set('a', 'b'), ['a']).shouldCue, false);
  eq('the queue emptying does not cue',
    newPendingKeys(set('a', 'b'), []).shouldCue, false);

  // The case a naive length comparison gets wrong: one reviewed, one submitted, in
  // the same snapshot. Count is unchanged; a team is still waiting.
  const swap = newPendingKeys(set('a', 'b'), ['a', 'c']);
  eq('one leaving while another arrives DOES cue', swap.shouldCue, true);
  eqJson('and only the arrival is named', swap.keys, ['c']);

  const many = newPendingKeys(set('a'), ['a', 'b', 'c', 'd']);
  eq('three arriving at once cues', many.shouldCue, true);
  eqJson('and all three are named', many.keys, ['b', 'c', 'd']);
  ok('a duplicate key in the snapshot is reported once',
    JSON.stringify(newPendingKeys(set(), ['x', 'x', 'x']).keys) === JSON.stringify(['x']));
}

// ── 3. Totality — a cue defect must never break the queue beside it ──────────
{
  const bad: unknown[] = [null, undefined, 42, {}, true, 'ab', { length: 2 }, Symbol('s')];
  for (const b of bad) {
    let threw = false;
    let r: { keys: string[]; shouldCue: boolean } | null = null;
    try { r = newPendingKeys(set('a'), b as Iterable<string>); } catch { threw = true; }
    ok(`a ${String(typeof b)} snapshot (${String(b as string)}) is silent and does not throw`,
      !threw && !!r && r.shouldCue === false && Array.isArray(r.keys) && r.keys.length === 0,
      JSON.stringify(r));
  }
  // A string IS iterable, and iterating it yields characters — which would turn
  // "abc" into three phantom submissions. It must be refused as a container.
  eq('a string snapshot is refused rather than iterated per character',
    newPendingKeys(null, 'abc' as unknown as Iterable<string>).keys.length, 0);

  for (const b of bad) {
    let threw = false;
    try { newPendingKeys(b as Set<string>, ['a']); } catch { threw = true; }
    ok(`a ${String(typeof b)} previous does not throw`, !threw);
  }
  // An iterable yielding non-strings must not produce keys.
  const mixed = newPendingKeys(set(), [1, null, 'ok', undefined, {}] as unknown as Iterable<string>);
  eqJson('non-string entries are dropped, string entries kept', mixed.keys, ['ok']);
  eqJson('an empty string is not a key', newPendingKeys(set(), ['']).keys, []);
}

// ── 4. The invariant, swept ──────────────────────────────────────────────────
{
  let seed = 0x9e3779b1;
  const rnd = (n: number): number => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed % n;
  };
  const alphabet = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  let violations = 0;
  let cued = 0;
  let quiet = 0;
  const SWEEPS = 4000;
  for (let i = 0; i < SWEEPS; i++) {
    const prev = new Set<string>();
    for (const k of alphabet) if (rnd(2) === 0) prev.add(k);
    const cur = alphabet.filter(() => rnd(2) === 0);
    const r = newPendingKeys(prev, cur);
    const curSet = new Set(cur);
    // keys ⊆ current, keys ∩ previous = ∅, and shouldCue iff keys is non-empty.
    if (r.keys.some((k) => !curSet.has(k))) violations++;
    if (r.keys.some((k) => prev.has(k))) violations++;
    if (r.shouldCue !== (r.keys.length > 0)) violations++;
    if (r.shouldCue) cued++; else quiet++;
  }
  ok(`every verdict names only genuinely new keys :: ${SWEEPS} sweeps`,
    violations === 0, `${violations} violation(s)`);
  ok(`the sweep exercised both outcomes :: ${cued} cued, ${quiet} quiet`,
    cued > 100 && quiet > 100);
}

// ── 5. The key this diff is keyed on ────────────────────────────────────────
// Not defined here on purpose: `submissionKey` in shared/photoQueue is already the
// identity both consoles key their per-row in-flight guard on, and a second answer
// to "are these the same submission?" is exactly the drift this change forbids.
// Asserted anyway, because the cue is only correct if the key is stable.
{
  const k = (t: string, x: string): string => submissionKey({ teamId: t, taskId: x });
  ok('the same submission yields the same key', k('team1', 'taskA') === k('team1', 'taskA'));
  ok('different teams on the same task do not collide', k('t1', 'x') !== k('t2', 'x'));
  ok('different tasks for the same team do not collide', k('t', 'x1') !== k('t', 'x2'));
  // A key built from a real snapshot must survive the diff untouched.
  const keys = [k('t1', 'a'), k('t2', 'a'), k('t1', 'b')];
  ok('three distinct submissions yield three distinct keys', new Set(keys).size === 3);
  const v = newPendingKeys(new Set([keys[0]]), keys);
  ok('a diff over real keys names only the new ones',
    JSON.stringify(v.keys) === JSON.stringify([keys[1], keys[2]]), JSON.stringify(v.keys));
}

console.log('');
if (failures > 0) {
  console.error(`✗ review-queue-cue: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ review-queue-cue: all assertions passed');

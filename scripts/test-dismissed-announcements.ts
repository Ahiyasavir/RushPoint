// Pure-logic test for the run-scoped persistence of dismissed announcement ids
// (apps/play-web/src/lib/dismissedAnnouncements.ts). Covers: round-trip
// persist+read, malformed JSON returns empty (no throw), storage-throws returns
// empty (no throw), and run scoping (one run's dismissals don't leak to another).
import assert from 'node:assert';
import { dismissedKey, loadDismissed, saveDismissed } from '../apps/play-web/src/lib/dismissedAnnouncements';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Minimal in-memory localStorage stand-in; `throwing` flips it into a mode that
// simulates private-mode / quota errors on every access.
function installStorage(opts: { throwing?: boolean } = {}) {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { window?: { localStorage: Storage } };
  g.window = {
    localStorage: {
      getItem(k: string) {
        if (opts.throwing) throw new Error('storage disabled');
        return store.has(k) ? store.get(k)! : null;
      },
      setItem(k: string, v: string) {
        if (opts.throwing) throw new Error('quota exceeded');
        store.set(k, v);
      },
      removeItem(k: string) { store.delete(k); },
      clear() { store.clear(); },
      key() { return null; },
      get length() { return store.size; },
    } as unknown as Storage,
  };
  return store;
}

console.log('dismissedAnnouncements:');

test('key is run-scoped', () => {
  assert.strictEqual(dismissedKey('run-1'), 'rp.annDismiss.run-1');
  assert.notStrictEqual(dismissedKey('run-1'), dismissedKey('run-2'));
});

test('round-trip persist + read', () => {
  installStorage();
  saveDismissed('run-1', new Set(['a', 'b']));
  const got = loadDismissed('run-1');
  assert.deepStrictEqual([...got].sort(), ['a', 'b']);
});

test('malformed JSON returns empty (no throw)', () => {
  const store = installStorage();
  store.set(dismissedKey('run-1'), '{not valid json');
  assert.deepStrictEqual([...loadDismissed('run-1')], []);
});

test('non-array JSON returns empty (no throw)', () => {
  const store = installStorage();
  store.set(dismissedKey('run-1'), '{"a":1}');
  assert.deepStrictEqual([...loadDismissed('run-1')], []);
});

test('storage that throws returns empty (no throw)', () => {
  installStorage({ throwing: true });
  assert.deepStrictEqual([...loadDismissed('run-1')], []);
});

test('saveDismissed swallows storage errors (no throw)', () => {
  installStorage({ throwing: true });
  saveDismissed('run-1', new Set(['a'])); // must not throw
});

test('missing key reads as empty', () => {
  installStorage();
  assert.deepStrictEqual([...loadDismissed('never-written')], []);
});

test('run scoping: one run does not leak into another', () => {
  installStorage();
  saveDismissed('run-1', new Set(['a']));
  saveDismissed('run-2', new Set(['b']));
  assert.deepStrictEqual([...loadDismissed('run-1')], ['a']);
  assert.deepStrictEqual([...loadDismissed('run-2')], ['b']);
});

console.log(`\ndismissedAnnouncements: ${passed} passed`);

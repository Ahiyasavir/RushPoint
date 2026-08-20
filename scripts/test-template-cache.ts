// Pure-logic tests — the new-game template menu cache (perf: template-picker-latency).
//
// The picker used to start `listGameTemplates` at the moment it opened and show a
// spinner until it answered. It now renders from a cache and revalidates in the
// background, so what has to be right is: WHEN a cached menu may be shown, when it
// must be refetched, and that a corrupted store can never reach the picker.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  templateCacheVerdict, parseStoredTemplates, fetchTemplates, peekTemplates,
  __resetTemplateCacheForTests, __peekMemoForTests,
  TEMPLATE_FRESH_MS, TEMPLATE_MAX_AGE_MS,
  type CachedTemplates,
} from '../apps/creator-web/src/lib/templateCache';
import type { TemplateGroupEntry } from '../apps/creator-web/src/services/calls';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
}

const NOW = 1_700_000_000_000;
const group: TemplateGroupEntry = {
  groupKey: 'g1',
  templateEmoji: '🧩',
  templateOrder: 1,
  variants: {
    he: { id: 't1', ownerUid: 'admin1', title: 'תבנית', mode: 'team', scoringPreset: 'time_only', stageCount: 2, taskCount: 5 },
  },
};
const entry = (ts: number): CachedTemplates => ({ templates: [group], ts });

console.log('\n── 1. cache verdict ────────────────────────────────────────');
{
  ok('no entry is a miss', templateCacheVerdict(null, NOW) === 'miss');
  ok('just fetched is fresh', templateCacheVerdict(entry(NOW), NOW) === 'fresh');
  ok('inside the fresh window is fresh',
    templateCacheVerdict(entry(NOW - TEMPLATE_FRESH_MS + 1), NOW) === 'fresh');
  ok('past the fresh window is stale (shown, then revalidated)',
    templateCacheVerdict(entry(NOW - TEMPLATE_FRESH_MS - 1), NOW) === 'stale');
  ok('a day old is a miss, not a stale render',
    templateCacheVerdict(entry(NOW - TEMPLATE_MAX_AGE_MS - 1), NOW) === 'miss');
  // A menu older than the cap must not be pickable: the template it names may
  // have been deleted, and picking a dead one fails at createGameFromTemplate.
  ok('exactly at the cap is a miss', templateCacheVerdict(entry(NOW - TEMPLATE_MAX_AGE_MS), NOW) === 'miss');
  // Clock moved backwards / storage hand-edited: a future timestamp is not
  // evidence of freshness.
  ok('a future timestamp is a miss', templateCacheVerdict(entry(NOW + 60_000), NOW) === 'miss');
  ok('a NaN timestamp is a miss', templateCacheVerdict(entry(Number.NaN), NOW) === 'miss');
}

console.log('\n── 2. stored payload parsing is total ──────────────────────');
{
  ok('null input', parseStoredTemplates(null) === null);
  ok('empty string', parseStoredTemplates('') === null);
  ok('not JSON', parseStoredTemplates('{oh no') === null);
  ok('JSON but not an object', parseStoredTemplates('42') === null);
  ok('missing ts', parseStoredTemplates(JSON.stringify({ templates: [group] })) === null);
  ok('ts is not a number', parseStoredTemplates(JSON.stringify({ templates: [], ts: 'now' })) === null);
  ok('templates is not an array', parseStoredTemplates(JSON.stringify({ templates: {}, ts: NOW })) === null);
  ok('an entry missing groupKey is refused wholesale',
    parseStoredTemplates(JSON.stringify({ templates: [{ variants: {} }], ts: NOW })) === null);
  ok('an entry missing variants is refused wholesale',
    parseStoredTemplates(JSON.stringify({ templates: [{ groupKey: 'g' }], ts: NOW })) === null);
  ok('a null entry is refused wholesale',
    parseStoredTemplates(JSON.stringify({ templates: [null], ts: NOW })) === null);
  const good = parseStoredTemplates(JSON.stringify(entry(NOW)));
  ok('a well-formed payload round-trips', good?.ts === NOW && good?.templates[0].groupKey === 'g1', good);
  ok('an empty menu is legitimate (no templates authored yet)',
    parseStoredTemplates(JSON.stringify({ templates: [], ts: NOW }))?.templates.length === 0);
}

console.log('\n── 3. concurrent callers share ONE network call ────────────');
{
  __resetTemplateCacheForTests();
  let calls = 0;
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => { release = r; });
  const fetcher = async () => { calls++; await gate; return { templates: [group] }; };

  // The dashboard's mount prefetch and the picker's own open both ask at once —
  // the picker must not open a second round trip behind the first.
  const a = fetchTemplates(fetcher);
  const b = fetchTemplates(fetcher);
  ok('the two callers get the SAME promise', a === b);
  release!();

  void Promise.all([a, b]).then(([ra, rb]) => {
    ok('exactly one network call was made', calls === 1, calls);
    ok('both callers get the menu', ra.length === 1 && rb.length === 1);
    ok('the result is memoised for the rest of the page',
      __peekMemoForTests()?.templates[0].groupKey === 'g1');
    ok('a fresh memo is served without another call', peekTemplates()?.verdict === 'fresh');

    // A failure must NOT be memoised — the next open has to be able to retry.
    __resetTemplateCacheForTests();
    let failing = 0;
    const bad = async (): Promise<{ templates: TemplateGroupEntry[] }> => {
      failing++; throw new Error('offline');
    };
    void fetchTemplates(bad).catch(() => {
      void fetchTemplates(bad).catch(() => {
        ok('a failed fetch is retried rather than cached', failing === 2, failing);
        ok('nothing was memoised by the failure', __peekMemoForTests() === null);
        finish();
      });
    });
  });
}

function finish(): void {
  console.log(failures === 0 ? '\n✅ template cache: all pass\n' : `\n❌ template cache: ${failures} failure(s)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

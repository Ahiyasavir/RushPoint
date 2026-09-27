// Hot-path reads go through the cache (change: hot-path-read-cost).
//
// Written from a production measurement: the leaderboard auto-refresh read every team document
// on a 20s throttle, ~27,450 reads at 120 teams over a 75-minute run, billed invisibly to
// whichever player callable triggered it. See scripts/lib/hotPathReads.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CACHED_GAME_READS,
  CACHED_COLLECTION_READS,
  CACHED_DOC_READS,
  findUncachedHotReads,
  gameReadIsCached,
  collectionReadIsCached,
  extractBody,
} from './lib/hotPathReads.mjs';

let passed = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); passed++; console.log(`  ok  ${label}`); }
  catch (e) { console.error(`  FAIL  ${label}\n        ${(e as Error).message}`); process.exitCode = 1; }
};

console.log('\n── hot-path reads are cached ──');

t('an uncached game read is detected', () => {
  assert.equal(gameReadIsCached('const s = await db.doc(gamePath(uid, gameId)).get();'), false);
});
t('a cached game read is accepted', () => {
  assert.equal(gameReadIsCached('const s = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(uid, gameId));'), true);
});
t('an uncached collection read is detected', () => {
  assert.equal(collectionReadIsCached('await db.collection(teamsCol(a,b,c)).get()', 'teamsCol'), false);
});
t('a cached collection read is accepted', () => {
  assert.equal(collectionReadIsCached('await cachedGetCollection(db, policy, teamsCol(a,b,c))', 'teamsCol'), true);
});
t('a non-string body is treated as uncached rather than passing', () => {
  assert.equal(gameReadIsCached(undefined as never), false);
  assert.equal(collectionReadIsCached(null as never, 'teamsCol'), false);
});
t('a body is extracted and stops at the next declaration', () => {
  const src = [
    'async function alpha() {',
    '  const g = await db.doc(gamePath(u, g)).get();',
    '}',
    'export const beta = loggedCallable("beta", async () => {',
    '  const g = await cachedGetDoc(db, p, gamePath(u, g));',
    '});',
  ].join('\n');
  assert.equal(gameReadIsCached(extractBody(src, 'alpha') as string), false);
  assert.equal(gameReadIsCached(extractBody(src, 'beta') as string), true);
});
t('a missing function extracts to null rather than to an empty pass', () => {
  assert.equal(extractBody('const a = 1;', 'nope'), null);
});

t('every declared hot-path read is cached in the real source', () => {
  const problems = findUncachedHotReads((f: string) => readFileSync(f, 'utf8'));
  assert.equal(
    problems.length, 0,
    `\n${problems.map((p) => `        ✗ ${p.fn}: ${p.problem}`).join('\n')}\n`,
  );
});

// NEGATIVE CONTROLS. A guard that passes on the code it was written to reject is examining
// nothing, and reads identically to one that is working. Each declared category is shown to
// FAIL against the exact shape this change removed.
t('the guard rejects the pre-change source it was written for', () => {
  const before = [
    'async function maybeRefreshLeaderboardSnapshot() {',
    '  const gameSnap = await db.doc(gamePath(ownerUid, gameId)).get();',
    '  const teamsSnap = await db.collection(teamsCol(ownerUid, gameId, runId)).get();',
    '}',
    'export async function resolveCallerTeam(uid) {',
    '  let snap = await teamRef.get();',
    '}',
  ].join(String.fromCharCode(10));
  const problems = findUncachedHotReads(() => before);
  const named = problems.map((p) => `${p.fn}`).join(',');
  assert.ok(problems.some((p) => p.fn === 'maybeRefreshLeaderboardSnapshot' && /game document/.test(p.problem)),
    `uncached game read not caught (got: ${named})`);
  assert.ok(problems.some((p) => p.fn === 'maybeRefreshLeaderboardSnapshot' && /teamsCol/.test(p.problem)),
    `uncached collection read not caught (got: ${named})`);
  assert.ok(problems.some((p) => p.fn === 'resolveCallerTeam'),
    `uncached team read not caught (got: ${named})`);
});

t('a renamed declared site fails rather than silently passing', () => {
  const problems = findUncachedHotReads(() => 'export const somethingElse = 1;');
  assert.equal(problems.length, CACHED_GAME_READS.length + CACHED_DOC_READS.length + CACHED_COLLECTION_READS.length,
    'every declared site should report "not found" when the file no longer contains it');
});

t('the declared lists are non-empty and each site states why', () => {
  assert.ok(CACHED_GAME_READS.length > 0 && CACHED_COLLECTION_READS.length > 0 && CACHED_DOC_READS.length > 0);
  for (const s of [...CACHED_GAME_READS, ...CACHED_COLLECTION_READS, ...CACHED_DOC_READS]) {
    assert.ok(s.fn && typeof s.why === 'string' && s.why.length > 10,
      `${s.fn} declares no reason — a list without reasons rots into one nobody trusts`);
  }
});

console.log(`\n${passed} assertions passed (${CACHED_GAME_READS.length} game reads, ${CACHED_COLLECTION_READS.length} collection reads declared)`);
if (process.exitCode) { console.error('FAILED'); process.exit(1); }

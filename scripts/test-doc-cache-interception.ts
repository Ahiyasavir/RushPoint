// Structural guard for the document cache's interception layer
// (change: vps-firestore-read-offload).
//
// WHY THIS EXISTS: the cache is only correct if EVERY write reaches its invalidation hook.
// functions/src holds 216 write call sites across 18 modules and 44 transactions, and the
// design deliberately does NOT ask any of them to remember an invalidation call — the single
// exported `db` handle is wrapped instead, so existing and future call sites are covered by
// construction.
//
// That guarantee has exactly two ways to break, and neither one is visible at runtime until a
// live game shows a stale score:
//   1. `functions/src/firebase.ts` stops exporting a WRAPPED handle.
//   2. Some module reaches around it and builds its own `admin.firestore()`.
//
// Both are caught here. This is the same shape as scripts/test-callable-hardening.ts and
// scripts/test-upload-origin-parity.ts: the allowlist is DECLARED, never inferred, and the
// allowlist itself is checked for stale entries — an exemption that no longer applies is a
// silent hole.
//
// No emulator.  npx tsx scripts/test-doc-cache-interception.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const ROOT = process.cwd();
const SRC = join(ROOT, 'functions/src');

/**
 * Modules permitted to construct their own Firestore handle, each with the reason it is
 * safe. A handle outside the wrapper is safe ONLY if it can never write a document the API
 * process also caches.
 */
const OWN_HANDLE_ALLOWLIST: Record<string, string> = {
  'firebase.ts':
    'the wrapper itself — this is the one place the raw handle is created and wrapped',
  'digest-cron.ts':
    'a separate read-only process (its own main(), run by deploy/rushpoint-digest.timer), ' +
    'not the API process; it performs no writes, so there is no cache to invalidate',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC).filter((f) => !f.endsWith('.test.ts') && !f.includes('__planned__'));

// ── 1. the exported handle is wrapped ─────────────────────────────────────────
console.log('\n── the exported db handle is wrapped ──');
{
  const src = readFileSync(join(SRC, 'firebase.ts'), 'utf8');
  check('firebase.ts imports the interception layer', /from '\.\/docCache'/.test(src));
  check('firebase.ts wraps the raw handle before exporting it',
    /export const db\b[^\n]*wrapFirestore|wrapFirestore\([\s\S]*?export const db/.test(src)
      || /const db = wrapFirestore\(/.test(src));
  check('firebase.ts still applies ignoreUndefinedProperties to the RAW handle',
    /ignoreUndefinedProperties/.test(src));
  check('the cache policy is created once, at module scope',
    /createDocCachePolicy\(/.test(src));
}

// ── 2. nobody reaches around the wrapper ──────────────────────────────────────
console.log('\n── no module builds its own Firestore handle ──');
{
  const offenders: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const rel = relative(SRC, file).replace(/\\/g, '/');
    if (!/admin\.firestore\(\)/.test(readFileSync(file, 'utf8'))) continue;
    seen.add(rel);
    if (!(rel in OWN_HANDLE_ALLOWLIST)) offenders.push(rel);
  }
  check('every module uses the shared wrapped handle', offenders.length === 0,
    offenders.join(', '));

  // A stale exemption is a silent hole — it reads as "reviewed and allowed" when the
  // reason may no longer exist.
  const stale = Object.keys(OWN_HANDLE_ALLOWLIST).filter((f) => !seen.has(f));
  check('the allowlist carries no stale entries', stale.length === 0, stale.join(', '));
}

// ── 3. the allowlisted read-only process really is read-only ──────────────────
// Its exemption rests entirely on "it performs no writes". If that stops being true the
// exemption is wrong, and this is the only place that would notice.
console.log('\n── the read-only exemption still holds ──');
{
  const src = readFileSync(join(SRC, 'digest-cron.ts'), 'utf8');
  const writes = /\.(set|update|delete|create)\(|\.batch\(\)|runTransaction\(/.exec(src);
  check('digest-cron.ts still performs no writes', writes === null,
    writes ? `found ${writes[0]}` : '');
}

// ── 4. every write verb is intercepted ────────────────────────────────────────
// Firestore's write surface is small and fixed; a verb missing from the interceptor is a
// document that is written without its cache entry being dropped.
console.log('\n── every write verb is intercepted ──');
{
  const src = readFileSync(join(SRC, 'docCache.ts'), 'utf8');
  for (const verb of ['set', 'create', 'update', 'delete']) {
    check(`\`${verb}\` is in the intercepted verb set`,
      new RegExp(`WRITE_VERBS[\\s\\S]*?'${verb}'`).test(src));
  }
  check('batch commits are intercepted', /prop === 'commit'/.test(src));
  check('transactions are intercepted', /prop === 'runTransaction'/.test(src));
  check('collection().add() is intercepted', /prop === 'add'/.test(src));
}

// ── 4b. every route that can hand out a WRITABLE reference is intercepted ─────
// Intercepting db.doc()/db.collection() alone was NOT enough, and this section exists
// because that gap was real: a reference reached through a SNAPSHOT is a raw
// DocumentReference, and three live call sites write through one —
// admin/templates.ts:321 (a GAME doc), maintenance/index.ts:125 (a TEAM doc) and
// runs/index.ts:2618 (a TEAM doc). All three are cached paths. `recursiveDelete` was a
// fourth route: it never touches doc()/collection() at all.
console.log('\n-- every route to a writable reference is intercepted --');
{
  const src = readFileSync(join(SRC, 'docCache.ts'), 'utf8');
  check('snapshots are wrapped so `.ref` comes back intercepted',
    /function wrapDocSnapshot\(/.test(src) && /prop === 'ref'/.test(src));
  check('query snapshots wrap every row', /function wrapQuerySnapshot\(/.test(src));
  check('the query builder is wrapped (a .where() chain must not escape)',
    /function wrapQuery\(/.test(src) && /QUERY_CHAIN/.test(src));
  for (const m of ['where', 'orderBy', 'limit', 'select', 'startAfter']) {
    check(`\`${m}\` is in the query chain set`,
      new RegExp(`QUERY_CHAIN[\\s\\S]*?'${m}'`).test(src));
  }
  check('collectionGroup is intercepted', /prop === 'collectionGroup'/.test(src));
  check('getAll wraps the snapshots it returns', /prop === 'getAll'/.test(src));
  check('recursiveDelete drops the subtree', /prop === 'recursiveDelete'/.test(src));
}

// ── 4c. no route we CANNOT intercept is in use ────────────────────────────────
// BulkWriter batches writes through its own path and never reaches our proxies. There is
// no way to invalidate behind it, so its absence is the guarantee. If a future change
// needs it, it must invalidate explicitly — this failing test is where that conversation
// starts, rather than a stale row in a live run.
console.log('\n-- no un-interceptable write route is in use --');
{
  const offenders = files.filter((f) => /\.bulkWriter\(/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f).replace(/\\/g, '/'));
  check('nothing uses db.bulkWriter()', offenders.length === 0, offenders.join(', '));
}

// ── 5. transaction reads are never served from cache ──────────────────────────
// Firestore's optimistic concurrency needs tx.get() to register the read. This is asserted
// behaviourally in scripts/test-doc-cache.ts; here we pin the STRUCTURE, so the guarantee
// cannot be quietly removed by "optimising" the transaction wrapper.
console.log('\n── transaction reads bypass the cache ──');
{
  const src = readFileSync(join(SRC, 'docCache.ts'), 'utf8');
  const txWrapper = /function wrapTransaction[\s\S]*?\n}/.exec(src)?.[0] ?? '';
  check('the transaction wrapper exists', txWrapper.length > 0);
  check('and never consults the policy',
    txWrapper.length > 0 && !/policy\./.test(txWrapper));
}

console.log(`\n${failures === 0 ? 'ALL INTERCEPTION TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

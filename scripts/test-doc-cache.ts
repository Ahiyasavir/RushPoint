// Pure-logic tests for the server document cache policy (change: vps-firestore-read-offload).
//
// WHY THIS EXISTS: on 2026-08-26 a live 29-participant run exhausted the daily Firestore
// read quota mid-play. `listRunTeams` alone cost ~60 reads per call and the Run Console
// polls it every 5s — 720 reads/minute from one open browser tab. The API process is the
// SOLE writer of game/run/team documents (firestore.rules: `allow write: if false`) and is
// a SINGLE process, so it can answer those reads from its own memory.
//
// THE RISK THIS CARRIES is the whole reason the file is long: a cache that serves a STALE
// document to a live game is far worse than the quota problem it solves. A player would see
// a score that already changed, or a mission they already finished. So the assertions below
// are weighted toward *proving invalidation happens*, not toward proving hits happen — a
// cache that never hits merely costs money, a cache that hits wrongly corrupts a game.
//
// Two policy decisions are load-bearing and are asserted directly:
//   • INVALIDATE, NEVER MERGE (design D1). `taskCounts` is maintained with
//     FieldValue.increment, and other writes use arrayUnion / serverTimestamp. Computing
//     the post-write document locally would mean reimplementing Firestore's merge
//     semantics — including the array-coercion footgun in CLAUDE.md. Dropping the entry
//     costs one read and can never be wrong.
//   • MEMBERSHIP TURNS ON THE VERB (design D3). `update()` cannot create a document, so it
//     leaves a collection's membership intact — which is what keeps `listRunTeams` warm
//     across the ~300 team-progress writes of a real run. `set`/`create`/`delete` may
//     change membership and must drop it.
//
// A TTL exists as a SAFETY NET, not as the coherence mechanism. Coherence comes from
// invalidation; the TTL bounds how long an entry could survive if some write ever reached
// Firestore without passing through the interceptor.
//
// No emulator.  npx tsx scripts/test-doc-cache.ts
import { createDocCachePolicy } from '../packages/shared/src/docCachePolicy';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const T0 = 1_700_000_000_000;
const TEAM_A = 'users/owner1/games/game1/runs/run1/teams/teamA';
const TEAM_B = 'users/owner1/games/game1/runs/run1/teams/teamB';
const TEAMS_COL = 'users/owner1/games/game1/runs/run1/teams';
const RUN = 'users/owner1/games/game1/runs/run1';

function policy(over: Partial<{ maxEntries: number; ttlMs: number }> = {}) {
  return createDocCachePolicy({ maxEntries: 100, ttlMs: 60_000, enabled: true, ...over });
}

// ── documents: hit, miss, warm ────────────────────────────────────────────────
console.log('\n── document hit / miss ──');
{
  const c = policy();
  check('a cold read misses', c.getDoc(TEAM_A, T0).hit === false);

  c.putDoc(TEAM_A, { exists: true, data: { score: 10 } }, T0);
  const warm = c.getDoc(TEAM_A, T0);
  check('a warm read hits', warm.hit === true);
  check('and returns the stored value',
    warm.hit === true && (warm.entry.data as { score: number }).score === 10);

  check('an unrelated path still misses', c.getDoc(TEAM_B, T0).hit === false);
}

// ── a missing document is cached as MISSING, never as existing ────────────────
console.log('\n── absence ──');
{
  const c = policy();
  c.putDoc(TEAM_A, { exists: false }, T0);
  const r = c.getDoc(TEAM_A, T0);
  check('absence is remembered (so a repeat read costs nothing)', r.hit === true);
  check('but is reported as NOT existing', r.hit === true && r.entry.exists === false);
  check('and carries no data', r.hit === true && r.entry.data === undefined);
}

// ── invalidation: the property that matters ───────────────────────────────────
console.log('\n── invalidation ──');
{
  const c = policy();
  c.putDoc(TEAM_A, { exists: true, data: { score: 10 } }, T0);
  c.invalidateWrite(TEAM_A, 'update');
  check('a write drops the document', c.getDoc(TEAM_A, T0).hit === false);
}
for (const verb of ['set', 'create', 'delete', 'update'] as const) {
  const c = policy();
  c.putDoc(TEAM_A, { exists: true, data: { score: 10 } }, T0);
  c.invalidateWrite(TEAM_A, verb);
  check(`\`${verb}\` drops the document`, c.getDoc(TEAM_A, T0).hit === false);
}

// ── membership turns on the verb (design D3) ──────────────────────────────────
console.log('\n── collection membership ──');
{
  const c = policy();
  c.putMembers(TEAMS_COL, ['teamA', 'teamB'], T0);
  check('membership is held', c.getMembers(TEAMS_COL, T0).hit === true);

  c.invalidateWrite(TEAM_A, 'update');
  const afterUpdate = c.getMembers(TEAMS_COL, T0);
  check('an `update` to a member KEEPS membership (it cannot create a doc)',
    afterUpdate.hit === true);
  check('and membership is unchanged',
    afterUpdate.hit === true && afterUpdate.ids.join(',') === 'teamA,teamB');
  check('while the member document itself was dropped',
    c.getDoc(TEAM_A, T0).hit === false);
}
for (const verb of ['set', 'create', 'delete'] as const) {
  const c = policy();
  c.putMembers(TEAMS_COL, ['teamA'], T0);
  c.invalidateWrite(TEAM_B, verb);
  check(`\`${verb}\` on a child DROPS membership (it may add or remove a member)`,
    c.getMembers(TEAMS_COL, T0).hit === false);
}
{
  const c = policy();
  c.putMembers(TEAMS_COL, ['teamA'], T0);
  c.invalidateWrite('users/owner1/games/game1/runs/run1/alerts/alert1', 'set');
  check('a write to a DIFFERENT collection leaves this membership alone',
    c.getMembers(TEAMS_COL, T0).hit === true);
}

// ── TTL is a safety net, and it is real ───────────────────────────────────────
console.log('\n── ttl safety net ──');
{
  const c = policy({ ttlMs: 30_000 });
  c.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
  c.putMembers(TEAMS_COL, ['teamA'], T0);
  check('still warm just before the ttl', c.getDoc(TEAM_A, T0 + 29_999).hit === true);
  check('expired at the ttl', c.getDoc(TEAM_A, T0 + 30_000).hit === false);
  check('membership expires on the same clock',
    c.getMembers(TEAMS_COL, T0 + 30_000).hit === false);
}

// ── bounded memory; eviction is a cost, never a wrong answer ──────────────────
console.log('\n── eviction ──');
{
  const c = policy({ maxEntries: 3 });
  c.putDoc('c/1', { exists: true, data: { n: 1 } }, T0);
  c.putDoc('c/2', { exists: true, data: { n: 2 } }, T0);
  c.putDoc('c/3', { exists: true, data: { n: 3 } }, T0);
  c.getDoc('c/1', T0);                                    // touch 1 → 2 is now oldest
  c.putDoc('c/4', { exists: true, data: { n: 4 } }, T0);   // forces an eviction

  check('the cache stays within its bound', c.size() <= 3, `size=${c.size()}`);
  check('the least-recently-used entry was evicted', c.getDoc('c/2', T0).hit === false);
  check('a recently-used entry survived', c.getDoc('c/1', T0).hit === true);
  check('the newest entry is present', c.getDoc('c/4', T0).hit === true);
}

// ── dropping a whole run (finalize) ───────────────────────────────────────────
console.log('\n── drop by prefix ──');
{
  const c = policy();
  c.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
  c.putMembers(TEAMS_COL, ['teamA'], T0);
  c.putDoc('users/owner1/games/game1/runs/OTHER/teams/teamZ', { exists: true }, T0);

  c.dropPrefix(RUN);
  check('the finalized run\'s document is gone', c.getDoc(TEAM_A, T0).hit === false);
  check('and its membership is gone', c.getMembers(TEAMS_COL, T0).hit === false);
  check('another run is untouched',
    c.getDoc('users/owner1/games/game1/runs/OTHER/teams/teamZ', T0).hit === true);
}

// ── a prefix must not match a sibling by string alone ─────────────────────────
// `runs/run1` is a string prefix of `runs/run10`. Dropping one must not drop the other.
console.log('\n── prefix boundary ──');
{
  const c = policy();
  c.putDoc('users/owner1/games/game1/runs/run10/teams/teamQ', { exists: true }, T0);
  c.dropPrefix(RUN);
  check('run10 survives a drop of run1',
    c.getDoc('users/owner1/games/game1/runs/run10/teams/teamQ', T0).hit === true);
}

// ── the SAFE DEFAULT: reads are not cached unless explicitly enabled ──────────
// The design rests on "one process is the sole writer", which is a property of the
// DEPLOYMENT, not of this code. It holds on the VPS; it does NOT hold under the Firebase
// Functions emulator (a RuntimeWorkerPool of separate Node processes), nor on real Cloud
// Functions (many auto-scaled instances). In those, a write in one process cannot
// invalidate another's copy. So the default must be the safe one — a wrong deployment
// should lose a speed-up, never corrupt a live game.
console.log('\n── disabled by default ──');
{
  const c = createDocCachePolicy({ maxEntries: 100, ttlMs: 60_000 });
  c.putDoc(TEAM_A, { exists: true, data: { score: 10 } }, T0);
  check('a read is NOT served from memory when the cache was not enabled',
    c.getDoc(TEAM_A, T0).hit === false);
  c.putMembers(TEAMS_COL, ['teamA'], T0);
  check('membership is not served either', c.getMembers(TEAMS_COL, T0).hit === false);
  check('and nothing is retained', c.size() === 0, `size=${c.size()}`);
}
{
  const c = createDocCachePolicy({ maxEntries: 100, ttlMs: 60_000, enabled: false });
  c.putDoc(TEAM_A, { exists: true, data: { score: 10 } }, T0);
  check('an explicit `enabled: false` behaves the same', c.getDoc(TEAM_A, T0).hit === false);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 3 — the interception layer over a Firestore-shaped driver.
//
// The policy above is only as good as the guarantee that EVERY write reaches it.
// There are 216 write call sites across 18 modules and 44 transactions in
// functions/src; asking each to remember an invalidation call is exactly the kind of
// convention that rots, and one missed site means a stale document served to a live
// game. So interception sits on the `db` handle itself.
// ══════════════════════════════════════════════════════════════════════════════
import { wrapFirestore, cachedGetCollection } from '../functions/src/docCache';

/** A minimal Firestore-shaped driver that records what was read and written. */
function fakeDriver() {
  const reads: string[] = [];
  const writes: Array<{ path: string; verb: string }> = [];
  const note = (path: string, verb: string) => { writes.push({ path, verb }); };

  const docRef = (path: string) => ({
    path,
    get: async () => { reads.push(path); return { exists: true, id: path.split('/').pop(), data: () => ({ path }) }; },
    set: async (_v: unknown) => note(path, 'set'),
    create: async (_v: unknown) => note(path, 'create'),
    update: async (_v: unknown) => note(path, 'update'),
    delete: async () => note(path, 'delete'),
  });

  const collRef = (path: string) => ({
    path,
    doc: (id: string) => docRef(`${path}/${id}`),
    get: async () => { reads.push(path); return { docs: [] }; },
  });

  return {
    reads,
    writes,
    api: {
      doc: docRef,
      collection: collRef,
      async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
        const tx = {
          get: async (ref: { path: string }) => { reads.push(`tx:${ref.path}`); return { exists: true, data: () => ({}) }; },
          set: (ref: { path: string }) => note(ref.path, 'set'),
          create: (ref: { path: string }) => note(ref.path, 'create'),
          update: (ref: { path: string }) => note(ref.path, 'update'),
          delete: (ref: { path: string }) => note(ref.path, 'delete'),
        };
        return fn(tx);
      },
      batch() {
        const staged: Array<{ path: string; verb: string }> = [];
        return {
          set: (ref: { path: string }) => { staged.push({ path: ref.path, verb: 'set' }); },
          update: (ref: { path: string }) => { staged.push({ path: ref.path, verb: 'update' }); },
          delete: (ref: { path: string }) => { staged.push({ path: ref.path, verb: 'delete' }); },
          commit: async () => { for (const s of staged) note(s.path, s.verb); },
        };
      },
    },
  };
}

function wrapped(over: Partial<DocCachePolicyOptionsLike> = {}) {
  const p = policy(over);
  const d = fakeDriver();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { policy: p, driver: d, db: wrapFirestore(d.api as any, p, () => T0) as any };
}
type DocCachePolicyOptionsLike = { maxEntries: number; ttlMs: number };

async function main(): Promise<void> {
  console.log('\n── writes through the handle invalidate ──');
  for (const verb of ['set', 'create', 'update', 'delete'] as const) {
    const { policy: p, db } = wrapped();
    p.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
    const ref = db.doc(TEAM_A);
    await (verb === 'delete' ? ref.delete() : ref[verb]({ score: 2 }));
    check(`doc().${verb}() invalidated the cached document`,
      p.getDoc(TEAM_A, T0).hit === false);
  }
  {
    const { policy: p, db } = wrapped();
    p.putMembers(TEAMS_COL, ['teamA'], T0);
    await db.collection(TEAMS_COL).doc('teamB').set({ n: 1 });
    check('collection().doc().set() invalidated the parent membership',
      p.getMembers(TEAMS_COL, T0).hit === false);
  }

  console.log('\n── transactions invalidate AFTER they settle ──');
  {
    const { policy: p, db } = wrapped();
    p.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
    let insideWasStillWarm = false;
    await db.runTransaction(async (tx: any) => {
      tx.update(db.doc(TEAM_A), { score: 2 });
      // Firestore buffers tx writes until commit, so nothing has landed yet.
      insideWasStillWarm = p.getDoc(TEAM_A, T0).hit === true;
    });
    check('the entry was NOT dropped mid-transaction', insideWasStillWarm);
    check('and WAS dropped once the transaction resolved',
      p.getDoc(TEAM_A, T0).hit === false);
  }
  {
    const { policy: p, db } = wrapped();
    p.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
    let threw = false;
    try {
      await db.runTransaction(async (tx: any) => {
        tx.update(db.doc(TEAM_A), { score: 2 });
        throw new Error('contended');
      });
    } catch { threw = true; }
    check('a REJECTED transaction still propagates its error', threw);
    // Invalidation is never wrong, only occasionally wasteful — so a failed
    // transaction must fail toward a cold read, not toward a retained entry.
    check('and still drops what it touched', p.getDoc(TEAM_A, T0).hit === false);
  }

  console.log('\n── batches invalidate on commit ──');
  {
    const { policy: p, db } = wrapped();
    p.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
    const b = db.batch();
    b.update(db.doc(TEAM_A), { score: 2 });
    check('nothing dropped before commit', p.getDoc(TEAM_A, T0).hit === true);
    await b.commit();
    check('dropped after commit', p.getDoc(TEAM_A, T0).hit === false);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Escape hatches — references that do NOT come from db.doc()/db.collection().
  //
  // The original wrapper only intercepted those two entry points, and that was NOT
  // enough. A reference reached through a SNAPSHOT is a raw DocumentReference, and
  // three real call sites write through one:
  //   • admin/templates.ts:321    doc.ref.update(counts)       → a GAME document
  //   • maintenance/index.ts:125  teamDoc.ref.set(patch)       → a TEAM document
  //   • runs/index.ts:2618        recordPlayerResult(…, d.ref) → a TEAM document
  // All three are cached paths, so each was a stale-document bug. `recursiveDelete`
  // was a fourth: it never touches doc()/collection() at all, so a purged game would
  // have kept answering reads as though it still existed.
  // ══════════════════════════════════════════════════════════════════════════
  function richDriver() {
    const reads: string[] = [];
    const writes: Array<{ path: string; verb: string }> = [];
    const note = (path: string, verb: string) => { writes.push({ path, verb }); };
    const mk = (path: string): any => ({
      path,
      id: path.split('/').pop(),
      get: async () => { reads.push(path); return snapOf(path); },
      set: async () => note(path, 'set'),
      create: async () => note(path, 'create'),
      update: async () => note(path, 'update'),
      delete: async () => note(path, 'delete'),
    });
    const snapOf = (path: string): any =>
      ({ exists: true, id: path.split('/').pop(), ref: mk(path), data: () => ({ path }) });
    const queryOver = (paths: string[]): any => ({
      where: () => queryOver(paths),
      orderBy: () => queryOver(paths),
      limit: () => queryOver(paths),
      get: async () => ({ docs: paths.map(snapOf) }),
    });
    let recursed: string | null = null;
    return {
      reads, writes, recursed: () => recursed,
      api: {
        doc: mk,
        collection: (path: string): any => ({
          path,
          doc: (id: string) => mk(`${path}/${id}`),
          where: () => queryOver([`${path}/teamA`]),
          get: async () => ({ docs: [snapOf(`${path}/teamA`)] }),
        }),
        collectionGroup: () => queryOver([TEAM_A]),
        getAll: async (...refs: any[]) => refs.map((r) => snapOf(r.path)),
        recursiveDelete: async (ref: any) => { recursed = ref.path; },
        runTransaction: async (fn: any) => fn({}),
        batch: () => ({ commit: async () => undefined }),
      },
    };
  }
  function richWrapped() {
    const p = policy();
    const d = richDriver();
    return { policy: p, driver: d, db: wrapFirestore(d.api as any, p, () => T0) as any };
  }

  console.log('\n-- references reached through a snapshot are intercepted --');
  {
    const { policy: p, db } = richWrapped();
    p.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
    const snap = await db.collection(TEAMS_COL).where('x', '==', 1).limit(1).get();
    await snap.docs[0].ref.update({ score: 2 });
    check('a query snapshot ref invalidates on write', p.getDoc(TEAM_A, T0).hit === false);
  }
  {
    const { policy: p, db } = richWrapped();
    p.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
    const snap = await db.collection(TEAMS_COL).get();
    await snap.docs[0].ref.update({ score: 2 });
    check('a plain collection().get() snapshot ref invalidates too',
      p.getDoc(TEAM_A, T0).hit === false);
  }
  {
    const { policy: p, db } = richWrapped();
    p.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
    const snap = await db.collectionGroup('teams').get();
    await snap.docs[0].ref.update({ score: 2 });
    check('a collectionGroup snapshot ref invalidates (admin/templates.ts case)',
      p.getDoc(TEAM_A, T0).hit === false);
  }
  {
    const { policy: p, db } = richWrapped();
    p.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
    const snaps = await db.getAll(db.doc(TEAM_A));
    await snaps[0].ref.update({ score: 2 });
    check('a getAll() snapshot ref invalidates (the templates.ts path exactly)',
      p.getDoc(TEAM_A, T0).hit === false);
  }
  {
    const { policy: p, db } = richWrapped();
    p.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
    const snap = await db.doc(TEAM_A).get();
    await snap.ref.update({ score: 2 });
    check('a doc().get() snapshot ref invalidates', p.getDoc(TEAM_A, T0).hit === false);
  }

  console.log('\n-- recursiveDelete drops the whole subtree --');
  {
    const { policy: p, driver, db } = richWrapped();
    p.putDoc(TEAM_A, { exists: true, data: { score: 1 } }, T0);
    p.putMembers(TEAMS_COL, ['teamA'], T0);
    await db.recursiveDelete(db.doc(RUN));
    check('the driver actually received the delete', driver.recursed() === RUN);
    check('a purged run stops answering reads as if it existed',
      p.getDoc(TEAM_A, T0).hit === false);
    check('and its membership is gone', p.getMembers(TEAMS_COL, T0).hit === false);
  }

  console.log('\n-- a warm collection read preserves document order --');
  {
    const p = policy();
    const reads: string[] = [];
    const db2: any = {
      doc: (path: string) => ({ path, id: path.split('/').pop() }),
      getAll: async (...refs: any[]) => {
        refs.forEach((r) => reads.push(r.path));
        return refs.map((r) => ({ exists: true, id: r.id, data: () => ({ who: r.id }) }));
      },
    };
    p.putMembers(TEAMS_COL, ['a', 'b', 'c'], T0);
    for (const id of ['a', 'c']) {
      p.putDoc(`${TEAMS_COL}/${id}`, { exists: true, data: { who: id } }, T0);
    }
    // 'b' was written (so it is invalidated). It must come back in the MIDDLE, not at
    // the end — otherwise a team jumps position in the Run Console for no reason other
    // than having just been written, i.e. exactly when the run is busiest.
    const rows = await cachedGetCollection<{ who: string }>(db2, p, TEAMS_COL, { nowMs: T0 });
    check('only the invalidated document was re-read', reads.length === 1, JSON.stringify(reads));
    check('order still matches the collection, not the re-read order',
      rows.map((r) => r.id).join(',') === 'a,b,c', rows.map((r) => r.id).join(','));
  }


  console.log('\n── a transaction read is NEVER served from cache ──');
  // Firestore's optimistic concurrency needs tx.get() to REGISTER the read so a
  // conflicting write aborts the transaction. Answering it from memory would silently
  // disable that, and the station-contention race (FieldValue.increment on taskCounts)
  // is exactly where that would corrupt a live run.
  {
    const { policy: p, driver, db } = wrapped();
    p.putDoc(TEAM_A, { exists: true, data: { score: 99 } }, T0);
    await db.runTransaction(async (tx: any) => { await tx.get(db.doc(TEAM_A)); });
    check('tx.get() went to the driver despite a warm entry',
      driver.reads.includes(`tx:${TEAM_A}`), JSON.stringify(driver.reads));
  }

}

void main().then(() => {
  console.log(`
${failures === 0 ? 'ALL DOC-CACHE TESTS PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
});

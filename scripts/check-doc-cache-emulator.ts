// SINGLE-PROCESS integration check for the document cache (change: vps-firestore-read-offload).
//
// WHY THIS EXISTS — and why it is not a `test-*.ts`:
//
// The cache is only correct where ONE process is the sole writer. `npm run e2e` cannot test
// the enabled path at all, because the Firebase Functions emulator runs callables through a
// `RuntimeWorkerPool` of SEPARATE Node processes: a write handled by one worker cannot
// invalidate another worker's copy. Turning the cache on under e2e failed 11 scenarios with
// completely correct invalidation logic.
//
// So the enabled path had NO integration coverage — only unit tests against a hand-written
// fake driver. A fake driver proves the proxy's logic; it cannot prove the proxy behaves
// correctly against the real @google-cloud/firestore client, which is where the subtle
// failures live (arity-sensitive `doc()`, FieldValue sentinels, real transaction retries,
// real query snapshots handing out raw references).
//
// This file closes that gap the only way available: ONE process, the REAL Admin SDK, the
// REAL Firestore emulator, cache ENABLED. It is named `check-` rather than `test-` on
// purpose — `scripts/run-unit-tests.mjs` auto-discovers every `scripts/test-*.ts` and runs
// it with no emulator, and this one needs one.
//
//   node scripts/emulator-exec.mjs "npx tsx scripts/check-doc-cache-emulator.ts"
import { FieldValue } from 'firebase-admin/firestore';

process.env.RUSHPOINT_DOC_CACHE = '1';
process.env.GCLOUD_PROJECT ||= 'rushpoint-pwa-7daaa';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const RUN = 'users/cacheOwner/games/cacheGame/runs/cacheRun';
const TEAMS = `${RUN}/teams`;
const GAME = 'users/cacheOwner/games/cacheGame';

async function main(): Promise<void> {
  // Imported INSIDE main, after the env above is set — firebase.ts reads
  // RUSHPOINT_DOC_CACHE at module scope, so a static import would evaluate first and the
  // cache would be off, making every assertion below vacuously true.
  const { db, docCachePolicy } = await import('../functions/src/firebase');
  const { cachedGetDoc, cachedGetCollection } = await import('../functions/src/docCache');

  console.log('\n-- the cache is actually ON for this process --');
  {
    // ANTI-VACUITY. Every assertion below is of the form "a write is visible to the next
    // read" — which passes trivially if the cache is off and every read goes to Firestore.
    // So first PROVE reads are being answered from memory, by changing the document behind
    // the cache's back through a RAW handle that never touches the interceptor. If the
    // cached read still returns the old value, the cache is genuinely serving; if it
    // returns the new one, the cache is off and this whole file proves nothing.
    const admin = await import('firebase-admin');
    const rawDb = admin.default.firestore();

    await db.doc(GAME).set({ title: 'first' });
    await cachedGetDoc(db, docCachePolicy, GAME);          // warm it

    await rawDb.doc(GAME).update({ title: 'changed-behind-the-cache' });
    const stale = await cachedGetDoc<{ title: string }>(db, docCachePolicy, GAME);
    check('reads really are served from memory (an un-intercepted write is NOT seen)',
      stale.data?.title === 'first', String(stale.data?.title));

    // Put the document back in a known state for the assertions that follow, this time
    // through the intercepted handle so the entry is dropped properly.
    await db.doc(GAME).set({ title: 'first' });
    const fresh = await cachedGetDoc<{ title: string }>(db, docCachePolicy, GAME);
    check('and an intercepted write restores agreement', fresh.data?.title === 'first');
  }

  console.log('\n-- a write through the handle is visible to the next read --');
  {
    await db.doc(GAME).update({ title: 'second' });
    const g = await cachedGetDoc<{ title: string }>(db, docCachePolicy, GAME);
    check('doc().update() is reflected', g.data?.title === 'second', String(g.data?.title));
  }

  console.log('\n-- a REAL transaction (with a FieldValue sentinel) is reflected --');
  {
    await db.doc(RUN).set({ taskCounts: { t1: 1 } });
    await cachedGetDoc(db, docCachePolicy, RUN);            // warm
    await db.runTransaction(async (tx) => {
      tx.update(db.doc(RUN), { 'taskCounts.t1': FieldValue.increment(1) });
    });
    const r = await cachedGetDoc<{ taskCounts: { t1: number } }>(db, docCachePolicy, RUN);
    // This is the case design D1 refuses to merge locally — the post-write value cannot be
    // computed without reimplementing FieldValue, so the entry must have been DROPPED.
    check('an increment inside a transaction reads back as 2',
      r.data?.taskCounts?.t1 === 2, JSON.stringify(r.data?.taskCounts));
  }

  console.log('\n-- a REAL batch is reflected --');
  {
    const batch = db.batch();
    batch.update(db.doc(RUN), { batched: true });
    await batch.commit();
    const r = await cachedGetDoc<{ batched: boolean }>(db, docCachePolicy, RUN);
    check('batch.commit() is reflected', r.data?.batched === true);
  }

  console.log('\n-- a write through a real QUERY SNAPSHOT ref is reflected --');
  {
    await db.doc(`${TEAMS}/a`).set({ score: 1 });
    await db.doc(`${TEAMS}/b`).set({ score: 1 });
    await cachedGetCollection(db, docCachePolicy, TEAMS);   // warm roster + members
    const snap = await db.collection(TEAMS).where('score', '==', 1).get();
    // This is the maintenance/index.ts and runs/index.ts pattern exactly.
    await snap.docs[0].ref.update({ score: 99 });
    const rows = await cachedGetCollection<{ score: number }>(db, docCachePolicy, TEAMS);
    const updated = rows.find((r) => r.id === snap.docs[0].id);
    check('a snapshot-ref write is reflected in a warm collection read',
      updated?.data.score === 99, JSON.stringify(rows.map((r) => [r.id, r.data.score])));
  }

  console.log('\n-- a NEW document appears in a warm collection read --');
  {
    await cachedGetCollection(db, docCachePolicy, TEAMS);   // warm
    await db.doc(`${TEAMS}/c`).set({ score: 7 });
    const rows = await cachedGetCollection<{ score: number }>(db, docCachePolicy, TEAMS);
    check('the newly created team is present',
      rows.some((r) => r.id === 'c'), rows.map((r) => r.id).join(','));
    check('and the rows are still in document-id order',
      rows.map((r) => r.id).join(',') === 'a,b,c', rows.map((r) => r.id).join(','));
  }

  console.log('\n-- a deleted document stops being served --');
  {
    await cachedGetCollection(db, docCachePolicy, TEAMS);
    await db.doc(`${TEAMS}/c`).delete();
    const rows = await cachedGetCollection(db, docCachePolicy, TEAMS);
    check('the deleted team is gone from a warm read',
      !rows.some((r) => r.id === 'c'), rows.map((r) => r.id).join(','));
    const gone = await cachedGetDoc(db, docCachePolicy, `${TEAMS}/c`);
    check('and reads as not-existing', gone.exists === false);
  }

  console.log('\n-- recursiveDelete stops the subtree being served --');
  {
    await cachedGetDoc(db, docCachePolicy, `${TEAMS}/a`);   // warm
    await db.recursiveDelete(db.doc(RUN));
    const t = await cachedGetDoc(db, docCachePolicy, `${TEAMS}/a`);
    check('a purged run does not keep answering as if it existed', t.exists === false);
  }

  console.log('\n-- an absent document is not cached as present --');
  {
    const missing = await cachedGetDoc(db, docCachePolicy, `${TEAMS}/nope`);
    check('first read reports absent', missing.exists === false);
    await db.doc(`${TEAMS}/nope`).set({ score: 5 });
    const now = await cachedGetDoc<{ score: number }>(db, docCachePolicy, `${TEAMS}/nope`);
    check('and creating it later is picked up', now.exists === true && now.data?.score === 5);
  }

  console.log(`\n${failures === 0 ? 'ALL DOC-CACHE EMULATOR CHECKS PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((e) => { console.error('CRASH', e); process.exit(1); });
